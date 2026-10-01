import { describe, expect, it } from 'vitest'
import { equivalentPermissions, hasOwnerPermission, canEstablishMigration, missingMigrationGrants, missingUserGrants, type Permission } from '../../functions/_lib/oneDrivePermissions'

const grant = (id: string, roles = ['write']): Permission => ({ roles, grantedToV2: { user: { id } } })
describe('migration permission equivalence', () => {
  it('preserves existing SharePoint site groups and organization links, independent of redeemed users', () => {
    const owners: Permission = { roles: ['owner'], grantedToV2: { siteGroup: { id: '3' }, sharePointGroup: { id: 'site-owners' } } }
    const members: Permission = { roles: ['write'], grantedToV2: { siteGroup: { id: '5' }, sharePointGroup: { id: 'site-members' } } }
    const organization: Permission = { roles: ['write'], link: { scope: 'organization', type: 'edit' }, grantedToIdentitiesV2: [{ user: { id: 'alice' } }] }
    expect(canEstablishMigration([owners, members, organization], 'alice', 'documentLibrary')).toBe(true)
    expect(hasOwnerPermission([owners, members, organization], 'alice')).toBe(false)
    expect(canEstablishMigration([owners, members, organization], 'alice', 'personal')).toBe(false)
    expect(canEstablishMigration([owners, members, organization], 'unknown-user', 'documentLibrary')).toBe(false)
    expect(equivalentPermissions([owners, members, organization], [members, owners, { ...organization, grantedToIdentitiesV2: [] }])).toBe(true)
    expect(missingMigrationGrants([owners, members, organization], [owners, members])).toEqual({ users: [], organizationLinks: ['edit'] })
    expect(missingMigrationGrants([grant('alice')], [organization])).toBeNull()
    expect(missingMigrationGrants([organization], [{ ...organization, link: { scope: 'anonymous', type: 'edit' } }])).toBeNull()
    expect(missingMigrationGrants([{ ...organization, expirationDateTime: '2099-01-01T00:00:00Z' }], [])).toBeNull()
    expect(canEstablishMigration([grant('alice', ['read'])], 'alice', 'documentLibrary')).toBe(false)
    expect(canEstablishMigration([], 'alice', 'documentLibrary')).toBe(false)
  })
  it('accepts two unshared owner-verified items and equivalent grouped or individual recipients', () => {
    expect(equivalentPermissions([], [])).toBe(true)
    const grouped = { roles: ['write'], link: { scope: 'users', type: 'edit' }, grantedToIdentitiesV2: [{ user: { id: 'alice' } }, { user: { id: 'bob' } }] }
    expect(equivalentPermissions([grouped], [grant('bob'), grant('alice')])).toBe(true)
    expect(missingUserGrants([grouped], [grant('alice')])).toEqual([{ objectId: 'bob', roles: ['write'] }])
  })
  it('does not copy public, unknown, expiring, restricted or group grants, or broaden an already wider destination', () => {
    const invalid: Permission[] = [
      { roles: ['write'], link: { scope: 'anonymous', type: 'edit' } },
      { roles: ['write'] },
      { ...grant('bob'), expirationDateTime: '2099-01-01T00:00:00Z' },
      { ...grant('bob'), link: { scope: 'users', type: 'view', preventsDownload: true } },
      { roles: ['write'], grantedToV2: { group: { id: 'group' } } },
    ]
    for (const permission of invalid) expect(missingUserGrants([grant('alice'), permission], [grant('alice')])).toBeNull()
    expect(missingUserGrants([grant('alice')], [grant('alice'), grant('outsider')])).toBeNull()
    expect(missingUserGrants([grant('alice', ['read'])], [grant('alice', ['write'])])).toBeNull()
  })
  it('recognizes only the current user’s valid direct owner role, never write access or a site-local ID', () => {
    expect(hasOwnerPermission([grant('alice', ['owner'])], 'alice')).toBe(true)
    expect(hasOwnerPermission([grant('alice')], 'alice')).toBe(false)
    expect(hasOwnerPermission([grant('someone-else', ['owner'])], 'alice')).toBe(false)
    expect(hasOwnerPermission([{ roles: ['owner'], grantedToV2: { siteUser: { id: 'alice' } } }], 'alice')).toBe(false)
    expect(hasOwnerPermission([{ ...grant('alice', ['owner']), expirationDateTime: '2000-01-01T00:00:00Z' }], 'alice')).toBe(false)
  })
})
