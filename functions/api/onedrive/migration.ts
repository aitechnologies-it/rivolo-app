import { jsonResponse, validateMutationRequest } from '../../_lib/tokenCookie'
import { oneDriveAllowedOrigins, type OneDriveOAuthEnv } from '../../_lib/oneDriveOAuth'
import { GRAPH, address, graphMetadata, isDedicatedNotebookFolder, roomName, validItem, type GraphItem } from '../../_lib/oneDriveNotebook'
import { equivalentPermissions, canEstablishMigration, readPermissions } from '../../_lib/oneDrivePermissions'
import { relayFetch } from '../../_lib/oneDriveRelay'

type Env = OneDriveOAuthEnv & { ONEDRIVE_EVENTS: DurableObjectNamespace }
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const invalid = validateMutationRequest(request, oneDriveAllowedOrigins(env))
  if (invalid) return jsonResponse({ message: invalid }, 403)
  if (!env.ONEDRIVE_EVENTS) return jsonResponse({ message: 'OneDrive migration registry is unavailable. Notes remain on this device.' }, 503)
  const body = await request.json().catch(() => null) as { source?: unknown; destination?: unknown; action?: unknown; generation?: unknown; lease?: unknown } | null
  if (!body || !validItem(body.source) || !['lookup', 'claim', 'complete', 'renew'].includes(String(body.action))) return jsonResponse({ message: 'Invalid migration request.' }, 400)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ') || authorization.length > 16_384) return jsonResponse({ message: 'OneDrive authorization required.' }, 401)
  try {
    const source = await graphMetadata(body.source, authorization)
    if (!source.file || !source.name.toLowerCase().endsWith('.md')) return jsonResponse({ message: 'A Markdown migration source is required.' }, 400)
    const room = await roomName(`migration:${address(source)}`)
    const registry = env.ONEDRIVE_EVENTS.get(env.ONEDRIVE_EVENTS.idFromName(room))
    const lookup = await relayFetch(registry, '/migration/lookup')
    if (!lookup.ok) return lookup
    const current = await lookup.json() as { destination?: string; status?: string }
    if (current.destination) {
      const destination = await graphMetadata(current.destination, authorization)
      if (!destination.folder) return jsonResponse({ message: 'Migration folder is no longer available. Ask the owner to restore access.' }, 403)
    }
    if (body.action === 'lookup') return jsonResponse(current)
    // Verify authority in the original drive, including SharePoint libraries
    // with group owners. The destination must retain the exact source access.
    const ownDrive = await fetch(`${GRAPH}/me/drive?$select=id`, { headers: { Authorization: authorization } })
    const sourcePermissions = await readPermissions(address(source), authorization)
    const personalOwner = ownDrive.ok && (await ownDrive.json() as { id: string }).id === source.parentReference.driveId
    if (!personalOwner) {
      const me = await fetch(`${GRAPH}/me?$select=id`, { headers: { Authorization: authorization } })
      const drive = await fetch(`${GRAPH}/drives/${encodeURIComponent(source.parentReference.driveId)}?$select=driveType`, { headers: { Authorization: authorization } })
      if (!me.ok || !drive.ok || !canEstablishMigration(sourcePermissions, (await me.json() as { id: string }).id, (await drive.json() as { driveType: string }).driveType)) {
        return jsonResponse({ message: 'OneDrive migration needs verified owner access, or explicit edit access in the original SharePoint library. Check access to the original file and its parent folder; local notes remain available.' }, 403)
      }
    }
    if (!validItem(body.destination)) return jsonResponse({ message: 'A verified migration folder is required.' }, 400)
    const destination = await graphMetadata(body.destination, authorization)
    if (!destination.folder || destination.parentReference.driveId !== source.parentReference.driveId ||
        destination.parentReference.id !== source.parentReference.id || destination.id === source.parentReference.id) {
      return jsonResponse({ message: 'Use the dedicated migration folder beside the original file.' }, 403)
    }
    if (current.destination && current.destination !== address(destination)) return jsonResponse({ message: 'The assigned migration destination cannot change.' }, 409)
    const destinationPermissions = await readPermissions(address(destination), authorization)
    if (!equivalentPermissions(sourcePermissions, destinationPermissions)) return jsonResponse({ message: 'The owner must verify the same recipients, roles and restrictions on the dedicated migration folder.' }, 403)
    if (!await isDedicatedNotebookFolder(destination, async (folder: GraphItem) => {
      const result: GraphItem[] = []
      let next: string | undefined = `${GRAPH}${address(folder)}/children?$select=id,name,file,folder,parentReference`
      const seen = new Set<string>()
      while (next) {
        if (!next.startsWith(GRAPH + '/') || seen.has(next)) throw new Response(null, { status: 403 })
        seen.add(next)
        const response = await fetch(next, { headers: { Authorization: authorization } })
        if (!response.ok) throw response
        const page = await response.json() as { value: GraphItem[]; '@odata.nextLink'?: string }
        if (!Array.isArray(page.value)) throw new Response(null, { status: 403 })
        result.push(...page.value); next = page['@odata.nextLink']
      }
      return result
    })) return jsonResponse({ message: 'Choose a folder dedicated to Rivolo, empty or containing only year/month/day Markdown files.' }, 403)
    if (['complete', 'renew'].includes(String(body.action)) && (typeof body.generation !== 'number' || typeof body.lease !== 'string')) return jsonResponse({ message: 'Invalid migration lease.' }, 400)
    return await relayFetch(registry, `/migration/${body.action}`, { method: 'POST', body: JSON.stringify({ destination: address(destination), generation: body.generation, lease: body.lease }) })
  } catch (error) {
    const response = error instanceof Response ? error : null
    if (response?.status === 503 && response.headers.get('Content-Type')?.includes('application/json')) return response
    return jsonResponse({ message: 'OneDrive migration access could not be verified. Retry or ask the owner for folder access.' }, response && [401, 403, 404].includes(response.status) ? response.status : 503)
  }
}
