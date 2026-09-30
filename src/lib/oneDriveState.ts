import { getJsonSetting, setJsonSetting } from './settingsRepository'

export type OneDriveState = {
  connected: boolean
  filePath: string | null
  lastRemoteRev: string | null
  lastPushedHash: string | null
  mergeBaseContent: string | null
  lastSyncAt: number | null
  localDirty: boolean
  localRevision: number
  accountId: string | null
  accountEmail: string | null
  accountName: string | null
}

const DEFAULT_STATE: OneDriveState = {
  connected: false,
  filePath: '/rivolo-notes.md',
  lastRemoteRev: null,
  lastPushedHash: null,
  mergeBaseContent: null,
  lastSyncAt: null,
  localDirty: false,
  localRevision: 0,
  accountId: null,
  accountEmail: null,
  accountName: null,
}

let writeQueue: Promise<void> = Promise.resolve()

const readOneDriveState = async () => {
  const stored = await getJsonSetting<OneDriveState>('onedrive.state')
  return { ...DEFAULT_STATE, ...stored }
}

const enqueueOneDriveStateWrite = async <T>(
  mutator: (current: OneDriveState) => { next: OneDriveState; result: T },
) => {
  const run = async () => {
    const current = await readOneDriveState()
    const { next, result } = mutator(current)
    await setJsonSetting('onedrive.state', next)
    return result
  }

  const queuedRun = writeQueue.then(run, run)
  writeQueue = queuedRun.then(
    () => undefined,
    () => undefined,
  )
  return queuedRun
}

export const getOneDriveState = async () => {
  await writeQueue
  return readOneDriveState()
}

export const updateOneDriveState = async (updates: Partial<OneDriveState>) => {
  return enqueueOneDriveStateWrite((current) => {
    const next = { ...current, ...updates }
    return { next, result: next }
  })
}

export const updateOneDriveFilePath = async (filePath: string) => {
  return enqueueOneDriveStateWrite((current) => {
    const pathChanged = current.filePath !== filePath
    const next = {
      ...current,
      filePath,
      localDirty: pathChanged ? true : current.localDirty,
      localRevision: pathChanged ? current.localRevision + 1 : current.localRevision,
      lastRemoteRev: pathChanged ? null : current.lastRemoteRev,
      lastPushedHash: pathChanged ? null : current.lastPushedHash,
      mergeBaseContent: pathChanged ? null : current.mergeBaseContent,
      lastSyncAt: pathChanged ? null : current.lastSyncAt,
    }

    return { next, result: next }
  })
}

export const markOneDriveLocalDirty = async () => {
  await enqueueOneDriveStateWrite((current) => {
    const next = {
      ...current,
      localDirty: true,
      localRevision: current.localRevision + 1,
    }

    return { next, result: next }
  })
}

export const finalizeOneDrivePushState = async (
  remoteRev: string,
  sourceRevision: number,
  pushedHash?: string | null,
  mergeBaseContent?: string,
) => {
  await enqueueOneDriveStateWrite((current) => {
    const next = {
      ...current,
      lastRemoteRev: remoteRev,
      lastPushedHash: pushedHash === undefined ? current.lastPushedHash : pushedHash,
      mergeBaseContent: mergeBaseContent ?? current.mergeBaseContent,
      lastSyncAt: Date.now(),
      localDirty: current.localRevision === sourceRevision ? false : current.localDirty,
    }

    return { next, result: next }
  })
}
