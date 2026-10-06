import { disconnectOneDriveAuth } from './oneDriveAuth'
import { getOneDriveState, updateOneDriveState } from './oneDriveState'
import { getNotebookProgress, listDirtyDays, targetFromState } from './oneDriveDailyState'
import { prepareOneDriveNotebook } from './oneDriveMigration'
import { pullDailyNotebook, pushDailyNotebook } from './oneDriveDailySync'
import { flushDailyOneDriveEvents } from './oneDriveEvents'
import type { SyncProvider, SyncPullOptions, SyncStatus } from './sync'
export { DEFAULT_ONEDRIVE_PATH, validateOneDriveTarget } from './oneDriveGraph'

export const getOneDriveStatus = async (): Promise<SyncStatus> => {
  const state = await getOneDriveState()
  const target = targetFromState(state)
  const progress = target ? await getNotebookProgress(target) : null
  return { connected: state.connected, targetName: state.filePath,
    lastRemoteVersion: null, notebookChannel: state.migrationStatus === 'complete' ? state.folderId : null,
    lastSyncAt: state.lastSyncAt, localDirty: target ? (await listDirtyDays(target)).length > 0 : state.localDirty,
    accountName: state.accountName, accountEmail: state.accountEmail, offlineReady: progress?.inventoryComplete ?? false }
}
export const pullFromOneDrive = async (options: SyncPullOptions = {}) => {
  const target = await prepareOneDriveNotebook(options.force ? 'cloud' : undefined)
  const result = await pullDailyNotebook(target, options)
  void flushDailyOneDriveEvents(target)
  return result
}
export const pushToOneDrive = async (force = false) => {
  const target = await prepareOneDriveNotebook(force ? 'local' : undefined)
  const result = await pushDailyNotebook(target, force)
  void flushDailyOneDriveEvents(target)
  return result
}
export const oneDriveProvider: SyncProvider = {
  id: 'onedrive', getStatus: getOneDriveStatus, pull: pullFromOneDrive, push: pushToOneDrive,
  disconnect: async () => {
    await disconnectOneDriveAuth()
    await updateOneDriveState({ connected: false, accountId: null, accountName: null, accountEmail: null,
      folderId: null, migrationStatus: null, migrationSource: null, migrationMessage: null,
      lastRemoteRev: null, lastPushedHash: null, mergeBaseContent: null, lastSyncAt: null })
  },
}
