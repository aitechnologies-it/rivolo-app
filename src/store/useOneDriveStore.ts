import { create } from 'zustand'
import { getOneDriveState, updateOneDriveFilePath } from '../lib/oneDriveState'

export type OneDriveViewState = {
  filePath: string
  lastRemoteRev: string | null
  lastSyncAt: number | null
  localDirty: boolean
  hasAuth: boolean
  accountId: string | null
  accountEmail: string | null
  accountName: string | null
  loadState: () => Promise<void>
  updateFilePath: (path: string) => Promise<void>
}

const stateToView = (state: Awaited<ReturnType<typeof getOneDriveState>>) => ({
  filePath: state.filePath ?? '',
  lastRemoteRev: state.lastRemoteRev,
  lastSyncAt: state.lastSyncAt,
  localDirty: state.localDirty,
  hasAuth: state.connected,
  accountId: state.accountId,
  accountEmail: state.accountEmail,
  accountName: state.accountName,
})

export const useOneDriveStore = create<OneDriveViewState>((set) => ({
  filePath: '',
  lastRemoteRev: null,
  lastSyncAt: null,
  localDirty: false,
  hasAuth: false,
  accountId: null,
  accountEmail: null,
  accountName: null,

  loadState: async () => set(stateToView(await getOneDriveState())),
  updateFilePath: async (path: string) => set(stateToView(await updateOneDriveFilePath(path))),
}))
