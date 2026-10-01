import { getDay, listAllDays } from './dayRepository'
import { saveRollbackBackup, exportMarkdownFromDb } from './importExport'
import { getPendingEditorDayIds } from './pendingEditorSaves'
import { encodeNotebookDay, decodeNotebookDay, dayPath } from './notebookDays'
import { annotateLocalNotebook } from './oneDriveBlame'
import { mergeOneDriveNotebooksWithAuthors } from './oneDriveMerge'
import { markSyncLocalDirty } from './syncDirty'
import { hashSyncContent } from './syncHash'
import { getOneDriveState, updateOneDriveState } from './oneDriveState'
import { assertTarget, getDailyState, getDayChange, listDirtyDays, listDailyStates, listDailyErrors, commitDailyCheckpoint,
  setNotebookProgress, targetKey, applyDailyDocument, type DailyState, type NotebookTarget } from './oneDriveDailyState'
import { childAtPath, deleteItem, downloadItem, ensureDayParent, getItem, GraphConflict, inventoryDays, itemAddress, uploadDay, type DriveItem } from './oneDriveGraph'
import type { SyncPullOptions, SyncPushResult } from './sync'

const emptyBase = (id: string, title?: string) => encodeNotebookDay({ dayId: id, humanTitle: title ?? '', contentMd: '' })
const deferredByTarget = new Map<string, Set<string>>()
const deferredFor = (target: NotebookTarget) => {
  const key = targetKey(target)
  if (!deferredByTarget.has(key)) deferredByTarget.set(key, new Set())
  return deferredByTarget.get(key)!
}
const freshState = (id: string): DailyState => ({ dayId: id, item: null, eTag: null, baseline: null, uploadedHash: null, localRevision: 0, deleted: false })
const assertDayUnchanged = async (target: NotebookTarget, id: string, revision: number) => {
  await assertTarget(target)
  if (getPendingEditorDayIds().has(id) || (await getDayChange(id)).revision !== revision) {
    throw new Error(`OneDrive ${id}: local edits are waiting to be reconciled.`)
  }
}
const applyDay = async (target: NotebookTarget, id: string, content: string | null, revision: number, state: DailyState) => {
  const current = await getDay(id)
  if (current) await saveRollbackBackup(encodeNotebookDay(current))
  await assertDayUnchanged(target, id, revision)
  const nextRevision = await applyDailyDocument(target, id, content, revision, state)
  await markSyncLocalDirty([id], { excludeOneDrive: true })
  return nextRevision
}
const readRemote = async (item: DriveItem, id: string) => {
  if (!item.file || item.name !== `${id}.md` || !item.eTag) throw new Error(`OneDrive ${id}: file renamed or invalid. Check its folder and name.`)
  const text = await downloadItem(item)
  decodeNotebookDay(text, id)
  return text
}
export const verifyDailyItem = async (target: NotebookTarget, item: DriveItem, id: string) => {
  const atPath = await getItem(childAtPath(target.folder, dayPath(id)), true)
  if (!atPath || itemAddress(atPath) !== itemAddress(item)) throw new Error(`OneDrive ${id}: the tracked file was moved or renamed. Restore its path before syncing.`)
  return atPath
}
const checkpoint = async (target: NotebookTarget, state: DailyState, event?: Parameters<typeof commitDailyCheckpoint>[2]) => {
  await commitDailyCheckpoint(target, { ...state, error: null }, event)
}
const recordFailure = async (target: NotebookTarget, id: string, error: unknown) => {
  await assertTarget(target)
  const state = await getDailyState(target, id) ?? freshState(id)
  await commitDailyCheckpoint(target, { ...state, error: error instanceof Error ? error.message : 'OneDrive daily sync failed.' })
}

