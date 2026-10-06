import { parseMarkdown } from './markdown'
import { appendAuthorsMetadata, readAuthorsMetadata } from './notebookMetadata'
import { hashSyncContent } from './syncHash'
import { matchingLines, textLines } from './sequenceDiff'
import { getDayIdFromDate, isValidDayId } from './dates'

export type LineAuthor = string | null
export type NotebookAuthors = Map<string, LineAuthor[]>
export type LineAttribution = { author: LineAuthor; date: string | null }
export type NotebookAttribution = Map<string, LineAttribution[]>
type StoredDay = { hash: string; runs: [number, number][]; dates?: [number, string | null][] }
type StoredAuthors = { names: string[]; days: Record<string, StoredDay> }

const alignLines = <T,>(before: string, after: string, values: T[], changed: T, unknown: T) => {
  const result = textLines(after).map(() => changed)
  for (const [i, j] of matchingLines(textLines(before), textLines(after))) result[j] = values[i] ?? unknown
  return result
}
export const alignLineAuthors = (before: string, after: string, authors: LineAuthor[], changedAuthor: LineAuthor) =>
  alignLines(before, after, authors, changedAuthor, null)
export const alignLineAttribution = (before: string, after: string, attribution: LineAttribution[], changed: LineAttribution) =>
  alignLines(before, after, attribution, changed, { author: null, date: null })

export const readNotebookAttribution = async (content: string, onlyDayId?: string): Promise<NotebookAttribution> => {
  const result: NotebookAttribution = new Map()
  const raw = readAuthorsMetadata(content) as Partial<StoredAuthors> | null
  if (!raw || !Array.isArray(raw.names) || raw.names.some((name) => typeof name !== 'string' || name.length > 200) ||
      !raw.days || typeof raw.days !== 'object') return result
  for (const day of parseMarkdown(content).days) {
    if (onlyDayId && day.dayId !== onlyDayId) continue
    const stored = raw.days[day.dayId]
    if (!stored || !Array.isArray(stored.runs) || stored.hash !== await hashSyncContent(day.contentMd)) continue
    const count = textLines(day.contentMd).length
    const lines: LineAttribution[] = []
    let valid = true
    for (const run of stored.runs) {
      if (!Array.isArray(run) || run.length !== 2) { valid = false; break }
      const [length, index] = run
      if (!Number.isSafeInteger(length) || length < 1 || lines.length + length > count ||
          !Number.isSafeInteger(index) || index < -1 || index >= raw.names.length) { valid = false; break }
      for (let i = 0; i < length; i++) lines.push({ author: index === -1 ? null : raw.names[index], date: null })
    }
    if (!valid || lines.length !== count) continue
    // Optional date runs extend v1 without invalidating legacy author metadata.
    // Malformed dates discard only the dates, never valid names or note text.
    const dates: (string | null)[] = []
    if (Array.isArray(stored.dates)) {
      for (const run of stored.dates) {
        if (!Array.isArray(run) || run.length !== 2 || !Number.isSafeInteger(run[0]) || run[0] < 1 ||
            dates.length + run[0] > count || run[1] !== null && (typeof run[1] !== 'string' || !isValidDayId(run[1]))) { valid = false; break }
        for (let i = 0; i < run[0]; i++) dates.push(run[1])
      }
      if (valid && dates.length === count) lines.forEach((line, i) => { if (line.author) line.date = dates[i] })
    }
    result.set(day.dayId, lines)
  }
  return result
}
export const readNotebookAuthors = async (content: string, onlyDayId?: string): Promise<NotebookAuthors> =>
  new Map([...await readNotebookAttribution(content, onlyDayId)].map(([id, lines]) => [id, lines.map((line) => line.author)]))

export const writeNotebookAttribution = async (content: string, attribution: NotebookAttribution) => {
  const stored: StoredAuthors = { names: [], days: {} }
  const nameIndices = new Map<string, number>()
  for (const day of parseMarkdown(content).days) {
    const lines = textLines(day.contentMd)
    const dayAttribution = attribution.get(day.dayId) ?? []
    const runs: [number, number][] = []
    const dates: [number, string | null][] = []
    for (let i = 0; i < lines.length; i++) {
      const name = dayAttribution[i]?.author?.slice(0, 200) || null
      let index = name === null ? -1 : nameIndices.get(name) ?? -1
      if (name !== null && index < 0) { index = stored.names.length; stored.names.push(name); nameIndices.set(name, index) }
      if (runs.at(-1)?.[1] === index) runs[runs.length - 1][0]++
      else runs.push([1, index])
      const value = dayAttribution[i]?.date
      const date = name && value && isValidDayId(value) ? value : null
      if (dates.at(-1)?.[1] === date) dates[dates.length - 1][0]++
      else dates.push([1, date])
    }
    stored.days[day.dayId] = { hash: await hashSyncContent(day.contentMd), runs,
      ...(dates.some(([, date]) => date !== null) ? { dates } : {}),
    }
  }
  return appendAuthorsMetadata(content, stored)
}
export const writeNotebookAuthors = (content: string, authors: NotebookAuthors) =>
  writeNotebookAttribution(content, new Map([...authors].map(([id, names]) => [id, names.map((author) => ({ author, date: null }))])))

export const editDayId = (timestamp: number | undefined) => {
  if (!timestamp || !Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  return Number.isFinite(date.getTime()) ? getDayIdFromDate(date) : null
}

// Pre-existing or externally changed text without valid metadata stays unknown.
// Only local changes since the known baseline receive a name and edit date.
export const annotateLocalNotebook = async (content: string, baseline: string | null, name: LineAuthor,
  editedAt: number | Map<string, number> = Date.now()) => {
  const baseDays = new Map(parseMarkdown(baseline ?? '').days.map((day) => [day.dayId, day]))
  const baseAttribution = await readNotebookAttribution(baseline ?? '')
  const attribution: NotebookAttribution = new Map()
  for (const day of parseMarkdown(content).days) {
    const previous = baseDays.get(day.dayId)
    const date = name ? editDayId(typeof editedAt === 'number' ? editedAt : editedAt.get(day.dayId)) : null
    attribution.set(day.dayId, baseline === null ? textLines(day.contentMd).map(() => ({ author: null, date: null }))
      : alignLineAttribution(previous?.contentMd ?? '', day.contentMd, baseAttribution.get(day.dayId) ?? [], { author: name, date }))
  }
  return writeNotebookAttribution(content, attribution)
}
