// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { OneDriveEvents } from '../../workers/onedrive-events'

afterEach(() => vi.unstubAllGlobals())

it('broadcasts once to other writers, expires access, and rejects browser publications', async () => {
  vi.stubGlobal('WebSocketRequestResponsePair', class {})
  const socket = (sender: string, expires = Date.now() + 60_000) => ({
    deserializeAttachment: () => ({ sender, expires }), send: vi.fn(), close: vi.fn(),
  })
  const writer = socket('alice'), reader = socket('bob'), expired = socket('eve', 0)
  const storage = new Map<string, string>()
  const setAlarm = vi.fn()
  const state = {
    setWebSocketAutoResponse: vi.fn(), getWebSockets: () => [writer, reader, expired],
    storage: { get: async (key: string) => storage.get(key), put: async (key: string, value: string) => storage.set(key, value), setAlarm },
  }
  const room = new OneDriveEvents(state as never)
  const publish = () => room.fetch(new Request('https://channel/publish', {
    method: 'POST', body: JSON.stringify({ type: 'changed', revision: 'v2', sender: 'alice' }),
  }))
  expect((await publish()).status).toBe(204)
  await publish()
  expect(writer.send).not.toHaveBeenCalled()
  expect(reader.send).toHaveBeenCalledTimes(1)
  expect(expired.send).not.toHaveBeenCalled()
  expect(expired.close).toHaveBeenCalledWith(4001, 'Renew access')
  room.webSocketMessage(reader as never)
  expect(reader.close).toHaveBeenCalledWith(1008, 'Publish through the authenticated API')
  await room.alarm()
  expect(setAlarm).toHaveBeenCalledWith(expect.any(Number))
})

it('deduplicates by item so two different days with the same opaque eTag both broadcast', async () => {
  vi.stubGlobal('WebSocketRequestResponsePair', class {})
  const reader = { deserializeAttachment: () => ({ sender: 'reader', expires: Date.now() + 60_000 }), send: vi.fn(), close: vi.fn() }
  const storage = new Map<string, string>()
  const room = new OneDriveEvents({ setWebSocketAutoResponse: vi.fn(), getWebSockets: () => [reader], storage: {
    get: async (key: string) => storage.get(key), put: async (key: string, value: string) => storage.set(key, value),
  } } as never)
  for (const item of ['day-a', 'day-b', 'day-a']) await room.fetch(new Request('https://channel/publish', { method: 'POST',
    body: JSON.stringify({ type: 'day-changed', item, revision: 'same-opaque-etag', sender: 'writer' }) }))
  expect(reader.send).toHaveBeenCalledTimes(2)
})

it('keeps the first migration destination immutable and refuses completion by an expired generation', async () => {
  vi.stubGlobal('WebSocketRequestResponsePair', class {})
  const values = new Map<string, unknown>()
  const storage = { get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => values.set(key, value) }
  const room = new OneDriveEvents({ setWebSocketAutoResponse: vi.fn(), storage: { ...storage, transaction: async (fn: (store: typeof storage) => Promise<Response>) => fn(storage) } } as never)
  const send = (action: string, body: object) => room.fetch(new Request(`https://channel/migration/${action}`, { method: 'POST', body: JSON.stringify(body) }))
  const first = await (await send('claim', { destination: '/drives/d/items/folder' })).json()
  expect((await send('claim', { destination: '/drives/other/items/unrelated' })).status).toBe(409)
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 61_000)
  const next = await (await send('claim', { destination: '/drives/d/items/folder' })).json()
  expect(next.generation).toBe(first.generation + 1)
  expect((await send('complete', { ...first })).status).toBe(409)
  expect((await send('complete', { ...next })).status).toBe(200)
  expect((await send('claim', { destination: '/drives/d/items/folder' })).status).toBe(200)
  vi.useRealTimers()
})
