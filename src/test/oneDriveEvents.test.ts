// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet, onRequestPost } from '../../functions/api/onedrive/events'

const stubFetch = vi.fn(async () => new Response(null, { status: 204 }))
const idFromName = vi.fn((name: string) => name)
const env = {
  ONEDRIVE_TOKEN_ENCRYPTION_KEY: 'test-only-key',
  ONEDRIVE_EVENTS: { idFromName, get: () => ({ fetch: stubFetch }) },
}
const post = (action = 'subscribe', origin = 'https://rivolo.test', revision = '/drives/drive/items/file:v1') => onRequestPost({ env, request: new Request('https://rivolo.test/api/onedrive/events', {
  method: 'POST', headers: { Origin: origin, 'X-Requested-With': 'XmlHttpRequest', Authorization: 'Bearer access-secret' },
  body: JSON.stringify({ action, item: '/drives/drive/items/file', sender: 'client-1', revision }),
}) } as never) as Promise<Response>
const connect = (ticket: string) => onRequestGet({ env, request: new Request(`https://rivolo.test/api/onedrive/events?ticket=${encodeURIComponent(ticket)}`, {
  headers: { Origin: 'https://rivolo.test', Upgrade: 'websocket' },
}) } as never) as Promise<Response>
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers() })
const allow = () => vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'file', eTag: 'v1', file: {}, parentReference: { driveId: 'drive' } })))

describe('OneDrive event authorization', () => {
  it('checks Graph access and issues an encrypted, expiring room ticket', async () => {
    allow()
    const response = await post()
    const { ticket, revision } = await response.json()
    expect(revision).toBe('/drives/drive/items/file:v1')
    expect(ticket).not.toContain('access-secret')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('?$select=id,eTag,file,parentReference'), { headers: { Authorization: 'Bearer access-secret' } })
    expect((await connect(ticket)).status).toBe(204)
    expect(stubFetch).toHaveBeenCalledWith('https://channel/connect', { headers: { Upgrade: 'websocket', 'X-Sender': 'client-1' } })
    expect(idFromName).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/))
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 61_000)
    expect((await connect(ticket)).status).toBe(401)
    expect((await connect('tampered')).status).toBe(401)
  })

  it('does not authorize unauthorized accounts or foreign origins', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })))
    expect((await post()).status).toBe(403)
    expect((await post('subscribe', 'https://evil.test')).status).toBe(403)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(stubFetch).not.toHaveBeenCalled()
  })

  it('publishes only verified file metadata to the canonical room', async () => {
    allow()
    expect((await post('publish')).status).toBe(204)
    expect(stubFetch).toHaveBeenCalledWith('https://channel/publish', {
      method: 'POST', body: JSON.stringify({ type: 'changed', revision: '/drives/drive/items/file:v1', sender: 'client-1' }),
    })
  })

  it('also notifies the publisher if another upload overtook its revision', async () => {
    allow()
    await post('publish', 'https://rivolo.test', '/drives/drive/items/file:older')
    expect(stubFetch).toHaveBeenCalledWith('https://channel/publish', {
      method: 'POST', body: JSON.stringify({ type: 'changed', revision: '/drives/drive/items/file:v1', sender: '' }),
    })
  })
})
