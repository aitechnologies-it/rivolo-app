import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import assert from 'node:assert/strict'

const { outputFiles } = await build({ entryPoints: ['workers/onedrive-events/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' })
const runtime = new Miniflare({ workers: [
  { name: 'pages', modules: true, compatibilityDate: '2026-06-21', script: `export default { fetch(request, env) {
    const room = env.ONEDRIVE_EVENTS.get(env.ONEDRIVE_EVENTS.idFromName(request.headers.get('X-Room')));
    return room.fetch(new Request('https://channel' + new URL(request.url).pathname, request));
  } }`, durableObjects: { ONEDRIVE_EVENTS: { className: 'OneDriveEvents', scriptName: 'events' } } },
  { name: 'events', modules: true, script: outputFiles[0].text, compatibilityDate: '2026-06-21',
    durableObjects: { ONEDRIVE_EVENTS: { className: 'OneDriveEvents', useSQLite: true } } },
] })
const sockets = []
try {
  const rooms = await runtime.getDurableObjectNamespace('ONEDRIVE_EVENTS', 'events')
  const room = rooms.get(rooms.idFromName('runtime-notebook'))
  const other = rooms.get(rooms.idFromName('other-notebook'))
  const connect = async (name, sender) => {
    const response = await runtime.dispatchFetch('http://pages/connect', { headers: { Upgrade: 'websocket', 'X-Sender': sender, 'X-Room': name } })
    assert.equal(response.status, 101)
    const socket = response.webSocket
    const messages = []
    socket.addEventListener('message', (event) => messages.push(JSON.parse(event.data)))
    socket.accept()
    sockets.push(socket)
    return { socket, messages }
  }
  const writer = await connect('runtime-notebook', 'writer')
  const reader = await connect('runtime-notebook', 'reader')
  const isolated = await connect('other-notebook', 'reader')
  const publish = (item) => room.fetch('https://channel/publish', { method: 'POST',
    body: JSON.stringify({ type: 'day-changed', dayId: item === 'a' ? '2026-10-01' : '2026-10-02', item, revision: 'opaque-etag', sender: 'writer' }) })
  await publish('a'); await publish('b'); await publish('a')
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(writer.messages.filter((event) => event.type === 'day-changed').length, 0)
  assert.equal(reader.messages.filter((event) => event.type === 'day-changed').length, 2)
  assert.equal(isolated.messages.filter((event) => event.type === 'day-changed').length, 0)
  assert.equal(reader.messages[0].type, 'ready')
  const registry = rooms.get(rooms.idFromName('migration-registry'))
  const request = (action, body) => registry.fetch(`https://channel/migration/${action}`, { method: 'POST', body: JSON.stringify(body) })
  const claim = await (await request('claim', { destination: '/drives/d/items/f' })).json()
  assert.equal((await request('claim', { destination: '/drives/d/items/other' })).status, 409)
  assert.equal((await request('complete', { ...claim, generation: claim.generation - 1 })).status, 409)
  assert.equal((await request('complete', claim)).status, 200)
  assert.equal((await (await registry.fetch('https://channel/migration/lookup')).json()).status, 'complete')
  assert.equal((await other.fetch('https://channel/health')).status, 204)
  console.log('Cloudflare local runtime: external Worker binding, folder isolation, ready, per-item deduplication and migration generation checks passed.')
} finally {
  for (const socket of sockets) socket.close()
  await runtime.dispose()
}
