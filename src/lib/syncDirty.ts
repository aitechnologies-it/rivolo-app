import { markOneDriveLocalDirty, markOneDriveLocalDirtyInDatabase } from './oneDriveState'
import { markDropboxLocalDirty, markDropboxLocalDirtyInDatabase } from './dropboxState'
import { markGoogleDriveLocalDirty, markGoogleDriveLocalDirtyInDatabase } from './googleDriveState'
import type { RivoloDatabase } from './sqliteRuntime'

export const markSyncLocalDirty = async (_dayIds?: string[], options: { excludeOneDrive?: boolean } = {}) => {
  // Per-day intent is captured transactionally by the SQLite journal. Other
  // providers deliberately keep their existing whole-notebook dirty flag.
  await Promise.all([...(options.excludeOneDrive ? [] : [markOneDriveLocalDirty()]), markDropboxLocalDirty(), markGoogleDriveLocalDirty()])
}

// Runs inside the note write's transaction, so the dirty flag cannot be lost
// if the tab closes between the note write and a separate settings write.
export const markSyncLocalDirtyInDatabase = (db: RivoloDatabase) => {
  markOneDriveLocalDirtyInDatabase(db)
  markDropboxLocalDirtyInDatabase(db)
  markGoogleDriveLocalDirtyInDatabase(db)
}
