// @vitest-environment node
import initSqlite from '@sqlite.org/sqlite-wasm'
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ensureDatabaseSchema, executeSql, openSerializedDatabase, queryRows, type RivoloDatabase, type RivoloSqlite, type SqlParam } from './sqliteRuntime'
import type { Permission } from '../../functions/_lib/oneDrivePermissions'
import { createGraphFixture } from '../test/oneDriveGraphFixture'
import { encodeNotebookDay } from './notebookDays'
import { writeNotebookAuthors, readNotebookAuthors } from './oneDriveBlame'

const dbMock = vi.hoisted(() => ({ db: null as RivoloDatabase | null }))
vi.mock('./db', () => ({
  run: async (sql: string, params: SqlParam[] = []) => executeSql(dbMock.db!, sql, params),
  queryAll: async (sql: string, params: SqlParam[] = []) => queryRows(dbMock.db!, sql, params),
  queryOne: async (sql: string, params: SqlParam[] = []) => queryRows(dbMock.db!, sql, params)[0] ?? null,
  isFtsAvailable: async () => false, upsertFts: async () => {},
  runAtomicDatabaseMutation: async (fn: (db: RivoloDatabase) => unknown) => { let result: unknown; dbMock.db!.transaction(() => { result = fn(dbMock.db!) }); return result },
  flushDatabaseSave: async () => {}, runBulkDatabaseMutation: async (fn: () => Promise<unknown>) => fn(),
  runDatabaseTransaction: async (fn: () => Promise<unknown>) => fn(),
}))
vi.mock('./oneDriveAuth', () => ({ authorizedOneDriveFetch: (url: string, init?: RequestInit) => fetch(url, init), disconnectOneDriveAuth: vi.fn() }))
vi.mock('./oneDriveEvents', () => ({ flushDailyOneDriveEvents: vi.fn() }))
vi.mock('./importExport', () => ({
  saveRollbackBackup: vi.fn(),
  exportMarkdownFromDb: async () => (await import('./markdown')).exportMarkdown(await (await import('./dayRepository')).listAllDays()),
}))
let sqlite: RivoloSqlite
let graph: ReturnType<typeof createGraphFixture>
const id = '2026-10-01', previous = '2026-09-30'
const doc = (contentMd: string, dayId = id) => encodeNotebookDay({ dayId, humanTitle: 'Thursday', contentMd })
beforeAll(async () => { sqlite = await initSqlite() })
beforeEach(async () => {
  vi.resetModules()
  dbMock.db = openSerializedDatabase(sqlite)
  ensureDatabaseSchema(dbMock.db)
  graph = createGraphFixture()
  vi.stubGlobal('fetch', graph.fetch)
  await (await import('./oneDriveState')).updateOneDriveState({ connected: true, accountId: 'alice', accountName: 'Alice', filePath: '/Rivolo', folderId: graph.folder, migrationStatus: 'complete' })
})
afterEach(() => { dbMock.db?.close(); vi.unstubAllGlobals() })
const target = async () => (await import('./oneDriveDailyState')).targetFromState(await (await import('./oneDriveState')).getOneDriveState())!
const baseline = async (content: string, dayId = id) => {
  const item = graph.addDay(dayId, content)
  const { saveDay } = await import('./dayRepository')
  const { decodeNotebookDay } = await import('./notebookDays')
  const day = decodeNotebookDay(content, dayId)
  await saveDay(dayId, day.contentMd, day.humanTitle)
  const daily = await import('./oneDriveDailyState')
  await daily.writeDailyState(await target(), { dayId, item: `/drives/drive/items/${item.id}`, eTag: item.eTag, baseline: content,
    uploadedHash: await (await import('./syncHash')).hashSyncContent(content), localRevision: (await daily.getDayChange(dayId)).revision, deleted: false })
}

