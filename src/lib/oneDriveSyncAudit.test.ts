// @vitest-environment node
// Regression tests for the defects found in the OneDrive daily sync audit
// (2026-11-12), plus request and database-save budgets for common passes.
import 'fake-indexeddb/auto'
import initSqlite from '@sqlite.org/sqlite-wasm'
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ensureDatabaseSchema, executeSql, openSerializedDatabase, queryRows, type RivoloDatabase, type RivoloSqlite, type SqlParam } from './sqliteRuntime'
import { createGraphFixture } from '../test/oneDriveGraphFixture'
import { encodeNotebookDay } from './notebookDays'
import { mergeOneDriveLines } from './oneDriveMerge'

const dbMock = vi.hoisted(() => ({ db: null as RivoloDatabase | null, persists: 0 }))
vi.mock('./db', () => ({
  run: async (sql: string, params: SqlParam[] = []) => executeSql(dbMock.db!, sql, params),
  queryAll: async (sql: string, params: SqlParam[] = []) => queryRows(dbMock.db!, sql, params),
  queryOne: async (sql: string, params: SqlParam[] = []) => queryRows(dbMock.db!, sql, params)[0] ?? null,
  isFtsAvailable: async () => false, upsertFts: async () => {},
  runAtomicDatabaseMutation: async (fn: (db: RivoloDatabase) => unknown, options: { onCommit?: (result: unknown) => void } = {}) => {
    let result: unknown
    dbMock.db!.transaction(() => { result = fn(dbMock.db!) })
    options.onCommit?.(result)
    return result
  },
  getDatabase: async () => dbMock.db!,
  registerDayDraftRecoveryHandler: () => {}, markNewDayForRecovery: () => {},
  getPendingDayDraft: () => null, getPendingDayDraftIds: () => [],
  getCommittedDayDraftGeneration: () => 0, isDayDraftGenerationStale: () => false,
  acknowledgePendingDayDraft: () => {},
  // In the app this serializes the whole SQLite database into IndexedDB.
  flushDatabaseSave: async () => { dbMock.persists += 1 },
  runBulkDatabaseMutation: async (fn: () => Promise<unknown>) => fn(),
  runDatabaseTransaction: async (fn: () => Promise<unknown>) => fn(),
}))
vi.mock('./oneDriveAuth', () => ({ authorizedOneDriveFetch: (url: string, init?: RequestInit) => fetch(url, init), disconnectOneDriveAuth: vi.fn() }))
vi.mock('./oneDriveEvents', () => ({ flushDailyOneDriveEvents: vi.fn() }))
// Real rollback backups (fake IndexedDB), so retention is the app's own.
vi.mock('./importExport', async (original) => ({
  ...(await original<typeof import('./importExport')>()),
  exportMarkdownFromDb: async () => (await import('./markdown')).exportMarkdown(await (await import('./dayRepository')).listAllDays()),
}))

let sqlite: RivoloSqlite
let graph: ReturnType<typeof createGraphFixture>
const id = '2026-10-01', previous = '2026-09-30'
const doc = (contentMd: string, dayId = id) => encodeNotebookDay({ dayId, humanTitle: 'Thursday', contentMd })
beforeAll(async () => { sqlite = await initSqlite() })
beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('indexedDB', new IDBFactory())
  dbMock.db = openSerializedDatabase(sqlite)
  dbMock.persists = 0
  ensureDatabaseSchema(dbMock.db)
  graph = createGraphFixture()
  vi.stubGlobal('fetch', graph.fetch)
  await (await import('./oneDriveState')).updateOneDriveState({ connected: true, accountId: 'alice', accountName: 'Alice', filePath: '/Rivolo', folderId: graph.folder, migrationStatus: 'complete' })
})
afterEach(() => { dbMock.db?.close(); vi.unstubAllGlobals() })

