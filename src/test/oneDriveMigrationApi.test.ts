// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../functions/api/onedrive/migration'
import { migrationFolderName } from '../../functions/_lib/oneDriveNotebook'
import { createGraphFixture } from './oneDriveGraphFixture'
import type { Permission } from '../../functions/_lib/oneDrivePermissions'

const relay = vi.fn()
const env = { ONEDRIVE_EVENTS: { idFromName: (name: string) => name, get: () => ({ fetch: relay }) } }
const source = '/drives/drive/items/legacy'
const destination = '/drives/drive/items/notebook'
const permission = { roles: ['write'], grantedToV2: { user: { id: 'recipient' } } }
const post = (body: object) => onRequestPost({ env, request: new Request('https://rivolo.test/api/onedrive/migration', {
  method: 'POST', headers: { Origin: 'https://rivolo.test', 'X-Requested-With': 'XmlHttpRequest', Authorization: 'Bearer test-token' },
  body: JSON.stringify({ source, destination, ...body }),
}) } as never) as Promise<Response>
let graph: ReturnType<typeof createGraphFixture>
let ownDrive: string
let wider: boolean
let ownerRole: boolean
let libraryPermissions: Permission[] | null
beforeEach(() => {
  graph = createGraphFixture(); ownDrive = 'drive'; wider = false; ownerRole = false
  libraryPermissions = null
  const original = { id: 'legacy', name: 'notes.md', eTag: 'v1', file: {}, parentReference: { driveId: 'drive', id: 'root' } }
  graph.items.set(source, original)
  graph.items.get(destination)!.name = migrationFolderName(original)
  relay.mockReset().mockImplementation(async (url: string) => Response.json(url.endsWith('/lookup') ? {} : { status: 'running' }))
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/me/drive?')) return Response.json({ id: ownDrive })
    if (url.includes('/me?')) return Response.json({ id: 'recipient' })
    if (url.endsWith('/permissions') && libraryPermissions && !wider) return Response.json({ value: libraryPermissions })
    if (url.endsWith('/permissions')) return Response.json({ value: wider && url.includes('/notebook/') ?
      [{ roles: ['write'], link: { scope: 'anonymous', type: 'edit' } }] : [{ ...permission, roles: ownerRole ? ['owner'] : permission.roles }] })
    return graph.fetch(input, init)
  })
})
afterEach(() => vi.unstubAllGlobals())
describe('migration registry API', () => {
  it('accepts an explicitly identified SharePoint writer with matching group and organization access, without calling them an owner', async () => {
    ownDrive = 'personal-drive'; graph.setDriveType('documentLibrary')
    libraryPermissions = [
      { roles: ['owner'], grantedToV2: { sharePointGroup: { id: 'site-owners' }, siteGroup: { id: '3' } } },
      { roles: ['write'], link: { scope: 'organization', type: 'edit' }, grantedToIdentitiesV2: [{ user: { id: 'recipient' } }] },
    ]
    expect((await post({ action: 'claim' })).status).toBe(200)
    wider = true
    expect((await post({ action: 'claim' })).status).toBe(403)
    wider = false
    libraryPermissions[1].grantedToIdentitiesV2 = [{ user: { id: 'other-user' } }]
    expect((await post({ action: 'claim' })).status).toBe(403)
  })
  it('accepts verified SharePoint owner roles when the source is not in the personal drive', async () => {
    ownDrive = 'personal-drive'; ownerRole = true
    expect((await post({ action: 'claim' })).status).toBe(200)
    expect(relay.mock.calls.at(-1)![0]).toBe('https://channel/migration/claim')
  })
  it('refuses a folder containing unrelated documents even for the verified owner', async () => {
    graph.items.set('/drives/drive/items/foreign', { id: 'foreign', name: 'Private.pdf', eTag: 'v1', file: {}, parentReference: { driveId: 'drive', id: 'notebook' } })
    expect((await post({ action: 'claim' })).status).toBe(403)
    expect(relay.mock.calls.every(([url]) => url.endsWith('/lookup'))).toBe(true)
  })
  it('reports unavailable external Workers without misreporting Graph permissions', async () => {
    relay.mockRejectedValueOnce(new Error('External Durable Object not running'))
    const response = await post({ action: 'lookup' })
    expect(response.status).toBe(503)
    expect((await response.json()).message).toContain('npm run dev:cloud')
  })
  it('lets collaborators discover the destination but only the owner establish it', async () => {
    ownDrive = 'collaborator-drive'
    expect((await post({ action: 'lookup' })).status).toBe(200)
    expect((await post({ action: 'claim' })).status).toBe(403)
    expect(relay.mock.calls.some(([url]) => url.endsWith('/claim'))).toBe(false)
  })
  it('verifies the dedicated sibling folder and refuses broader permissions before claiming', async () => {
    wider = true
    expect((await post({ action: 'claim' })).status).toBe(403)
    wider = false
    graph.items.get(destination)!.parentReference!.id = 'somewhere-else'
    expect((await post({ action: 'claim' })).status).toBe(403)
    expect(relay.mock.calls.every(([url]) => url.endsWith('/lookup'))).toBe(true)
  })
  it('preserves the registry destination and validates completion leases', async () => {
    relay.mockResolvedValueOnce(Response.json({ destination: '/drives/drive/items/other', status: 'running' }))
    graph.addFolder('other', 'Other', 'root')
    expect((await post({ action: 'claim' })).status).toBe(409)
    expect((await post({ action: 'complete' })).status).toBe(400)
    expect((await post({ action: 'complete', generation: 1, lease: 'lease' })).status).toBe(200)
    expect(JSON.parse(relay.mock.calls.at(-1)![1].body)).toEqual({ destination, generation: 1, lease: 'lease' })
    expect(graph.counters.downloads).toEqual([])
  })
})
