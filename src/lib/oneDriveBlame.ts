import { parseMarkdown } from './markdown'
import { appendAuthorsMetadata, readAuthorsMetadata } from './notebookMetadata'
import { hashSyncContent } from './syncHash'
import { matchingLines, textLines } from './sequenceDiff'

export type LineAuthor = string | null
export type NotebookAuthors = Map<string, LineAuthor[]>
type StoredDay = { hash: string; runs: [number, number][] }
type StoredAuthors = { names: string[]; days: Record<string, StoredDay> }

export const alignLineAuthors = (before: string, after: string, authors: LineAuthor[], changedAuthor: LineAuthor) => {
  const base = textLines(before)
  const next = textLines(after)
  const result: LineAuthor[] = next.map(() => changedAuthor)
  for (const [i, j] of matchingLines(base, next)) result[j] = authors[i] ?? null
  return result
}

export const readNotebookAuthors = async (content: string, onlyDayId?: string): Promise<NotebookAuthors> => {
  const result: NotebookAuthors = new Map()
  const raw = readAuthorsMetadata(content) as Partial<StoredAuthors> | null
  if (!raw || !Array.isArray(raw.names) || raw.names.some((name) => typeof name !== 'string' || name.length > 200) ||
      !raw.days || typeof raw.days !== 'object') return result
  for (const day of parseMarkdown(content).days) {
    if (onlyDayId && day.dayId !== onlyDayId) continue
    const stored = raw.days[day.dayId]
    if (!stored || !Array.isArray(stored.runs) || stored.hash !== await hashSyncContent(day.contentMd)) continue
    const count = textLines(day.contentMd).length
    const authors: LineAuthor[] = []
    let valid = true
    for (const run of stored.runs) {
      if (!Array.isArray(run) || run.length !== 2) { valid = false; break }
      const [length, index] = run
      if (!Number.isSafeInteger(length) || length < 1 || authors.length + length > count ||
          !Number.isSafeInteger(index) || index < -1 || index >= raw.names.length) { valid = false; break }
      for (let i = 0; i < length; i++) authors.push(index === -1 ? null : raw.names[index])
    }
    if (valid && authors.length === count) result.set(day.dayId, authors)
  }
  return result
}

export const writeNotebookAuthors = async (content: string, authors: NotebookAuthors) => {
  const stored: StoredAuthors = { names: [], days: {} }
  const nameIndices = new Map<string, number>()
  for (const day of parseMarkdown(content).days) {
    const lines = textLines(day.contentMd)
    const dayAuthors = authors.get(day.dayId) ?? []
    const runs: [number, number][] = []
    for (let i = 0; i < lines.length; i++) {
      const name = dayAuthors[i]?.slice(0, 200) || null
      let index = name === null ? -1 : nameIndices.get(name) ?? -1
      if (name !== null && index < 0) { index = stored.names.length; stored.names.push(name); nameIndices.set(name, index) }
      if (runs.at(-1)?.[1] === index) runs[runs.length - 1][0]++
      else runs.push([1, index])
    }
    stored.days[day.dayId] = { hash: await hashSyncContent(day.contentMd), runs }
  }
  return appendAuthorsMetadata(content, stored)
}

// Pre-existing or externally changed text without valid metadata stays unknown.
// Only local changes since the known baseline receive the signed-in display name.
export const annotateLocalNotebook = async (content: string, baseline: string | null, name: LineAuthor) => {
  const baseDays = new Map(parseMarkdown(baseline ?? '').days.map((day) => [day.dayId, day]))
  const baseAuthors = await readNotebookAuthors(baseline ?? '')
  const authors: NotebookAuthors = new Map()
  for (const day of parseMarkdown(content).days) {
    const previous = baseDays.get(day.dayId)
    authors.set(day.dayId, baseline === null ? textLines(day.contentMd).map(() => null)
      : alignLineAuthors(previous?.contentMd ?? '', day.contentMd, baseAuthors.get(day.dayId) ?? [], name))
  }
  return writeNotebookAuthors(content, authors)
}
