import { GRAPH } from './oneDriveNotebook'
export type Permission = {
  roles?: string[]; expirationDateTime?: string; hasPassword?: boolean
  link?: { scope?: string; type?: string; webUrl?: string; preventsDownload?: boolean }
  grantedToV2?: { user?: { id?: string }; group?: { id?: string }; siteUser?: { id?: string }; siteGroup?: { id?: string }; sharePointGroup?: { id?: string } }
  grantedToIdentitiesV2?: Permission['grantedToV2'][]
}
// Graph reports owner roles for SharePoint/OneDrive Business too. Compare the
// Microsoft user ID, never a display name or a site-local numeric user ID.
export const hasOwnerPermission = (permissions: Permission[], userId: string) => Boolean(userId) && permissions.some((permission) =>
  !permission.link && permission.roles?.includes('owner') &&
  (!permission.expirationDateTime || permission.expirationDateTime.startsWith('0001-') || Date.parse(permission.expirationDateTime) > Date.now()) &&
  (permission.grantedToIdentitiesV2 ?? (permission.grantedToV2 ? [permission.grantedToV2] : [])).some((identity) => identity?.user?.id === userId))
export const permissionSignature = (permission: Permission) => {
  if (permission.hasPassword || permission.link && (!['users', 'organization'].includes(permission.link.scope ?? '') || !['edit', 'view'].includes(permission.link.type ?? ''))) return null
  if (permission.link?.scope === 'organization') {
    if (JSON.stringify(permission.roles) !== JSON.stringify([permission.link.type === 'edit' ? 'write' : 'read'])) return null
    return JSON.stringify([[`organization:${permission.link.type}`], permission.roles, permission.expirationDateTime ?? null, Boolean(permission.link.preventsDownload)])
  }
  const identities = permission.grantedToIdentitiesV2 ?? (permission.grantedToV2 ? [permission.grantedToV2] : [])
  if (!identities.length || !permission.roles?.length) return null
  // Comparisons only occur within the same drive/site; prefer the globally
  // identified SharePoint group over its site-local principal ID.
  const subjects = identities.map((id) => id?.user?.id ? `user:${id.user.id}` : id?.group?.id ? `group:${id.group.id}` : id?.sharePointGroup?.id ? `sharepoint:${id.sharePointGroup.id}` : id?.siteGroup?.id ? `sitegroup:${id.siteGroup.id}` : id?.siteUser?.id ? `site:${id.siteUser.id}` : null)
  if (subjects.includes(null)) return null
  return JSON.stringify([subjects.sort(), [...permission.roles].sort(), permission.expirationDateTime ?? null, Boolean(permission.link?.preventsDownload)])
}
export const equivalentPermissions = (source: Permission[], destination: Permission[]) => {
  const a = permissionEntries(source), b = permissionEntries(destination)
  return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b)
}
const permissionEntries = (permissions: Permission[]) => {
  const entries: string[] = []
  for (const permission of permissions) {
    const signature = permissionSignature(permission)
    if (!signature) return null
    const [subjects, roles, expires, restricted] = JSON.parse(signature) as [string[], string[], string | null, boolean]
    for (const subject of subjects) entries.push(JSON.stringify([subject, roles, expires?.startsWith('0001-') ? null : expires, restricted]))
  }
  return [...new Set(entries)].sort()
}
// Reproduce existing individual grants or organization links only when their
// restrictions can be preserved. Never remove unrelated destination access.
export const missingMigrationGrants = (source: Permission[], destination: Permission[]) => {
  const before = permissionEntries(source), after = permissionEntries(destination)
  if (!before || !after || after.some((entry) => !before.includes(entry))) return null
  const grants: { objectId: string; roles: string[] }[] = []
  const organizationLinks: ('edit' | 'view')[] = []
  for (const entry of before) {
    if (after.includes(entry)) continue
    const [subject, roles, expires, restricted] = JSON.parse(entry) as [string, string[], string | null, boolean]
    if (expires || restricted || roles.length !== 1 || !['read', 'write'].includes(roles[0])) return null
    if (subject === 'organization:edit' || subject === 'organization:view') { organizationLinks.push(subject === 'organization:edit' ? 'edit' : 'view'); continue }
    if (!subject.startsWith('user:')) return null
    grants.push({ objectId: subject.slice(5), roles })
  }
  return { users: grants, organizationLinks }
}
export const missingUserGrants = (source: Permission[], destination: Permission[]) => {
  const grants = missingMigrationGrants(source, destination)
  return grants && !grants.organizationLinks.length ? grants.users : null
}
// SharePoint libraries have site-group owners rather than a personal drive
// owner. An explicitly identified writer may create a dedicated sibling when
// Graph allows it, provided the verified sharing is reproduced exactly.
// This never treats that writer as an owner or permits a personal-drive copy.
export const canEstablishMigration = (permissions: Permission[], userId: string, driveType: string) =>
  hasOwnerPermission(permissions, userId) || driveType === 'documentLibrary' && Boolean(userId) &&
  permissions.every((permission) => permissionSignature(permission) !== null) && permissions.some((permission) =>
    permission.roles?.includes('write') && !permission.hasPassword &&
    (!permission.expirationDateTime || permission.expirationDateTime.startsWith('0001-') || Date.parse(permission.expirationDateTime) > Date.now()) &&
    (permission.grantedToIdentitiesV2 ?? (permission.grantedToV2 ? [permission.grantedToV2] : [])).some((identity) => identity?.user?.id === userId))
export const readPermissions = async (item: string, authorization: string) => {
  const result: Permission[] = []
  let next: string | undefined = `${GRAPH}${item}/permissions`
  const seen = new Set<string>()
  while (next) {
    if (!next.startsWith(GRAPH + '/') || seen.has(next)) throw new Response(null, { status: 403 })
    seen.add(next)
    const response = await fetch(next, { headers: { Authorization: authorization } })
    if (!response.ok) throw response
    const body = await response.json() as { value: Permission[]; '@odata.nextLink'?: string }
    if (!Array.isArray(body.value)) throw new Response(null, { status: 403 })
    result.push(...body.value)
    next = body['@odata.nextLink']
  }
  return result
}
