import { decryptToken, encryptToken, jsonResponse, validateMutationRequest } from '../../_lib/tokenCookie'
import { oneDriveAllowedOrigins, type OneDriveOAuthEnv } from '../../_lib/oneDriveOAuth'

type Env = OneDriveOAuthEnv & { ONEDRIVE_EVENTS: DurableObjectNamespace }
const ticketKey = (env: Env) => `onedrive-events-v1:${env.ONEDRIVE_TOKEN_ENCRYPTION_KEY}`
const validItem = (value: unknown): value is string => typeof value === 'string' &&
  /^\/drives\/[A-Za-z0-9!_%.-]+\/items\/[A-Za-z0-9!_%.-]+$/.test(value) && value.length < 1024

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const invalid = validateMutationRequest(request, oneDriveAllowedOrigins(env))
  if (invalid) return jsonResponse({ message: invalid }, 403)
  if (!env.ONEDRIVE_EVENTS || !env.ONEDRIVE_TOKEN_ENCRYPTION_KEY) return jsonResponse({ message: 'OneDrive event channel is not configured.' }, 503)
  const body = await request.json().catch(() => null) as { item?: unknown; action?: unknown; sender?: unknown; revision?: unknown } | null
  if (!body || !validItem(body.item) || !['subscribe', 'publish'].includes(String(body.action)) ||
      typeof body.sender !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.sender)) return jsonResponse({ message: 'Invalid event request.' }, 400)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ') || authorization.length > 16_384) return jsonResponse({ message: 'OneDrive authorization required.' }, 401)

  // Verify this account can access the actual item; sharing links and owner paths
  // converge on the same drive/item pair. The server never downloads note text.
  const metadata = await fetch(`https://graph.microsoft.com/v1.0${body.item}?$select=id,eTag,file,parentReference`, {
    headers: { Authorization: authorization },
  })
  if (!metadata.ok) return jsonResponse({ message: 'Unable to authorize the OneDrive event channel.' },
    metadata.status === 401 || metadata.status === 403 || metadata.status === 404 ? metadata.status : 503,
    metadata.headers.has('Retry-After') ? { 'Retry-After': metadata.headers.get('Retry-After')! } : {})
  const item = await metadata.json() as { id?: string; eTag?: string; file?: object; parentReference?: { driveId?: string } }
  if (!item.id || !item.parentReference?.driveId || !item.file || !item.eTag) return jsonResponse({ message: 'A OneDrive file is required.' }, 400)
  const canonicalItem = `/drives/${encodeURIComponent(item.parentReference.driveId)}/items/${encodeURIComponent(item.id)}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalItem))
  const room = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const revision = `${canonicalItem}:${item.eTag}`
  if (body.action === 'publish') {
    // Another writer may have uploaded between this caller's upload and the
    // access check. In that case the caller must receive the newer revision too.
    const sender = body.revision === revision ? body.sender : ''
    return env.ONEDRIVE_EVENTS.get(env.ONEDRIVE_EVENTS.idFromName(room)).fetch('https://channel/publish', {
      method: 'POST', body: JSON.stringify({ type: 'changed', revision, sender }),
    })
  }
  const ticket = await encryptToken(JSON.stringify({ room, sender: body.sender, expires: Date.now() + 60_000 }), ticketKey(env))
  return jsonResponse({ ticket, revision })
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get('Origin')
  if (!origin || ![new URL(request.url).origin, ...oneDriveAllowedOrigins(env)].includes(origin)) return new Response('Forbidden', { status: 403 })
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 })
  if (!env.ONEDRIVE_EVENTS || !env.ONEDRIVE_TOKEN_ENCRYPTION_KEY) return new Response('Channel unavailable', { status: 503 })
  try {
    const ticket = new URL(request.url).searchParams.get('ticket') ?? ''
    if (ticket.length > 2048) return new Response('Invalid ticket', { status: 401 })
    const decoded = await decryptToken(ticket, ticketKey(env))
    const payload = JSON.parse(decoded ?? '') as { room: string; sender: string; expires: number }
    if (!/^[a-f0-9]{64}$/.test(payload.room) || !/^[a-zA-Z0-9-]{1,64}$/.test(payload.sender) ||
        !Number.isFinite(payload.expires) || payload.expires < Date.now() || payload.expires > Date.now() + 60_000) {
      return new Response('Expired ticket', { status: 401 })
    }
    return env.ONEDRIVE_EVENTS.get(env.ONEDRIVE_EVENTS.idFromName(payload.room)).fetch('https://channel/connect', {
      headers: { Upgrade: 'websocket', 'X-Sender': payload.sender },
    })
  } catch { return new Response('Invalid ticket', { status: 401 }) }
}