const days = () => import('./dayRepository')
const sync = () => import('./oneDrive')
const target = async () => (await import('./oneDriveDailyState')).targetFromState(await (await import('./oneDriveState')).getOneDriveState())!
const baseline = async (content: string, dayId = id) => {
  const item = graph.addDay(dayId, content)
  const { decodeNotebookDay } = await import('./notebookDays')
  const day = decodeNotebookDay(content, dayId)
  await (await days()).saveDay(dayId, day.contentMd, day.humanTitle)
  const daily = await import('./oneDriveDailyState')
  await daily.writeDailyState(await target(), { dayId, item: `/drives/drive/items/${item.id}`, eTag: item.eTag, baseline: content,
    uploadedHash: await (await import('./syncHash')).hashSyncContent(content), localRevision: (await daily.getDayChange(dayId)).revision, deleted: false })
}
const graphCalls = () => graph.fetch.mock.calls
  .filter(([url]) => String(url).startsWith('https://graph.microsoft.com'))
  .map(([url, init]) => `${init?.method ?? 'GET'} ${String(url).replace('https://graph.microsoft.com/v1.0', '')}`)

describe('data-affecting defects', () => {
  it('line merge keeps one copy when this device already uploaded a line and then added another', () => {
    // base: last checkpoint. remote: our own upload whose checkpoint was lost.
    expect(mergeOneDriveLines('First', 'First\nX\nY', 'First\nX')).toBe('First\nX\nY')
  })

  it('does not duplicate text after an upload whose response was lost', async () => {
    await baseline(doc('First'))
    await (await days()).saveDay(id, 'First\nX')
    let drop = true
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await graph.fetch(input, init)
      // The commit reaches OneDrive; the connection drops before the reply.
      if (drop && String(input).startsWith('https://graph.microsoft.com') && init?.method === 'PUT') { drop = false; throw new TypeError('Failed to fetch') }
      return response
    }))
    await expect((await sync()).pushToOneDrive()).rejects.toThrow()
    expect(graph.texts.get(`file-${id}`)).toContain('First\nX')
    await (await days()).saveDay(id, 'First\nX\nY')
    await (await sync()).pushToOneDrive()
    expect((await (await days()).getDay(id))?.contentMd).toBe('First\nX\nY')
  })

  it('deleting a blank local day does not delete a collaborator’s day this device never downloaded', async () => {
    await (await days()).ensureDay(id)
    graph.addDay(id, doc('Bob wrote this'))
    await (await days()).deleteDay(id)
    await (await sync()).pushToOneDrive().catch(() => undefined)
    expect(graph.texts.get(`file-${id}`) ?? 'deleted from OneDrive').toContain('Bob wrote this')
  })

  it('keeps local days when the notebook folder itself is gone or no longer accessible', async () => {
    await baseline(doc('Keep me'))
    graph.items.clear() // Graph answers 404 for the folder and everything in it.
    await (await sync()).pullFromOneDrive({ dayIds: [id] }).catch(() => undefined)
    expect((await (await days()).getDay(id))?.contentMd).toBe('Keep me')
  })

  it('a forced download of 12 changed days keeps the full-notebook backup it took first', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
    for (const day of ids) { await baseline(doc('Mine', day), day); graph.addDay(day, doc('Cloud', day), 'v2') }
    await (await sync()).pullFromOneDrive({ force: true })
    const backups = await (await import('./importExport')).listRollbackBackups()
    expect(backups.some((backup) => backup.dayCount === 12)).toBe(true)
  })
})

