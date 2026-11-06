// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeStorage, createStorage, reopenStorage, type Storage } from '../test/helpers/storage'

// OneDrive sync against upstream's durable persistence layer: real SQLite,
// real draft registry and real IndexedDB snapshots.
let storage: Storage
beforeEach(async () => { storage = await createStorage() })
afterEach(() => { closeStorage(storage) })

const dayId = '2026-10-01'
const target = { folder: '/drives/owner/items/notebook', account: 'alice', generation: 1 }
const connect = () => storage.settings.setJsonSetting('onedrive.state', {
  connected: true, accountId: target.account, folderId: target.folder, targetGeneration: target.generation,
  localDirty: false, localRevision: 0,
})
const oneDriveState = async () => storage.settings.getJsonSetting<{ localDirty: boolean; localRevision: number }>('onedrive.state')
const checkpoint = (localRevision: number) => ({
  dayId, item: null, eTag: null, baseline: null, uploadedHash: null, localRevision, deleted: false,
})
const remoteDocument = (contentMd: string) => `<!-- day:${dayId} -->\nThursday\n---\n\n${contentMd}`

describe('OneDrive with durable note persistence', () => {
  it('marks OneDrive dirty in the same transaction as a note save, so it survives a reopen', async () => {
    await connect()
    await storage.repository.saveDay(dayId, 'Typed')
    expect(await oneDriveState()).toMatchObject({ localDirty: true, localRevision: 1 })

    storage = await reopenStorage(storage)
    expect(await oneDriveState()).toMatchObject({ localDirty: true, localRevision: 1 })
    const daily = await import('./oneDriveDailyState')
    expect((await daily.getDayChange(dayId)).revision).toBe(1)
  })

  it('refuses a remote day while its editor draft is only registered, and after the draft is written', async () => {
    await connect()
    await storage.repository.saveDay(dayId, 'Saved')
    const daily = await import('./oneDriveDailyState')
    const { getPendingEditorDayIds } = await import('./pendingEditorSaves')
    const sourceRevision = (await daily.getDayChange(dayId)).revision

    const generation = storage.db.registerPendingDayDraft(dayId, 'Saved and still typing', storage.repository.commitDayDraftInDatabase)
    expect(generation).toBeGreaterThan(0)
    expect(getPendingEditorDayIds().has(dayId)).toBe(true)
    await expect(daily.applyDailyDocument(target, dayId, remoteDocument('Remote'), sourceRevision, checkpoint(sourceRevision)))
      .rejects.toThrow('local edits are waiting')

    // Persisting writes the draft, which advances the day's change revision.
    await storage.db.flushDatabaseSave()
    expect(getPendingEditorDayIds().has(dayId)).toBe(false)
    expect((await daily.getDayChange(dayId)).revision).toBeGreaterThan(sourceRevision)
    await expect(daily.applyDailyDocument(target, dayId, remoteDocument('Remote'), sourceRevision, checkpoint(sourceRevision)))
      .rejects.toThrow('local edits are waiting')
    expect((await storage.repository.getDay(dayId))?.contentMd).toBe('Saved and still typing')
  })

  it('applies a remote day when no local edit is pending', async () => {
    await connect()
    await storage.repository.saveDay(dayId, 'Saved')
    const daily = await import('./oneDriveDailyState')
    const sourceRevision = (await daily.getDayChange(dayId)).revision

    await daily.applyDailyDocument(target, dayId, remoteDocument('Remote'), sourceRevision, checkpoint(sourceRevision))
    storage = await reopenStorage(storage)
    expect((await storage.repository.getDay(dayId))?.contentMd).toBe('Remote')
  })
})
