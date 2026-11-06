import { getJsonSetting, updateJsonSetting } from './settingsRepository'
import { executeSql, queryFirstRow, type RivoloDatabase } from './sqliteRuntime'

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
  // Read and write in one transaction so a dirty mark made inside a note write
  // (markOneDriveLocalDirtyInDatabase) is not overwritten by a queued update.
  const run = async () => {
    let result!: T
    await updateJsonSetting<unknown>('onedrive.state', (stored) => {
      const current = { ...DEFAULT_STATE, ...(stored && typeof stored === 'object' ? stored : {}) } as OneDriveState
      const { next, result: nextResult } = mutator(current)
      result = nextResult
      return next
    })
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('rivolo:onedrive-progress'))
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

// Legacy single-file notebooks use this flag; daily notebooks derive pending
// days from the onedrive_day_changes journal instead.
export const markOneDriveLocalDirtyInDatabase = (db: RivoloDatabase) => {
  const row = queryFirstRow<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ? LIMIT 1', ['onedrive.state'])
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = row ? JSON.parse(row.value) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>
  } catch {
    stored = {}
  }
  const state = { ...DEFAULT_STATE, ...stored } as OneDriveState
  const next = {
    ...state,
    localDirty: true,
    localRevision: (Number.isSafeInteger(state.localRevision) ? state.localRevision : 0) + 1,
  }
  executeSql(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    'onedrive.state',
    JSON.stringify(next),
  ])
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
