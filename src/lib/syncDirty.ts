import { markOneDriveLocalDirty } from './oneDriveState'
import { markDropboxLocalDirty } from './dropboxState'
import { markGoogleDriveLocalDirty } from './googleDriveState'

export const markSyncLocalDirty = async (_dayIds?: string[], options: { excludeOneDrive?: boolean } = {}) => {
  // Per-day intent is captured transactionally by the SQLite journal. Other
  // providers deliberately keep their existing whole-notebook dirty flag.
  await Promise.all([...(options.excludeOneDrive ? [] : [markOneDriveLocalDirty()]), markDropboxLocalDirty(), markGoogleDriveLocalDirty()])
}
