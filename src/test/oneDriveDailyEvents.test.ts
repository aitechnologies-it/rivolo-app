// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet, onRequestPost } from '../../functions/api/onedrive/daily-events'
import { createGraphFixture } from './oneDriveGraphFixture'
import { encodeNotebookDay } from '../lib/notebookDays'

const relay = vi.fn(async () => new Response(null, { status: 204 }))
const env = { ONEDRIVE_TOKEN_ENCRYPTION_KEY: 'test-only-key', ONEDRIVE_EVENTS: { idFromName: (value: string) => value, get: () => ({ fetch: relay }) } }
const post = (body: object, origin = 'https://rivolo.test') => onRequestPost({ env, request: new Request('https://rivolo.test/api/onedrive/daily-events', {
  method: 'POST', headers: { Origin: origin, 'X-Requested-With': 'XmlHttpRequest', Authorization: 'Bearer test-token' },
  body: JSON.stringify({ folder: '/drives/drive/items/notebook', sender: 'alice', ...body }),
}) } as never) as Promise<Response>
const connect = (ticket: string) => onRequestGet({ env, request: new Request(`https://rivolo.test/api/onedrive/daily-events?ticket=${encodeURIComponent(ticket)}`, {
  headers: { Origin: 'https://rivolo.test', Upgrade: 'websocket' },
}) } as never) as Promise<Response>
let graph: ReturnType<typeof createGraphFixture>
beforeEach(() => { relay.mockReset(); relay.mockResolvedValue(new Response(null, { status: 204 })); graph = createGraphFixture(); vi.stubGlobal('fetch', graph.fetch) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('folder event authorization', () => {
  it('turns a delayed event for a deleted file into an inventory recovery, while retaining folder access checks', async () => {
    const response = await post({ action: 'publish', item: '/drives/drive/items/deleted-file', revision: 'v1' })
    expect(response.status).toBe(204)
    expect(JSON.parse(relay.mock.calls[0][1]!.body as string)).toMatchObject({ type: 'inventory-invalidated', sender: '' })
    graph.items.delete(graph.folder)
    expect((await post({ action: 'publish', item: '/drives/drive/items/deleted-file' })).status).toBe(404)
  })
  it('does not issue tickets for an unavailable external Worker and distinguishes it from invalid tickets', async () => {
    relay.mockResolvedValueOnce(new Response('External Durable Object unavailable', { status: 503 }))
    const unavailable = await post({ action: 'subscribe' })
    expect(unavailable.status).toBe(503)
    expect((await unavailable.json()).message).toContain('npm run dev:cloud')
    const { ticket } = await (await post({ action: 'subscribe' })).json()
    relay.mockRejectedValueOnce(new Error('Worker not running'))
    const socket = await connect(ticket)
    expect(socket.status).toBe(503)
    expect((await socket.json()).message).toContain('registry are unavailable')
    expect((await connect('tampered')).status).toBe(401)
  })
  it('issues an encrypted folder ticket that expires and rejects tampering', async () => {
    const response = await post({ action: 'subscribe' })
    const { ticket } = await response.json()
    expect(ticket).not.toContain('test-token')
    expect((await connect(ticket)).status).toBe(204)
    expect((await connect(ticket + 'invalid')).status).toBe(401)
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 61_000)
    expect((await connect(ticket)).status).toBe(401)
  })
  it('walks the real parent hierarchy and emits only verified day metadata', async () => {
    graph.addDay('2026-10-01', encodeNotebookDay({ dayId: '2026-10-01', humanTitle: 'Title', contentMd: 'Private note' }))
    expect((await post({ action: 'publish', item: '/drives/drive/items/file-2026-10-01', revision: 'v1', dayId: 'wrong', authors: 'ignored' })).status).toBe(204)
    const emitted = JSON.parse(relay.mock.calls[0][1]!.body as string)
    expect(emitted).toEqual({ type: 'day-changed', dayId: '2026-10-01', item: '/drives/drive/items/file-2026-10-01', revision: 'v1', sender: 'alice' })
    expect(JSON.stringify(emitted)).not.toContain('Private note')
    expect(graph.counters.downloads).toEqual([])
  })
  it('rejects a file outside the folder and a mismatched month', async () => {
    const item = graph.addDay('2026-10-01', 'Private')
    item.parentReference.id = 'root'
    expect((await post({ action: 'publish', item: '/drives/drive/items/file-2026-10-01' })).status).toBe(403)
    expect(relay).not.toHaveBeenCalled()
  })
  it('notifies a publisher when the checked revision is newer and authorizes deletion invalidation on the folder', async () => {
    graph.addDay('2026-10-01', 'Private', 'v2')
    await post({ action: 'publish', item: '/drives/drive/items/file-2026-10-01', revision: 'v1' })
    expect(JSON.parse(relay.mock.calls[0][1]!.body as string).sender).toBe('')
    expect((await post({ action: 'invalidate', revision: 'delete-123' })).status).toBe(204)
    expect(JSON.parse(relay.mock.calls[1][1]!.body as string).type).toBe('inventory-invalidated')
  })
  it('denies unauthorized accounts, foreign origins, and file channels', async () => {
    expect((await post({ action: 'subscribe' }, 'https://evil.test')).status).toBe(403)
    graph.items.delete('/drives/drive/items/notebook')
    expect((await post({ action: 'subscribe' })).status).toBe(404)
    expect(relay).not.toHaveBeenCalled()
  })
})
