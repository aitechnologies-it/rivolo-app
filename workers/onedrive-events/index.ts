// Only a Pages Durable Object binding can reach these rooms. No public Worker
// endpoint accepts subscriptions or broadcasts.
export class OneDriveEvents {
  constructor(private readonly state: DurableObjectState) {
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request) {
    const path = new URL(request.url).pathname
    if (path === '/health') return new Response(null, { status: 204 })
    if (path.startsWith('/migration/')) {
      // Durable storage transactions serialize competing owners/devices. Once
      // assigned, a destination is immutable, including after lease expiry.
      type Migration = { destination: string; generation: number; lease: string; expires: number; status: 'running' | 'complete' }
      if (path === '/migration/lookup') return Response.json(await this.state.storage.get('migration') ?? {})
      const body = await request.json() as { destination: string; generation?: number; lease?: string }
      return this.state.storage.transaction(async (storage) => {
        const current = await storage.get<Migration>('migration')
        if (current && current.destination !== body.destination) return Response.json({ message: 'Migration destination is immutable.' }, { status: 409 })
        if (path === '/migration/claim') {
          if (current?.status === 'complete') return Response.json(current)
          if (current && current.expires > Date.now()) return Response.json({ message: 'Another device is migrating. Sync will retry when its lease expires.' }, { status: 409 })
          const next: Migration = { destination: body.destination, generation: (current?.generation ?? 0) + 1,
            lease: crypto.randomUUID(), expires: Date.now() + 60_000, status: 'running' }
          await storage.put('migration', next)
          return Response.json(next)
        }
        if (path === '/migration/complete' || path === '/migration/renew') {
          if (!current || current.generation !== body.generation || current.lease !== body.lease || current.expires <= Date.now()) {
            return Response.json({ message: 'Migration lease expired. Retry with the assigned destination.' }, { status: 409 })
          }
          const next = path === '/migration/renew' ? { ...current, expires: Date.now() + 60_000 } : { ...current, status: 'complete' as const }
          await storage.put('migration', next)
          return Response.json(next)
        }
        return new Response('Not found', { status: 404 })
      })
    }
    if (path === '/connect' && request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      const expires = Date.now() + 10 * 60_000
      server.serializeAttachment({ sender: request.headers.get('X-Sender'), expires })
      this.state.acceptWebSocket(server)
      const alarm = await this.state.storage.getAlarm()
      if (alarm === null || alarm > expires) await this.state.storage.setAlarm(expires)
      server.send(JSON.stringify({ type: 'ready' }))
      return new Response(null, { status: 101, webSocket: client })
    }
    if (path === '/publish' && request.method === 'POST') {
      const event = await request.json() as { type: string; revision: string; sender: string; item?: string }
      // Deduplicate retries even across hibernation; only validated server events
      // enter this endpoint, never messages sent by browser WebSockets.
      const dedupeKey = `revision:${event.item ?? event.type}`
      if (await this.state.storage.get(dedupeKey) !== event.revision) {
        const message = JSON.stringify(event)
        for (const socket of this.state.getWebSockets()) {
          const attachment = socket.deserializeAttachment() as { sender: string; expires: number }
          if (attachment.expires <= Date.now()) { socket.close(4001, 'Renew access'); continue }
          if (attachment.sender !== event.sender) {
            try { socket.send(message) } catch { socket.close(1011, 'Reconnect') }
          }
        }
        await this.state.storage.put(dedupeKey, event.revision)
      }
      return new Response(null, { status: 204 })
    }
    return new Response('Not found', { status: 404 })
  }

  webSocketMessage(socket: WebSocket) { socket.close(1008, 'Publish through the authenticated API') }
  webSocketClose(socket: WebSocket) { socket.close() }
  webSocketError(socket: WebSocket) { socket.close(1011, 'Reconnect') }

  async alarm() {
    let next = Infinity
    for (const socket of this.state.getWebSockets()) {
      const { expires } = socket.deserializeAttachment() as { expires: number }
      if (expires <= Date.now()) socket.close(4001, 'Renew access')
      else next = Math.min(next, expires)
    }
    if (Number.isFinite(next)) await this.state.storage.setAlarm(next)
  }
}

export default { fetch: () => new Response('Not found', { status: 404 }) }
