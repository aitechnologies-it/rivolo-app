import { decryptToken, encryptToken, jsonResponse, validateMutationRequest } from '../../_lib/tokenCookie'
import { oneDriveAllowedOrigins, type OneDriveOAuthEnv } from '../../_lib/oneDriveOAuth'
import { address, graphMetadata, roomName, validItem, verifyDayMembership } from '../../_lib/oneDriveNotebook'
import { relayFetch } from '../../_lib/oneDriveRelay'

type Env = OneDriveOAuthEnv & { ONEDRIVE_EVENTS: DurableObjectNamespace }
const ticketKey = (env: Env) => `onedrive-daily-events-v1:${env.ONEDRIVE_TOKEN_ENCRYPTION_KEY}`
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const invalid = validateMutationRequest(request, oneDriveAllowedOrigins(env))
  if (invalid) return jsonResponse({ message: invalid }, 403)
  if (!env.ONEDRIVE_EVENTS || !env.ONEDRIVE_TOKEN_ENCRYPTION_KEY) return jsonResponse({ message: 'OneDrive daily event service is not configured.' }, 503)
  const body = await request.json().catch(() => null) as { folder?: unknown; item?: unknown; action?: unknown; sender?: unknown; revision?: unknown } | null
  if (!body || !validItem(body.folder) || !['subscribe', 'publish', 'invalidate'].includes(String(body.action)) ||
      typeof body.sender !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.sender)) return jsonResponse({ message: 'Invalid daily event request.' }, 400)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ') || authorization.length > 16_384) return jsonResponse({ message: 'OneDrive authorization required.' }, 401)
  try {
    const folder = await graphMetadata(body.folder, authorization)
    if (!folder.folder) return jsonResponse({ message: 'A notebook folder is required.' }, 400)
    const room = await roomName(`daily:${address(folder)}`)
    const channel = env.ONEDRIVE_EVENTS.get(env.ONEDRIVE_EVENTS.idFromName(room))
    if (body.action === 'subscribe') {
      await relayFetch(channel, '/health')
      const ticket = await encryptToken(JSON.stringify({ room, sender: body.sender, expires: Date.now() + 60_000 }), ticketKey(env))
      return jsonResponse({ ticket })
    }
    if (body.action === 'invalidate') {
      if (typeof body.revision !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.revision)) return jsonResponse({ message: 'Invalid inventory event.' }, 400)
      return await relayFetch(channel, '/publish', { method: 'POST', body: JSON.stringify({ type: 'inventory-invalidated', revision: body.revision, sender: body.sender }) })
    }
    if (!validItem(body.item)) return jsonResponse({ message: 'A daily file is required.' }, 400)
    let item
    try { item = await graphMetadata(body.item, authorization) }
    catch (error) {
      // A durable notification may outlive its uploaded file. The caller has
      // already proved folder access; request an inventory recovery instead.
      if (!(error instanceof Response) || error.status !== 404) throw error
      return await relayFetch(channel, '/publish', { method: 'POST', body: JSON.stringify({ type: 'inventory-invalidated', revision: `missing:${body.item}`, sender: '' }) })
    }
    const dayId = await verifyDayMembership(folder, item, authorization)
    if (!dayId || !item.eTag) return jsonResponse({ message: 'This file is outside the notebook day hierarchy.' }, 403)
    return await relayFetch(channel, '/publish', { method: 'POST', body: JSON.stringify({ type: 'day-changed', dayId, item: address(item), revision: item.eTag, sender: body.revision === item.eTag ? body.sender : '' }) })
  } catch (error) {
    const response = error instanceof Response ? error : null
    if (response?.status === 503 && response.headers.get('Content-Type')?.includes('application/json')) return response
    return jsonResponse({ message: 'Unable to verify OneDrive notebook access.' }, response && [400, 401, 403, 404].includes(response.status) ? response.status : 503,
      response?.headers.has('Retry-After') ? { 'Retry-After': response.headers.get('Retry-After')! } : {})
  }
}
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get('Origin')
  if (!origin || ![new URL(request.url).origin, ...oneDriveAllowedOrigins(env)].includes(origin)) return new Response('Forbidden', { status: 403 })
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 })
  if (!env.ONEDRIVE_EVENTS || !env.ONEDRIVE_TOKEN_ENCRYPTION_KEY) return new Response('Channel unavailable', { status: 503 })
  let payload: { room: string; sender: string; expires: number }
  try {
    const ticket = new URL(request.url).searchParams.get('ticket') ?? ''
    if (ticket.length > 2048) return new Response('Invalid ticket', { status: 401 })
    payload = JSON.parse(await decryptToken(ticket, ticketKey(env)) ?? '') as typeof payload
    if (!/^[a-f0-9]{64}$/.test(payload.room) || !/^[a-zA-Z0-9-]{1,64}$/.test(payload.sender) ||
        !Number.isFinite(payload.expires) || payload.expires < Date.now() || payload.expires > Date.now() + 60_000) return new Response('Expired ticket', { status: 401 })
  } catch { return new Response('Invalid ticket', { status: 401 }) }
  try {
    return await relayFetch(env.ONEDRIVE_EVENTS.get(env.ONEDRIVE_EVENTS.idFromName(payload.room)), '/connect', { headers: { Upgrade: 'websocket', 'X-Sender': payload.sender } })
  } catch (error) { return error instanceof Response ? error : new Response('Channel unavailable', { status: 503 }) }
}
