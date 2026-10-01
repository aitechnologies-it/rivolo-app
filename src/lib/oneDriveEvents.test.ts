import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authorizedOneDriveFetch } from './oneDriveAuth'
vi.mock('./oneDriveAuth', () => ({ authorizedOneDriveFetch: vi.fn() }))

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 1
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => this.onclose?.())
  constructor(public url: URL) { Socket.instances.push(this) }
  receive(event: object) { this.onmessage?.({ data: JSON.stringify(event) }) }
}
let stop: (() => void) | undefined
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  localStorage.clear()
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  vi.mocked(authorizedOneDriveFetch).mockReset().mockImplementation(async () => Response.json({ ticket: 'encrypted-ticket' }))
})
afterEach(() => { stop?.(); stop = undefined; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('refreshes on ready and distinct file events, with no idle file polling', async () => {
  const { startOneDriveEvents } = await import('./oneDriveEvents')
  const changed = vi.fn()
  stop = startOneDriveEvents('/drives/d/items/f', changed, vi.fn())
  await vi.advanceTimersByTimeAsync(0)
  const socket = Socket.instances[0]
  expect(socket.url.protocol).toBe('ws:')
  socket.receive({ type: 'ready' })
  const event = { type: 'changed', revision: '/drives/d/items/f:v2', sender: 'another-client' }
  socket.receive(event)
  socket.receive(event)
  socket.receive({ ...event, revision: '/drives/d/items/other:v3' })
  expect(changed).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(50_000)
  expect(authorizedOneDriveFetch).toHaveBeenCalledTimes(1)
  expect(socket.send).toHaveBeenCalledWith('ping')
  socket.close()
  await vi.advanceTimersByTimeAsync(1000)
  expect(Socket.instances).toHaveLength(2)
  Socket.instances[1].receive({ type: 'ready' })
  expect(changed).toHaveBeenCalledTimes(3)
  stop()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(Socket.instances).toHaveLength(2)
})

it('retries a failed event independently from the uploaded notebook', async () => {
  const { publishOneDriveChange } = await import('./oneDriveEvents')
  vi.mocked(authorizedOneDriveFetch).mockRejectedValueOnce(new Error('offline'))
  publishOneDriveChange('/drives/d/items/f', '/drives/d/items/f:v2')
  await vi.advanceTimersByTimeAsync(0)
  expect(localStorage.getItem('rivolo.onedrive.events.outbox')).toContain('v2')
  await vi.advanceTimersByTimeAsync(2000)
  expect(authorizedOneDriveFetch).toHaveBeenCalledTimes(2)
  expect(localStorage.getItem('rivolo.onedrive.events.outbox')).toBe('[]')
})
