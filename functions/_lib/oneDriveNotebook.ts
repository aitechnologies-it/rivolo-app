export const GRAPH = 'https://graph.microsoft.com/v1.0'
export const validItem = (value: unknown): value is string => typeof value === 'string' &&
  /^\/drives\/[A-Za-z0-9!_%.-]+\/items\/[A-Za-z0-9!_%.-]+$/.test(value) && value.length < 1024
export type GraphItem = { id: string; name: string; eTag: string; file?: object; folder?: object; parentReference: { id: string; driveId: string } }
export const address = (item: GraphItem) => `/drives/${encodeURIComponent(item.parentReference.driveId)}/items/${encodeURIComponent(item.id)}`
export const roomName = async (identity: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export const graphMetadata = async (item: string, authorization: string) => {
  const response = await fetch(`${GRAPH}${item}?$select=id,name,eTag,file,folder,parentReference`, { headers: { Authorization: authorization } })
  if (!response.ok) throw response
  const result = await response.json() as GraphItem
  if (!result.id || !result.parentReference?.driveId) throw new Response(null, { status: 400 })
  return result
}
export const migrationFolderName = (source: Pick<GraphItem, 'id' | 'name'>) => {
  const stem = source.name.replace(/\.md$/i, '').replace(/["*:<>?\\|/]/g, '-').slice(0, 70)
  return `Rivolo-${stem}-${encodeURIComponent(source.id).slice(0, 100)}`
}
const daysInMonth = (year: number, month: number) => month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31
export const validDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}
type NotebookEntry = Pick<GraphItem, 'name' | 'file' | 'folder'>
// Migration may use a folder explicitly chosen by its owner, but it must be
// dedicated to Rivolo, rather than an existing folder of unrelated documents.
export const isDedicatedNotebookFolder = async <T extends NotebookEntry>(root: T, children: (item: T) => Promise<T[]>) => {
  for (const year of await children(root)) {
    if (!year.folder || !/^\d{4}$/.test(year.name)) return false
    for (const month of await children(year)) {
      if (!month.folder || !/^(0[1-9]|1[0-2])$/.test(month.name)) return false
      for (const file of await children(month)) {
        const day = file.name.replace(/\.md$/, '')
        if (!file.file || !validDay(day) || file.name !== `${day}.md` || day.slice(0, 4) !== year.name || day.slice(5, 7) !== month.name) return false
      }
    }
  }
  return true
}
export const verifyDayMembership = async (folder: GraphItem, file: GraphItem, authorization: string) => {
  const day = file.name?.replace(/\.md$/, '')
  if (!file.file || !validDay(day) || file.name !== `${day}.md` || file.parentReference.driveId !== folder.parentReference.driveId) return null
  const drive = encodeURIComponent(file.parentReference.driveId)
  const month = await graphMetadata(`/drives/${drive}/items/${encodeURIComponent(file.parentReference.id)}`, authorization)
  if (!month.folder || month.name !== day.slice(5, 7)) return null
  const year = await graphMetadata(`/drives/${drive}/items/${encodeURIComponent(month.parentReference.id)}`, authorization)
  if (!year.folder || year.name !== day.slice(0, 4) || year.parentReference.id !== folder.id || year.parentReference.driveId !== folder.parentReference.driveId) return null
  return day
}