export const reconcileDay = async (target: NotebookTarget, id: string, mode: 'pull' | 'push', force = false, known?: DriveItem | null) => {
  const deferred = deferredFor(target)
  if (getPendingEditorDayIds().has(id)) { deferred.add(id); return { uploaded: false, applied: false } }
  deferred.delete(id)
  const stored = await getDailyState(target, id) ?? freshState(id)
  const change = await getDayChange(id)
  const local = await getDay(id)
  let uploaded = false
  let applied = false
  let appliedRevision = change.revision
  let observedMissing = false
  for (let attempt = 0; attempt < 3; attempt++) {
    await assertTarget(target)
    const remote = attempt === 0 && known !== undefined ? known : await getItem(childAtPath(target.folder, dayPath(id)), true)
    if (!remote) observedMissing = true
    if (stored.item && remote && itemAddress(remote) !== stored.item) {
      // A replacement at the same valid path is reconciled from its content.
      await getItem(stored.item, true).then((old) => { if (old) throw new Error(`OneDrive ${id}: the original file moved. Check the notebook folder.`) })
    }
    if (!remote && stored.item && !stored.deleted) {
      const old = await getItem(stored.item, true)
      if (old) throw new Error(`OneDrive ${id}: file moved or renamed. Restore its path before syncing.`)
    }
    const dirty = change.revision !== stored.localRevision
    if (change.deleted && dirty && !(force && mode === 'pull')) {
      if (remote) {
        // Fetch and validate before deletion; a local explicit deletion wins
        // against an edit but never removes an unrelated or malformed document.
        await readRemote(remote, id)
        try { await deleteItem(remote, () => assertDayUnchanged(target, id, change.revision)) }
        catch (error) { if (error instanceof GraphConflict) continue; throw error }
        uploaded = true
      }
      await checkpoint(target, { ...stored, item: remote ? itemAddress(remote) : stored.item, eTag: null, baseline: null, uploadedHash: null, localRevision: change.revision, deleted: true },
        uploaded ? { type: 'inventory-invalidated', revision: crypto.randomUUID() } : undefined)
      return { uploaded, applied }
    }
    if (!remote) {
      if (stored.item && !dirty || force && mode === 'pull') {
        if (local) {
          appliedRevision = await applyDay(target, id, null, change.revision, { ...stored, baseline: null, eTag: null, deleted: true })
          applied = true
        }
        await checkpoint(target, { ...stored, eTag: null, baseline: null, localRevision: appliedRevision, deleted: true })
        return { uploaded, applied }
      }
      if (!local || mode === 'pull' && !dirty || stored.deleted && !dirty) return { uploaded, applied }
      // A local edit against a confirmed remote deletion recreates only that day.
    }
    if (!local && !remote) return { uploaded, applied }
    if (remote && remote.eTag === stored.eTag && !dirty && stored.baseline && !(force && mode === 'pull')) return { uploaded, applied }
    const remoteText = remote ? (remote.eTag === stored.eTag && stored.baseline && stored.uploadedHash === await hashSyncContent(stored.baseline)
      ? stored.baseline : await readRemote(remote, id)) : null
    if (!force && !stored.baseline && !observedMissing && local && remoteText) {
      const cloud = decodeNotebookDay(remoteText, id)
      if (cloud.contentMd !== local.contentMd || cloud.humanTitle !== local.humanTitle) {
        throw new Error(`OneDrive ${id}: this folder contains different notes without a shared baseline. Choose the cloud version or keep this device's days in OneDrive settings.`)
      }
    }
    const localText = local ? await annotateLocalNotebook(encodeNotebookDay(local), stored.baseline ?? emptyBase(id, local.humanTitle), (await getOneDriveState()).accountName, local.updatedAt) : null
    let merged = remoteText ?? localText!
    if (force) merged = mode === 'pull' ? remoteText! : localText ?? remoteText!
    else if (localText && remoteText) merged = await mergeOneDriveNotebooksWithAuthors(stored.baseline ?? emptyBase(id), localText, remoteText)
    else if (mode === 'pull' && remoteText) merged = remoteText
    decodeNotebookDay(merged, id)
    if (remoteText !== merged && (mode === 'push' || dirty)) {
      const parent = await ensureDayParent(target.folder, id)
      let result: DriveItem
      try { result = await uploadDay(parent, id, remote, merged, () => assertTarget(target)) }
      catch (error) { if (error instanceof GraphConflict) continue; throw error }
      uploaded = true
      const hash = await hashSyncContent(merged)
      // Until additions reach the editor, the baseline remains its captured
      // local document. The uploaded hash makes the next pass fetch the remote.
      await checkpoint(target, { ...stored, item: itemAddress(result), eTag: result.eTag, baseline: localText ?? merged,
        uploadedHash: hash, localRevision: localText === merged ? change.revision : stored.localRevision, deleted: false },
        { type: 'day-changed', dayId: id, item: itemAddress(result), revision: result.eTag })
      try {
        await assertDayUnchanged(target, id, change.revision)
        if (!local || decodeNotebookDay(merged, id).contentMd !== local.contentMd || decodeNotebookDay(merged, id).humanTitle !== local.humanTitle) {
          appliedRevision = await applyDay(target, id, merged, change.revision, { ...stored, item: itemAddress(result), eTag: result.eTag, baseline: merged, uploadedHash: hash, deleted: false })
          applied = true
        }
        await checkpoint(target, { ...stored, item: itemAddress(result), eTag: result.eTag, baseline: merged, uploadedHash: hash,
          localRevision: appliedRevision, deleted: false })
      } catch (error) {
        deferred.add(id)
        await recordFailure(target, id, error)
      }
      return { uploaded, applied }
    }
    // Applying a download is guarded per day, so a draft in another day does
    // not stop catch-up or overwrite its editor.
    await assertDayUnchanged(target, id, change.revision)
    if (!local || decodeNotebookDay(merged, id).contentMd !== local.contentMd || decodeNotebookDay(merged, id).humanTitle !== local.humanTitle) {
      appliedRevision = await applyDay(target, id, merged, change.revision, { ...stored, item: remote ? itemAddress(remote) : stored.item, eTag: remote?.eTag ?? stored.eTag, baseline: merged, uploadedHash: await hashSyncContent(merged), deleted: false })
      applied = true
    }
    await checkpoint(target, { ...stored, item: remote ? itemAddress(remote) : stored.item, eTag: remote?.eTag ?? stored.eTag,
      baseline: merged, uploadedHash: await hashSyncContent(merged), localRevision: appliedRevision, deleted: false })
    return { uploaded, applied }
  }
  throw new Error(`OneDrive ${id}: other writers are still updating this day. Sync will retry.`)
}