describe('OneDrive daily notebook sync', () => {
  it('verifies SharePoint conditional content writes, removes its probe and merges a race without losing additions', async () => {
    graph.setDriveType('documentLibrary')
    await baseline(doc('First'))
    await (await import('./dayRepository')).saveDay(id, 'First\nLocal', 'Thursday')
    graph.afterBytes(async () => { graph.addDay(id, doc('First\nRemote'), 'v2') })
    await (await import('./oneDrive')).pushToOneDrive()
    expect(graph.texts.get(`file-${id}`)).toContain('First\nRemote\nLocal')
    expect([...graph.items.values()].some((item) => item.name.startsWith('.rivolo-condition-'))).toBe(false)
    expect(graph.fetch.mock.calls.some(([url]) => String(url).endsWith('/createUploadSession'))).toBe(false)
    const updates = graph.fetch.mock.calls.filter(([url, init]) => String(url).endsWith(`/file-${id}/content`) && init?.method === 'PUT')
    expect(updates.map(([, init]) => new Headers(init!.headers).get('If-Match'))).toEqual(['v1', 'v2'])
  })
  it('does not upload user notes when a business drive ignores conditional requests', async () => {
    graph.setDriveType('business'); graph.ignoreConditions()
    await (await import('./dayRepository')).saveDay(id, 'Private local note', 'Thursday')
    await expect((await import('./oneDrive')).pushToOneDrive()).rejects.toThrow('did not verify conditional file writes')
    expect(graph.counters.commits).toEqual([])
    expect([...graph.texts.values()].some((text) => text.includes('Private local note'))).toBe(false)
    expect([...graph.items.values()].some((item) => item.name.startsWith('.rivolo-condition-'))).toBe(false)
  })
  it('requires a choice for unknown differing cloud days, then preserves the selected device copy', async () => {
    graph.addDay(id, doc('Existing cloud note'))
    await (await import('./dayRepository')).saveDay(id, 'Independent local note', 'Thursday')
    const sync = await import('./oneDrive')
    await expect(sync.pushToOneDrive()).rejects.toThrow('without a shared baseline')
    expect(graph.counters.commits).toEqual([])
    expect((await (await import('./dayRepository')).getDay(id))?.contentMd).toBe('Independent local note')
    await sync.pushToOneDrive(true)
    expect(graph.texts.get(`file-${id}`)).toContain('Independent local note')
    expect(graph.texts.get(`file-${id}`)).not.toContain('Existing cloud note')
  })
  it('uses an empty baseline for verified simultaneous creation after observing the missing day', async () => {
    await (await import('./dayRepository')).saveDay(id, 'Created locally', 'Thursday')
    graph.afterBytes(async () => { graph.addDay(id, doc('Created remotely')) })
    await (await import('./oneDrive')).pushToOneDrive()
    expect(graph.texts.get(`file-${id}`)).toContain('Created remotely\nCreated locally')
  })
  it('uploads only the edited day and commits conditionally after UTF-8 bytes without forwarding auth', async () => {
    await baseline(doc('Yesterday', previous), previous)
    await baseline(doc('Before'))
    await (await import('./dayRepository')).saveDay(id, 'Caffè ☕')
    const result = await (await import('./oneDrive')).pushToOneDrive()
    expect(result.status).toBe('pushed')
    expect(graph.counters.commits).toEqual([id])
    expect(graph.counters.downloads).toEqual([])
    const session = graph.fetch.mock.calls.find(([url]) => String(url).endsWith('/createUploadSession'))!
    expect(JSON.parse(session[1]!.body as string).deferCommit).toBe(true)
    const commit = graph.fetch.mock.calls.find(([url, init]) => String(url).startsWith('https://graph') && init?.method === 'PUT')!
    expect(new Headers(commit[1]!.headers).get('If-Match')).toBe('v1')
    const bytes = graph.fetch.mock.calls.find(([url, init]) => String(url).startsWith('https://upload') && init?.method === 'PUT')![1]!
    expect(new Headers(bytes.headers).has('Authorization')).toBe(false)
    expect(new TextDecoder().decode(bytes.body as Uint8Array)).toContain('Caffè ☕')
    expect(await (await import('./oneDrive')).getOneDriveStatus()).toMatchObject({ localDirty: false, notebookChannel: graph.folder })
    expect((await (await import('./oneDriveDailyState')).readDailyOutbox(await target()))[0].entry.event).toMatchObject({ type: 'day-changed', dayId: id })
  })
  it('combines concurrent additions with their authors and leaves other days intact', async () => {
    const base = await writeNotebookAuthors(doc('First'), new Map([[id, ['Bob']]]))
    await baseline(base)
    await baseline(doc('History', previous), previous)
    await (await import('./dayRepository')).saveDay(id, 'First\nAlice addition')
    graph.addDay(id, await writeNotebookAuthors(doc('First\nBob addition'), new Map([[id, ['Bob', 'Bob']]])), 'v2')
    expect(await (await import('./oneDrive')).pushToOneDrive()).toMatchObject({ status: 'pushed', localUpdated: true })
    const text = graph.texts.get(`file-${id}`)!
    expect(text).toContain('First\nBob addition\nAlice addition')
    expect((await readNotebookAuthors(text)).get(id)).toEqual(['Bob', 'Bob', 'Alice'])
    expect((await (await import('./dayRepository')).getDay(previous))?.contentMd).toBe('History')
  })
  it('rereads and remerges when another writer wins between upload-session creation and final commit', async () => {
    await baseline(doc('First'))
    await (await import('./dayRepository')).saveDay(id, 'First\nAlice')
    graph.afterBytes(async () => { graph.addDay(id, doc('First\nBob'), 'v2') })
    await (await import('./oneDrive')).pushToOneDrive()
    expect(graph.texts.get(`file-${id}`)).toContain('First\nBob\nAlice')
    expect(graph.counters.commits).toEqual([id])
    expect(graph.counters.downloads).toContain(`file-${id}`)
  })
  it('preserves typing and dirty revisions advanced during upload, then reconciles without duplicate remote additions', async () => {
    await baseline(doc('First'))
    await (await import('./dayRepository')).saveDay(id, 'First\nAlice')
    graph.addDay(id, doc('First\nBob'), 'v2')
    graph.afterBytes(async () => { await (await import('./dayRepository')).saveDay(id, 'First\nAlice\nLater') })
    const sync = await import('./oneDrive')
    expect(await sync.pushToOneDrive()).toMatchObject({ status: 'pushed', attention: expect.any(String) })
    expect((await (await import('./dayRepository')).getDay(id))?.contentMd).toBe('First\nAlice\nLater')
    expect((await sync.getOneDriveStatus()).localDirty).toBe(true)
    await sync.pushToOneDrive()
    expect((await (await import('./dayRepository')).getDay(id))?.contentMd).toBe('First\nBob\nAlice\nLater')
    expect((await sync.getOneDriveStatus()).localDirty).toBe(false)
  })
  it('checkpoints successful days when one upload fails, then retries only the failed day', async () => {
    const days = await import('./dayRepository')
    await days.saveDay(previous, 'Yesterday')
    await days.saveDay(id, 'Today')
    graph.setFailure(previous)
    const sync = await import('./oneDrive')
    expect(await sync.pushToOneDrive()).toMatchObject({ status: 'pushed', attention: expect.any(String) })
    expect(graph.counters.commits).toEqual([id])
    graph.setFailure(null)
    await sync.pushToOneDrive()
    expect(graph.counters.commits).toEqual([id, previous])
    expect((await sync.getOneDriveStatus()).localDirty).toBe(false)
  })
  it('pulls the event day only, skips unchanged downloads, and preserves the rest of the notebook', async () => {
    await baseline(doc('Old'))
    await baseline(doc('History', previous), previous)
    graph.addDay(id, doc('Remote edit'), 'v2')
    const sync = await import('./oneDrive')
    expect(await sync.pullFromOneDrive({ dayIds: [id] })).toEqual({ status: 'pulled' })
    expect(graph.counters.downloads).toEqual([`file-${id}`])
    expect((await (await import('./dayRepository')).getDay(previous))?.contentMd).toBe('History')
    expect(await sync.pullFromOneDrive({ dayIds: [id] })).toEqual({ status: 'noop' })
    expect(graph.counters.downloads).toHaveLength(1)
    const { getJsonSetting } = await import('./settingsRepository')
    expect(await getJsonSetting('dropbox.state')).toMatchObject({ localDirty: true })
    expect(await getJsonSetting('google-drive.state')).toMatchObject({ localDirty: true })
  })
  it('defers a draft without blocking another day and marks offline availability incomplete', async () => {
    await baseline(doc('Before'))
    graph.addDay(id, doc('Remote'), 'v2')
    graph.addDay(previous, doc('Yesterday', previous))
    const unregister = (await import('./pendingEditorSaves')).registerPendingEditorSaves(() => [id])
    try {
      await (await import('./oneDrive')).pullFromOneDrive()
      expect((await (await import('./dayRepository')).getDay(id))?.contentMd).toBe('Before')
      expect((await (await import('./dayRepository')).getDay(previous))?.contentMd).toBe('Yesterday')
      expect((await (await import('./oneDrive')).getOneDriveStatus()).offlineReady).toBe(false)
    } finally { unregister() }
  })
  it('does not create a remote file for simply viewing a blank day', async () => {
    await (await import('./dayRepository')).ensureDay(id)
    expect(await (await import('./oneDrive')).pushToOneDrive()).toEqual({ status: 'clean' })
    expect(graph.counters.commits).toEqual([])
  })
  it('propagates an explicit deletion and queues a folder invalidation', async () => {
    await baseline(doc('Delete me'))
    await (await import('./dayRepository')).deleteDay(id)
    await (await import('./oneDrive')).pushToOneDrive()
    expect(graph.texts.has(`file-${id}`)).toBe(false)
    expect((await (await import('./oneDriveDailyState')).readDailyOutbox(await target()))[0].entry.event.type).toBe('inventory-invalidated')
  })
  it('confirms a missing remote file by ID before deleting a clean local day, but keeps a new local edit', async () => {
    await baseline(doc('Gone'))
    graph.items.delete(`/drives/drive/items/file-${id}`)
    await (await import('./oneDrive')).pullFromOneDrive()
    expect(await (await import('./dayRepository')).getDay(id)).toBeNull()
    await (await import('./dayRepository')).saveDay(id, 'A new edit')
    await (await import('./oneDrive')).pushToOneDrive()
    expect(graph.texts.get(`file-${id}`)).toContain('A new edit')
  })
  it('does not treat moved or malformed files as deletions', async () => {
    await baseline(doc('Keep'))
    graph.items.get(`/drives/drive/items/file-${id}`)!.name = 'renamed.md'
    await expect((await import('./oneDrive')).pullFromOneDrive()).rejects.toThrow('moved or renamed')
    expect((await (await import('./dayRepository')).getDay(id))?.contentMd).toBe('Keep')
  })
  it('stops before commit if the account or target changes while bytes upload', async () => {
    await baseline(doc('Before'))
    await (await import('./dayRepository')).saveDay(id, 'Local edit')
    graph.afterBytes(async () => { await (await import('./oneDriveState')).updateOneDriveFilePath('/Other') })
    await expect((await import('./oneDrive')).pushToOneDrive()).rejects.toThrow('account or notebook changed')
    expect(graph.counters.commits).toEqual([])
  })
})

