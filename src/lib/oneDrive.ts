import { exportMarkdownFromDb, importMarkdownToDb } from './importExport'
import { authorizedOneDriveFetch, disconnectOneDriveAuth } from './oneDriveAuth'
import { finalizeOneDrivePushState, getOneDriveState, updateOneDriveState } from './oneDriveState'
import { markSyncLocalDirty } from './syncDirty'
import { getEditorRevision, getPendingEditorDayIds } from './pendingEditorSaves'
import { mergeOneDriveNotebooks } from './oneDriveMerge'
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
let retryAfterAt = 0
const graphError = (response: Response, action: string) => {
  if (response.status === 429 || response.status === 503) {
    const retryAfter = response.headers.get('Retry-After')
    const seconds = Number(retryAfter)
    retryAfterAt = Date.now() + (retryAfter && Number.isFinite(seconds)
      ? Math.max(1, seconds) * 1000
      : Math.max(60_000, Date.parse(retryAfter ?? '') - Date.now() || 0))
  }
  return new Error(
  response.status === 403 ? 'OneDrive access denied. Each account needs permission to edit the shared file.' :
    response.status === 429 ? 'OneDrive is busy. Try syncing again later.' :
      `OneDrive ${action} failed (${response.status}). Try again.`,
  )
}

const checkRetryDelay = () => {
  if (Date.now() < retryAfterAt) throw new Error('OneDrive is busy. Sync will retry automatically shortly.')
}

const fetchMetadata = async (target: string): Promise<DriveItem | null> => {
  checkRetryDelay()
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
    // If another writer wins this race, reload and merge again before retrying.
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

const downloadFile = async (metadata: DriveItem) => {
  const url = metadata['@microsoft.graph.downloadUrl']
  if (!url?.startsWith('https://')) throw new Error('OneDrive did not provide a download URL.')
  // /content redirects do not support CORS preflight; use the preauthorized URL instead.
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw graphError(response, 'download')
  return response.text()
}

export const pullFromOneDrive = async (options: SyncPullOptions = {}) => {
  const state = await getOneDriveState()
  const editorRevision = getEditorRevision()
  if (getPendingEditorDayIds().size) return { status: 'noop' as const }
  if (state.localDirty && !options.force) return { status: 'noop' as const }
  const target = validateOneDriveTarget(state.filePath || DEFAULT_ONEDRIVE_PATH)
  const metadata = await fetchMetadata(target)
  if (!metadata) throw new Error('OneDrive file not found. Add a note and push to create it, or select a shared file.')
  if (revision(metadata) === state.lastRemoteRev && state.mergeBaseContent !== null && !(options.force && state.localDirty)) return { status: 'noop' as const }
  const content = await downloadFile(metadata)
  const assertUnchanged = async () => {
    const latest = await getOneDriveState()
    if (latest.localRevision !== state.localRevision || latest.filePath !== state.filePath ||
        latest.connected !== state.connected || getEditorRevision() !== editorRevision || getPendingEditorDayIds().size) {
      throw new Error('Notes changed during download. Sync again to keep your latest edits safe.')
    }
  }
  await assertUnchanged()
  await importMarkdownToDb(content, { replace: true, markDirty: false,
    allowUnsafeImport: options.allowUnsafeImport,
    allowDeletedDays: Boolean(state.lastRemoteRev), beforeReplace: assertUnchanged })
  await markSyncLocalDirty()
  const stillUnchanged = getEditorRevision() === editorRevision && !getPendingEditorDayIds().size
  await finalizeOneDrivePushState(revision(metadata), stillUnchanged ? state.localRevision + 1 : -1,
    await hashSyncContent(content), content)
  return { status: 'pulled' as const }
}

export const pushToOneDrive = async (force = false): Promise<SyncPushResult> => {
  const state = await getOneDriveState()
  if (!state.localDirty && !force) return { status: 'clean' }
  if (getPendingEditorDayIds().size) return { status: 'clean' }
  const editorRevision = getEditorRevision()
  const target = validateOneDriveTarget(state.filePath || DEFAULT_ONEDRIVE_PATH)
  const localContent = await exportMarkdownFromDb()
  const localHash = await hashSyncContent(localContent)
  for (let attempt = 0; attempt < 3; attempt++) {
    const metadata = await fetchMetadata(target)
    if (!force && ((state.lastRemoteRev && !metadata) || (!state.lastRemoteRev && metadata))) {
      return { status: 'blocked', reason: metadata ? 'remote_changed' : 'remote_missing' }
    }
    let content = localContent
    if (!force && metadata) {
      const remoteChanged = revision(metadata) !== state.lastRemoteRev
      if (remoteChanged && state.mergeBaseContent === null) {
        return { status: 'blocked', reason: 'remote_changed' }
      }
      // The base may deliberately exclude additions not yet applied to a busy editor.
      if (state.mergeBaseContent !== null) {
        const remoteContent = !remoteChanged && await hashSyncContent(state.mergeBaseContent) === state.lastPushedHash
          ? state.mergeBaseContent : await downloadFile(metadata)
        content = mergeOneDriveNotebooks(state.mergeBaseContent, localContent, remoteContent)
      }
      if (content === localContent && localHash === state.lastPushedHash && !remoteChanged) {
        await finalizeOneDrivePushState(revision(metadata), state.localRevision, localHash, localContent)
        return { status: 'clean' }
      }
    }
    const hash = await hashSyncContent(content)
    let uploaded: DriveItem
    try {
      uploaded = await uploadFile(target, metadata, content)
    } catch (error) {
      if (error instanceof UploadConflict) continue
      throw error
    }
    if (content === localContent) {
      await finalizeOneDrivePushState(revision(uploaded), state.localRevision, hash, content)
      return { status: 'pushed' }
    }

    // Keep the editor's old base until merged additions have actually been applied.
    // If typing continued during upload, the next push merges those drafts too.
    await finalizeOneDrivePushState(revision(uploaded), -1, hash, localContent)
    const assertUnchanged = async () => {
      const latest = await getOneDriveState()
      if (latest.localRevision !== state.localRevision || latest.filePath !== state.filePath ||
          latest.connected !== state.connected || getEditorRevision() !== editorRevision || getPendingEditorDayIds().size) {
        throw new Error('Local notes changed while merging. The merged OneDrive copy will be reconciled on the next sync.')
      }
    }
    try {
      await assertUnchanged()
      await importMarkdownToDb(content, { replace: true, markDirty: false, allowDeletedDays: true, beforeReplace: assertUnchanged })
      await markSyncLocalDirty()
      const stillUnchanged = getEditorRevision() === editorRevision && !getPendingEditorDayIds().size
      await finalizeOneDrivePushState(revision(uploaded), stillUnchanged ? state.localRevision + 1 : -1,
        hash, stillUnchanged ? content : localContent)
      return { status: 'pushed', localUpdated: true }
    } catch (error) {
      return { status: 'pushed', attention: error instanceof Error ? error.message : 'Merged notes will be applied on the next sync.' }
    }
  }
  return { status: 'blocked', reason: 'remote_changed' }
}

export const oneDriveProvider: SyncProvider = {
  id: 'onedrive', getStatus: getOneDriveStatus, pull: pullFromOneDrive, push: pushToOneDrive,
  disconnect: async () => {
    await disconnectOneDriveAuth()
    await updateOneDriveState({ connected: false, accountId: null, accountName: null, accountEmail: null,
      lastRemoteRev: null, lastPushedHash: null, mergeBaseContent: null, lastSyncAt: null })
  },
}
