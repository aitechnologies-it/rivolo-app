// Include drafts waiting for the editor's debounce, not just persisted notes.
const readers = new Set<() => string[]>()
let revision = 0

export const noteEditorChange = () => { revision += 1 }
export const getEditorRevision = () => revision
export const getPendingEditorDayIds = () => new Set([...readers].flatMap((read) => read()))
export const registerPendingEditorSaves = (read: () => string[]) => {
  readers.add(read)
  return () => { readers.delete(read) }
}
