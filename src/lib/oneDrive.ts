import { exportMarkdownFromDb, importMarkdownToDb } from './importExport'
import { authorizedOneDriveFetch, disconnectOneDriveAuth } from './oneDriveAuth'
import { finalizeOneDrivePushState, getOneDriveState, updateOneDriveState } from './oneDriveState'
import { markSyncLocalDirty } from './syncDirty'
import { hashSyncContent } from './syncHash'
import type { SyncProvider, SyncPullOptions, SyncPushResult, SyncStatus } from './sync'

const GRAPH = 'https://graph.microsoft.com/v1.0'
export const DEFAULT_ONEDRIVE_PATH = '/rivolo-notes.md'

type DriveItem = {
  id: string
  name: string
  eTag: string
  file?: object
  parentReference?: { driveId: string }
  '@microsoft.graph.downloadUrl'?: string
  remoteItem?: DriveItem
}

export const validateOneDriveTarget = (value: string) => {
  const target = value.trim() || DEFAULT_ONEDRIVE_PATH
  if (target.startsWith('https://')) {
    const url = new URL(target)
    if (url.username || url.password) throw new Error('Use a OneDrive sharing link without credentials.')
    return target
  }
  if (!target.startsWith('/') || !target.toLowerCase().endsWith('.md') ||
      target.split('/').slice(1).some((part) => !part || part === '.' || part === '..' || /["*:<>?\\|]/.test(part))) {
    throw new Error('Enter a OneDrive sharing link or an absolute Markdown path, such as /rivolo-notes.md.')
  }
  return target
}

const shareId = (url: string) => {
  const bytes = new TextEncoder().encode(url)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `u!${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}
const encodedPath = (path: string) => path.split('/').map(encodeURIComponent).join('/')
const itemAddress = (item: DriveItem) => {
  if (!item.parentReference?.driveId || !item.id) throw new Error('OneDrive returned an invalid file reference.')
  return `/drives/${encodeURIComponent(item.parentReference.driveId)}/items/${encodeURIComponent(item.id)}`
}
const revision = (item: DriveItem) => `${itemAddress(item)}:${item.eTag}`
const checkItem = (item: DriveItem) => {
  if (!item.file || !item.eTag || !item.name.toLowerCase().endsWith('.md')) {
    throw new Error('Choose a Markdown file shared with permission to edit, not a folder.')
  }
  itemAddress(item)
  return item
}
const graphError = (response: Response, action: string) => new Error(
  response.status === 403 ? 'OneDrive access denied. Each account needs permission to edit the shared file.' :
    response.status === 429 ? 'OneDrive is busy. Try syncing again later.' :
      `OneDrive ${action} failed (${response.status}). Try again.`,
)

const fetchMetadata = async (target: string): Promise<DriveItem | null> => {
  const shared = target.startsWith('https://')
  const address = shared ? `/shares/${shareId(target)}/driveItem` : `/me/drive/root:${encodedPath(target)}`
  const response = await authorizedOneDriveFetch(`${GRAPH}${address}`, {
    ...(shared ? { headers: { Prefer: 'redeemSharingLink' } } : {}),
    cache: 'no-store',
  })
  if (response.status === 404 && !shared) return null
  if (!response.ok) throw graphError(response, 'file lookup')
  const item = await response.json() as DriveItem
  // Shared shortcuts can reference a file in another drive.
  if (item.remoteItem) {
    const remote = await authorizedOneDriveFetch(`${GRAPH}${itemAddress(item.remoteItem)}`, { cache: 'no-store' })
    if (!remote.ok) throw graphError(remote, 'shared file lookup')
    return checkItem(await remote.json() as DriveItem)
  }
  return checkItem(item)
}

class UploadConflict extends Error {}
const uploadFile = async (target: string, metadata: DriveItem | null, content: string) => {
  const bytes = new TextEncoder().encode(content)
  if (!bytes.length) throw new Error('Add a note before creating the OneDrive file.')
  const address = metadata ? itemAddress(metadata) : `/me/drive/root:${encodedPath(target)}:`
  const session = await authorizedOneDriveFetch(`${GRAPH}${address}/createUploadSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(metadata ? { 'If-Match': metadata.eTag } : {}) },
    // Fail if a new file appears while uploading. Existing updates are guarded by eTag.
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': metadata ? 'replace' : 'fail' } }),
  })
  if (session.status === 409 || session.status === 412) throw new UploadConflict()
  if (!session.ok) throw graphError(session, 'upload preparation')
  const { uploadUrl } = await session.json() as { uploadUrl: string }
  if (!uploadUrl?.startsWith('https://')) throw new Error('OneDrive returned an invalid upload URL.')
  const chunkSize = 10 * 320 * 1024
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.length)
    // Microsoft preauthorizes this URL. Never forward the Graph bearer token to it.
    const result = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${offset}-${end - 1}/${bytes.length}` },
      body: bytes.slice(offset, end),
    })
    if (result.status === 409 || result.status === 412) throw new UploadConflict()
    if (!result.ok) throw graphError(result, 'upload')
    if (end === bytes.length) {
      if (result.status !== 200 && result.status !== 201) throw new Error('OneDrive upload did not finish. Try again.')
      return checkItem(await result.json() as DriveItem)
    }
  }
  throw new Error('OneDrive upload did not finish.')
}

export const getOneDriveStatus = async (): Promise<SyncStatus> => {
  const state = await getOneDriveState()
  return { connected: state.connected, targetName: state.filePath || DEFAULT_ONEDRIVE_PATH,
    lastRemoteVersion: state.lastRemoteRev, lastSyncAt: state.lastSyncAt, localDirty: state.localDirty,
    accountName: state.accountName, accountEmail: state.accountEmail }
}

export const pullFromOneDrive = async (options: SyncPullOptions = {}) => {
  const state = await getOneDriveState()
  if (state.localDirty && !options.force) return { status: 'noop' as const }
  const target = validateOneDriveTarget(state.filePath || DEFAULT_ONEDRIVE_PATH)
  const metadata = await fetchMetadata(target)
  if (!metadata) throw new Error('OneDrive file not found. Add a note and push to create it, or select a shared file.')
  if (revision(metadata) === state.lastRemoteRev && !(options.force && state.localDirty)) return { status: 'noop' as const }
  const url = metadata['@microsoft.graph.downloadUrl']
  if (!url?.startsWith('https://')) throw new Error('OneDrive did not provide a download URL.')
  // /content redirects do not support CORS preflight; use the preauthorized URL instead.
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw graphError(response, 'download')
  const content = await response.text()
  const latest = await getOneDriveState()
  if (latest.localRevision !== state.localRevision || latest.filePath !== state.filePath) {
    throw new Error('Notes changed during download. Sync again to keep your latest edits safe.')
  }
  await importMarkdownToDb(content, { replace: true, markDirty: false, allowUnsafeImport: options.allowUnsafeImport })
  await markSyncLocalDirty()
  await updateOneDriveState({ lastRemoteRev: revision(metadata), lastPushedHash: await hashSyncContent(content),
    lastSyncAt: Date.now(), localDirty: false })
  return { status: 'pulled' as const }
}

export const pushToOneDrive = async (force = false): Promise<SyncPushResult> => {
  const state = await getOneDriveState()
  if (!state.localDirty && !force) return { status: 'clean' }
  const target = validateOneDriveTarget(state.filePath || DEFAULT_ONEDRIVE_PATH)
  const metadata = await fetchMetadata(target)
  if (!force && ((state.lastRemoteRev && (!metadata || revision(metadata) !== state.lastRemoteRev)) ||
      (!state.lastRemoteRev && metadata))) {
    return { status: 'blocked', reason: metadata ? 'remote_changed' : 'remote_missing' }
  }
  const content = await exportMarkdownFromDb()
  const hash = await hashSyncContent(content)
  if (!force && metadata && hash === state.lastPushedHash && revision(metadata) === state.lastRemoteRev) {
    await finalizeOneDrivePushState(revision(metadata), state.localRevision, hash)
    return { status: 'clean' }
  }
  try {
    const uploaded = await uploadFile(target, metadata, content)
    await finalizeOneDrivePushState(revision(uploaded), state.localRevision, hash)
    return { status: 'pushed' }
  } catch (error) {
    if (error instanceof UploadConflict) return { status: 'blocked', reason: 'remote_changed' }
    throw error
  }
}

export const oneDriveProvider: SyncProvider = {
  id: 'onedrive', getStatus: getOneDriveStatus, pull: pullFromOneDrive, push: pushToOneDrive,
  disconnect: async () => {
    await disconnectOneDriveAuth()
    await updateOneDriveState({ connected: false, accountId: null, accountName: null, accountEmail: null,
      lastRemoteRev: null, lastPushedHash: null, lastSyncAt: null })
  },
}