const setupMigration = async (sourceText: string, base: string | null = sourceText) => {
  const source = { id: 'legacy', name: 'notes.md', eTag: 'old-v1', file: {}, parentReference: { driveId: 'drive', id: 'root' }, '@microsoft.graph.downloadUrl': 'https://download.test/legacy' }
  graph.items.set('/drives/drive/items/legacy', source)
  graph.texts.set('legacy', sourceText)
  graph.items.get(graph.folder)!.name = 'Rivolo-notes-legacy'
  let registration: { destination?: string; status?: string; generation?: number; lease?: string; expires?: number } = {}
  let denyPermissions = false
  let registryUnavailable = false
  let ownDrive = 'drive'
  let sourcePermissions: Permission[] = [{ roles: ['owner'], grantedToV2: { user: { id: 'alice' } } }]
  let destinationPermissions: Permission[] = sourcePermissions
  const grants: object[] = []
  const requests: object[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/onedrive/migration') {
      const body = JSON.parse(init!.body as string)
      requests.push(body)
      if (registryUnavailable) return Response.json({ message: 'Registry unavailable' }, { status: 503 })
      if (body.action === 'claim') registration = { destination: body.destination, status: 'running', generation: 1, lease: 'lease-1', expires: Date.now() + 60_000 }
      if (body.action === 'renew') registration.expires = Date.now() + 60_000
      if (body.action === 'complete') registration.status = 'complete'
      return Response.json(registration)
    }
    if (url.endsWith('/permissions')) return Response.json({ value: url.includes('/legacy/') ? sourcePermissions : denyPermissions ?
      [{ roles: ['write'], link: { scope: 'anonymous', type: 'edit' } }] : destinationPermissions })
    if (url.endsWith('/createLink')) {
      const body = JSON.parse(init!.body as string); grants.push(body)
      const link = { roles: [body.type === 'edit' ? 'write' : 'read'], link: { scope: body.scope, type: body.type, webUrl: 'https://share.test/daily-folder' } }
      destinationPermissions = [...destinationPermissions, link]
      return Response.json(link)
    }
    if (url.endsWith('/invite')) {
      const body = JSON.parse(init!.body as string); grants.push(body)
      destinationPermissions = [...destinationPermissions, { roles: body.roles, grantedToV2: { user: { id: body.recipients[0].objectId } } }]
      return Response.json({ value: destinationPermissions })
    }
    if (url.endsWith('/me/drive?$select=id')) return Response.json({ id: ownDrive })
    return graph.fetch(input, init)
  }))
  await (await import('./oneDriveState')).updateOneDriveState({ filePath: '/notes.md', folderId: null, migrationStatus: 'pending', mergeBaseContent: base })
  return { requests, source, grants,
    setSharePoint: () => {
      ownDrive = 'personal-drive'; graph.setDriveType('documentLibrary')
      destinationPermissions = [
        { roles: ['owner'], grantedToV2: { siteGroup: { id: '3' }, sharePointGroup: { id: 'site-owners' } } },
        { roles: ['read'], grantedToV2: { siteGroup: { id: '4' }, sharePointGroup: { id: 'site-visitors' } } },
        { roles: ['write'], grantedToV2: { siteGroup: { id: '5' }, sharePointGroup: { id: 'site-members' } } },
      ]
      sourcePermissions = [...destinationPermissions, { roles: ['write'], link: { scope: 'organization', type: 'edit' }, grantedToIdentitiesV2: [{ user: { id: 'alice' } }, { user: { id: 'bob' } }] }]
    }, setDrive: (drive: string) => { ownDrive = drive }, setUnshared: () => { sourcePermissions = []; destinationPermissions = [] },
    setMissingRecipient: () => { sourcePermissions = [...sourcePermissions, { roles: ['write'], grantedToV2: { user: { id: 'existing-reader' } } }] },
    setCompleted: () => { registration = { destination: graph.folder, status: 'complete' } },
    denyPermissions: () => { denyPermissions = true }, registryUnavailable: () => { registryUnavailable = true }, registryAvailable: () => { registryUnavailable = false } }
}