export const refreshDailySummary = async (target: NotebookTarget) => {
  await assertTarget(target)
  const dirty = await listDirtyDays(target)
  const errors = await listDailyErrors(target)
  await updateOneDriveState({ localDirty: dirty.length > 0, lastSyncAt: Date.now(), lastRemoteRev: null })
  return errors.join(' ')
}
export const pushDailyNotebook = async (target: NotebookTarget, force = false): Promise<SyncPushResult> => {
  const deferred = deferredFor(target)
  const dirty = await listDirtyDays(target)
  const ids = new Set([...dirty.map((day) => day.dayId), ...deferred])
  if (force) for (const day of await listAllDays()) if (day.contentMd || await getDailyState(target, day.dayId)) ids.add(day.dayId)
  let uploaded = false, applied = false
  for (const id of ids) {
    try {
      const result = await reconcileDay(target, id, 'push', force)
      uploaded ||= result.uploaded
      applied ||= result.applied
    } catch (error) { await recordFailure(target, id, error) }
  }
  const attention = await refreshDailySummary(target)
  if (attention && !uploaded && !applied) throw new Error(attention)
  return uploaded || applied ? { status: 'pushed', ...(applied ? { localUpdated: true } : {}), ...(attention ? { attention } : {}) } : { status: 'clean' }
}
export const pullDailyNotebook = async (target: NotebookTarget, options: SyncPullOptions = {}) => {
  const deferred = deferredFor(target)
  const ids = options.dayIds
  const inventory = ids ? new Map(await Promise.all(ids.map(async (id) => [id, await getItem(childAtPath(target.folder, dayPath(id)), true)] as const))) : await inventoryDays(target.folder)
  const stored = ids ? [] : await listDailyStates(target)
  // Missing entries are checked individually by ID inside reconcileDay. This
  // only runs once every page of the inventory has been acquired successfully.
  const work = new Set([...inventory.keys(), ...(ids ? [] : stored.map((day) => day.dayId)), ...deferred])
  const sorted = [...work].sort((a, b) => b.localeCompare(a))
  let applied = false, loaded = 0
  const failures: string[] = []
  if (!ids) await setNotebookProgress(target, { inventoryComplete: false, loaded: 0, total: sorted.length, lastReconciledAt: null })
  if (options.force && !ids) await saveRollbackBackup(await exportMarkdownFromDb())
  for (const id of sorted) {
    try {
      const result = await reconcileDay(target, id, 'pull', options.force, inventory.get(id) ?? null)
      applied ||= result.applied
      if (!getPendingEditorDayIds().has(id)) loaded++
      if (!ids) await setNotebookProgress(target, { inventoryComplete: false, loaded, total: sorted.length, lastReconciledAt: null })
    } catch (error) {
      await recordFailure(target, id, error)
      failures.push(error instanceof Error ? error.message : 'OneDrive download failed.')
    }
  }
  if (options.force && !ids && !failures.length) {
    for (const local of await listAllDays()) {
      if (inventory.has(local.dayId) || stored.some((day) => day.dayId === local.dayId)) continue
      const change = await getDayChange(local.dayId)
      if (getPendingEditorDayIds().has(local.dayId)) { deferred.add(local.dayId); continue }
      const appliedRevision = await applyDay(target, local.dayId, null, change.revision, { ...freshState(local.dayId), deleted: true })
      await checkpoint(target, { ...freshState(local.dayId), deleted: true, localRevision: appliedRevision })
      applied = true
    }
  }
  if (!ids) await setNotebookProgress(target, { inventoryComplete: !failures.length && loaded === sorted.length, loaded, total: sorted.length, lastReconciledAt: Date.now() })
  const attention = await refreshDailySummary(target)
  if (attention) throw new Error(attention)
  return { status: applied ? 'pulled' as const : 'noop' as const, ...(deferred.size ? { deferredDayIds: [...deferred] } : {}) }
}
