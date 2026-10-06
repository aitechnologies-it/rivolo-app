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
  folderId: string | null
  targetGeneration: number
  migrationStatus: 'pending' | 'running' | 'blocked' | 'complete' | null
  migrationMessage: string | null
  migrationSource: string | null
}

const DEFAULT_STATE: OneDriveState = {
  connected: false,
  filePath: '/Rivolo',
  lastRemoteRev: null,
  lastPushedHash: null,
  mergeBaseContent: null,
  lastSyncAt: null,
  localDirty: false,
  localRevision: 0,
  accountId: null,
  accountEmail: null,
  accountName: null,
  folderId: null,
  targetGeneration: 0,
  migrationStatus: null,
  migrationMessage: null,
  migrationSource: null,
}

let writeQueue: Promise<void> = Promise.resolve()

export const runOneDriveStateExclusive = async <T>(operation: () => Promise<T>) => {
  const queued = writeQueue.then(operation, operation)
  writeQueue = queued.then(() => undefined, () => undefined)
  return queued
}

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
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('rivolo:onedrive-progress'))
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
    const accountChanged = updates.accountId !== undefined && updates.accountId !== current.accountId
    const connectionChanged = updates.connected !== undefined && updates.connected !== current.connected
    const next = { ...current, ...updates,
      targetGeneration: updates.targetGeneration ?? current.targetGeneration + (accountChanged || connectionChanged ? 1 : 0),
    }
    return { next, result: next }
  })
}

export const updateOneDriveFilePath = async (filePath: string) => {
  return enqueueOneDriveStateWrite((current) => {
    const pathChanged = current.filePath !== filePath
    const next = {
      ...current,
      filePath,
      folderId: pathChanged ? null : current.folderId,
      targetGeneration: pathChanged ? current.targetGeneration + 1 : current.targetGeneration,
      migrationStatus: pathChanged ? 'pending' as const : current.migrationStatus,
      migrationMessage: pathChanged ? null : current.migrationMessage,
      migrationSource: pathChanged && current.migrationStatus === 'complete' ? null : current.migrationSource,
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