describe('false or stuck sync errors', () => {
  it('a day deferred by a push is not reported as moved when another day’s event is pulled', async () => {
    await baseline(doc('Today'))
    await baseline(doc('History', previous), previous)
    await (await days()).saveDay(previous, 'History\nmore')
    const unregister = (await import('./pendingEditorSaves')).registerPendingEditorSaves(() => [previous])
    await (await sync()).pushToOneDrive() // Still typing in `previous`: deferred.
    unregister()
    graph.addDay(id, doc('Remote edit'), 'v2')
    await (await sync()).pullFromOneDrive({ dayIds: [id] }) // rejects: "2026-09-30: file moved or renamed"
  })

  it('clears a day’s error once the invalid remote file is removed', async () => {
    graph.addDay(id, 'A file someone dropped in the folder, with no day marker')
    await expect((await sync()).pullFromOneDrive()).rejects.toThrow('valid day marker')
    graph.items.delete(`/drives/drive/items/file-${id}`)
    await (await sync()).pullFromOneDrive() // rejects forever with the same message
  })

  it('one file with an impossible date does not block downloading every other day', async () => {
    graph.addDay(previous, doc('Yesterday', previous))
    graph.addFolder('month-2026-02', '02', 'year-2026')
    graph.items.set('/drives/drive/items/stray', { id: 'stray', name: '2026-02-30.md', eTag: 'v1', file: {}, parentReference: { driveId: 'drive', id: 'month-2026-02' } })
    await (await sync()).pullFromOneDrive().catch(() => undefined)
    expect((await (await days()).getDay(previous))?.contentMd).toBe('Yesterday')
  })
})

describe('days created on two synced devices', () => {
  // A first sync against unknown, different cloud days stays blocked. This is
  // the narrower case of a device that had already downloaded the whole
  // notebook once: both sides created the day since, so the copies merge.
  it('merges a day created on two already-synced devices instead of asking which copy to discard', async () => {
    await baseline(doc('History', previous), previous)
    await (await sync()).pullFromOneDrive()
    expect((await (await sync()).getOneDriveStatus()).offlineReady).toBe(true)
    await (await days()).saveDay(id, 'Alice, written offline', 'Thursday')
    graph.addDay(id, doc('Bob, written meanwhile'))
    await (await sync()).pushToOneDrive() // rejects: "different notes without a shared baseline"
    expect(graph.texts.get(`file-${id}`)).toContain('Bob, written meanwhile\nAlice, written offline')
  })
})

describe('request and write budgets', () => {
  it('editing a day that already exists in OneDrive does not look up its year and month folders', async () => {
    await baseline(doc('Before'))
    await (await days()).saveDay(id, 'After')
    graph.fetch.mockClear()
    await (await sync()).pushToOneDrive()
    expect(graphCalls().filter((call) => /:\/(2026|10)$/.test(call))).toEqual([])
  })

  it('measures one edit of an existing day: 4 Graph requests, 2 upload requests and 3 full database saves', async () => {
    await baseline(doc('Before'))
    await (await days()).saveDay(id, 'After')
    graph.fetch.mockClear()
    dbMock.persists = 0
    await (await sync()).pushToOneDrive()
    expect(graphCalls()).toEqual([
      'GET /drives/drive/items/notebook:/2026/10/2026-10-01.md',
      'GET /drives/drive?$select=driveType',
      'POST /drives/drive/items/file-2026-10-01/createUploadSession',
      'PUT /drives/drive/items/file-2026-10-01',
    ])
    expect(graph.fetch.mock.calls.filter(([url]) => String(url).startsWith('https://upload.test')).map(([, init]) => init?.method)).toEqual(['PUT', 'DELETE'])
    expect(dbMock.persists).toBe(3)
  })

  it('measures an unchanged three-year notebook: 40 Graph requests per full check, month listings in parallel', async () => {
    for (const year of ['2024', '2025', '2026']) for (let month = 1; month <= 12; month++) {
      const day = `${year}-${String(month).padStart(2, '0')}-01`
      await baseline(doc('Note', day), day)
    }
    graph.fetch.mockClear()
    expect(await (await sync()).pullFromOneDrive()).toEqual({ status: 'noop' })
    expect(graphCalls()).toHaveLength(1 + 3 + 36)
    expect(graph.counters.downloads).toEqual([])
  })

  it('an unchanged full check does not save the database again for days deleted long ago', async () => {
    await baseline(doc('Delete me'))
    await (await days()).deleteDay(id)
    await (await sync()).pushToOneDrive()
    dbMock.persists = 0
    expect(await (await sync()).pullFromOneDrive()).toEqual({ status: 'noop' })
    expect(dbMock.persists).toBe(0)
  })
})