describe('automatic legacy migration', () => {
  it('creates a folder and daily files for the HAR SharePoint permission shape, preserving the original file and existing organization access', async () => {
    await (await import('./dayRepository')).saveDay(id, 'First', 'Thursday')
    const service = await setupMigration(doc('First'))
    graph.items.delete(graph.folder)
    service.setSharePoint()
    await (await import('./oneDrive')).pushToOneDrive()
    const state = await (await import('./oneDriveState')).getOneDriveState()
    expect(state.migrationStatus).toBe('complete')
    expect(state.filePath).toBe('https://share.test/daily-folder')
    expect(graph.items.get(state.folderId!)?.name).toBe('Rivolo-notes-legacy')
    expect(graph.texts.get('legacy')).toBe(doc('First'))
    expect(graph.texts.get(`file-${id}`)).toContain('First')
    expect(service.grants).toEqual([{ type: 'edit', scope: 'organization', retainInheritedPermissions: true }])
    expect(service.requests.map((request) => (request as { action: string }).action)).toEqual(['lookup', 'claim', 'complete'])
  })
  it('retains the original merge baseline when a folder is saved during a blocked migration', async () => {
    const days = await import('./dayRepository')
    await days.saveDay(id, 'First\nLocal addition', 'Thursday')
    const service = await setupMigration(doc('First'))
    service.registryUnavailable()
    await expect((await import('./oneDrive')).pushToOneDrive()).rejects.toThrow('Registry unavailable')
    await (await import('./oneDriveState')).updateOneDriveFilePath(graph.folder)
    service.registryAvailable()
    graph.texts.set('legacy', doc('First\nRemote addition'))
    await (await import('./oneDrive')).pushToOneDrive()
    expect(graph.texts.get(`file-${id}`)).toContain('First\nRemote addition\nLocal addition')
    expect((await days.getDay(id))?.contentMd).toBe('First\nRemote addition\nLocal addition')
  })
  it('creates the dedicated folder automatically from the old file and splits it by day without a manually entered folder', async () => {
    const source = doc('Today') + '\n\n' + doc('Previous', previous)
    const service = await setupMigration(source)
    service.setUnshared()
    graph.items.delete(graph.folder)
    await (await import('./oneDrive')).pullFromOneDrive()
    const state = await (await import('./oneDriveState')).getOneDriveState()
    expect(state.folderId).not.toBe(graph.folder)
    const destination = graph.items.get(state.folderId!)!
    expect(destination.name).toBe('Rivolo-notes-legacy')
    expect(destination.parentReference?.id).toBe('root')
    expect(state.filePath).toBe(state.folderId)
    expect(graph.texts.get('legacy')).toBe(source)
    expect(graph.counters.commits.sort()).toEqual([previous, id].sort())
    const inventory = await (await import('./oneDriveGraph')).inventoryDays(state.folderId!)
    expect([...inventory.keys()].sort()).toEqual([previous, id].sort())
  })
  it('recognizes a verified SharePoint owner and uses the saved dedicated folder', async () => {
    const service = await setupMigration(doc('Today'))
    service.setDrive('personal-drive')
    const states = await import('./oneDriveState')
    await states.updateOneDriveState({ migrationSource: '/drives/drive/items/legacy', migrationStatus: 'blocked' })
    await states.updateOneDriveFilePath(graph.folder)
    graph.items.get(graph.folder)!.name = 'My chosen Rivolo folder'
    await (await import('./oneDrive')).pullFromOneDrive()
    expect((await states.getOneDriveState()).folderId).toBe(graph.folder)
    expect(graph.fetch.mock.calls.some(([, init]) => init?.method === 'POST' && String(init.body).includes('Rivolo-notes-legacy'))).toBe(false)
  })
  it('copies only missing existing recipients without notifications, then verifies matching access before copying notes', async () => {
    const service = await setupMigration(doc('Today'))
    service.setMissingRecipient()
    await (await import('./oneDrive')).pullFromOneDrive()
    expect(service.grants).toEqual([{ recipients: [{ objectId: 'existing-reader' }], roles: ['write'], requireSignIn: true, sendInvitation: false, retainInheritedPermissions: true }])
    expect(graph.counters.commits).toEqual([id])
  })
  it('migrates before syncing, preserves the original file and authors, and replaces the target with the verified folder', async () => {
    const source = await writeNotebookAuthors(doc('First'), new Map([[id, ['Bob']]]))
    await (await import('./dayRepository')).saveDay(id, 'First\nLocal addition', 'Thursday')
    const service = await setupMigration(source)
    const sync = await import('./oneDrive')
    await sync.pushToOneDrive()
    const state = await (await import('./oneDriveState')).getOneDriveState()
    expect(state).toMatchObject({ folderId: graph.folder, filePath: graph.folder, migrationStatus: 'complete', mergeBaseContent: null })
    expect(graph.texts.get('legacy')).toBe(source)
    expect(graph.texts.get(`file-${id}`)).toContain('First\nLocal addition')
    expect((await readNotebookAuthors(graph.texts.get(`file-${id}`)!)).get(id)).toEqual(['Bob', 'Alice'])
    expect(service.requests.map((request) => (request as { action: string }).action)).toEqual(['lookup', 'claim', 'complete'])
  })
  it('stays on the legacy target without uploads when the registry is unavailable or permissions would broaden access', async () => {
    await (await import('./dayRepository')).saveDay(id, 'First', 'Thursday')
    const service = await setupMigration(doc('First'))
    service.registryUnavailable()
    await expect((await import('./oneDrive')).pushToOneDrive()).rejects.toThrow('Registry unavailable')
    expect(graph.counters.commits).toEqual([])
    expect(await (await import('./oneDriveState')).getOneDriveState()).toMatchObject({ filePath: '/notes.md', migrationStatus: 'blocked' })
  })
  it('blocks unknown or wider sharing without sending an invitation or copying note text', async () => {
    await (await import('./dayRepository')).saveDay(id, 'First', 'Thursday')
    const service = await setupMigration(doc('First'))
    service.denyPermissions()
    await expect((await import('./oneDrive')).pushToOneDrive()).rejects.toThrow('same recipients')
    expect(graph.counters.commits).toEqual([])
    expect(service.requests).toHaveLength(1)
  })
  it('preserves both ambiguous copies and waits for an explicit choice instead of overwriting either', async () => {
    await (await import('./dayRepository')).saveDay(id, 'My separate notes', 'Thursday')
    await setupMigration(doc('Remote notes'), null)
    await expect((await import('./oneDrive')).pushToOneDrive()).rejects.toThrow('without a shared baseline')
    expect(graph.counters.commits).toEqual([])
    expect((await (await import('./dayRepository')).getDay(id))?.contentMd).toBe('My separate notes')
    expect(graph.texts.get('legacy')).toContain('Remote notes')
    await (await import('./oneDrive')).pushToOneDrive(true)
    expect(graph.texts.get(`file-${id}`)).toContain('My separate notes')
  })
  it('resumes copied days after failure without re-uploading successful checkpoints', async () => {
    const source = doc('First') + '\n\n' + doc('Yesterday', previous)
    const days = await import('./dayRepository')
    await days.saveDay(id, 'First', 'Thursday'); await days.saveDay(previous, 'Yesterday', 'Thursday')
    await setupMigration(source)
    graph.setFailure(previous)
    await expect((await import('./oneDrive')).pushToOneDrive()).rejects.toThrow('500')
    expect(graph.counters.commits).toEqual([id])
    expect((await (await import('./oneDriveState')).getOneDriveState()).migrationStatus).toBe('blocked')
    graph.setFailure(null)
    await (await import('./oneDrive')).pushToOneDrive()
    expect(graph.counters.commits).toEqual([id, previous])
    expect((await (await import('./oneDriveState')).getOneDriveState()).migrationStatus).toBe('complete')
  })
  it('does not resurrect unchanged legacy days deleted after another device completed migration', async () => {
    const source = doc('First') + '\n\n' + doc('Yesterday', previous)
    const days = await import('./dayRepository')
    await days.saveDay(id, 'First', 'Thursday'); await days.saveDay(previous, 'Yesterday', 'Thursday')
    const service = await setupMigration(source)
    service.setCompleted()
    graph.addDay(id, doc('First\nA later remote edit'), 'v2')
    await (await import('./oneDrive')).pushToOneDrive()
    expect((await days.getDay(id))?.contentMd).toBe('First\nA later remote edit')
    expect(await days.getDay(previous)).toBeNull()
    expect(graph.counters.commits).toEqual([])
  })
  it('preserves local changes made during a copy and completes with them on retry', async () => {
    const days = await import('./dayRepository')
    await days.saveDay(id, 'First', 'Thursday')
    await setupMigration(doc('First'))
    graph.afterBytes(async () => { await days.saveDay(id, 'First\nTyped during migration', 'Thursday') })
    await expect((await import('./oneDrive')).pushToOneDrive()).rejects.toThrow('Notes changed during migration')
    expect((await days.getDay(id))?.contentMd).toBe('First\nTyped during migration')
    await (await import('./oneDrive')).pushToOneDrive()
    expect(graph.texts.get(`file-${id}`)).toContain('Typed during migration')
  })
})
