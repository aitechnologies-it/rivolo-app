import { exportMarkdown, parseMarkdown, type ParsedDay } from './markdown'

// Blank lines delimit paragraphs; fenced code stays a single block.
const paragraphs = (text: string) => {
  const blocks: string[] = []
  let lines: string[] = []
  let fence: { char: string; length: number } | null = null
  const flush = () => {
    if (lines.length) blocks.push(lines.join('\n'))
    lines = []
  }
  for (const line of text.replace(/\r\n/g, '\n').trimEnd().split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null
    }
    if (!line.trim() && !fence) flush()
    else lines.push(line)
  }
  flush()
  return blocks
}

const changes = (base: string[], next: string[]) => {
  // Bound work on mobile rather than guessing and dropping content in a huge diff.
  if ((base.length + 1) * (next.length + 1) > 4_000_000) {
    throw new Error('This note is too large to merge automatically. Choose which OneDrive copy to keep.')
  }
  const width = next.length + 1
  const lengths = new Uint32Array((base.length + 1) * width)
  for (let i = base.length - 1; i >= 0; i--) {
    for (let j = next.length - 1; j >= 0; j--) {
      lengths[i * width + j] = base[i] === next[j]
        ? 1 + lengths[(i + 1) * width + j + 1]
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1])
    }
  }
  const anchors: [number, number][] = []
  let i = 0
  let j = 0
  while (i < base.length && j < next.length) {
    if (base[i] === next[j]) { anchors.push([i++, j++]) }
    else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) i++
    else j++
  }
  anchors.push([base.length, next.length])
  const replacements = new Map<number, string | null>()
  const additions = new Map<number, string[]>()
  let baseStart = 0
  let nextStart = 0
  for (const [baseEnd, nextEnd] of anchors) {
    const removed = baseEnd - baseStart
    const inserted = next.slice(nextStart, nextEnd)
    for (let k = 0; k < removed; k++) replacements.set(baseStart + k, inserted[k] ?? null)
    if (inserted.length > removed) additions.set(baseEnd, inserted.slice(removed))
    baseStart = baseEnd + 1
    nextStart = nextEnd + 1
  }
  return { replacements, additions }
}

export const mergeOneDriveParagraphs = (baseText: string, localText: string, remoteText: string) => {
  if (localText === remoteText || remoteText === baseText) return localText
  if (localText === baseText) return remoteText
  const base = paragraphs(baseText)
  const local = changes(base, paragraphs(localText))
  const remote = changes(base, paragraphs(remoteText))
  const result: string[] = []
  for (let i = 0; i <= base.length; i++) {
    const remoteAdded = remote.additions.get(i) ?? []
    const localAdded = local.additions.get(i) ?? []
    result.push(...remoteAdded)
    // Preserve each writer's group and multiplicity, deduplicating shared additions.
    const remaining = [...remoteAdded]
    for (const block of localAdded) {
      const duplicate = remaining.indexOf(block)
      if (duplicate >= 0) remaining.splice(duplicate, 1)
      else result.push(block)
    }
    if (i === base.length) break
    const block = local.replacements.has(i) ? local.replacements.get(i)
      : remote.replacements.has(i) ? remote.replacements.get(i) : base[i]
    if (block != null) result.push(block)
  }
  return result.join('\n\n')
}

const readNotebook = (content: string) => {
  const parsed = parseMarkdown(content)
  if (!parsed.days.length || parsed.warnings.length) {
    throw new Error('OneDrive notebook cannot be merged: check its day markers before syncing.')
  }
  return new Map(parsed.days.map((day) => [day.dayId, day]))
}

export const mergeOneDriveNotebooks = (baseText: string, localText: string, remoteText: string) => {
  const base = readNotebook(baseText)
  const local = readNotebook(localText)
  const remote = readNotebook(remoteText)
  const merged: ParsedDay[] = []
  for (const id of new Set([...base.keys(), ...remote.keys(), ...local.keys()])) {
    const before = base.get(id)
    const ours = local.get(id)
    const theirs = remote.get(id)
    if (!ours) {
      if (!before && theirs) merged.push(theirs)
      continue // Our deletion wins over a simultaneous edit.
    }
    if (!theirs) {
      if (!before || ours.contentMd !== before.contentMd || ours.humanTitle !== before.humanTitle) merged.push(ours)
      continue
    }
    merged.push({ ...ours,
      humanTitle: before && ours.humanTitle === before.humanTitle ? theirs.humanTitle : ours.humanTitle,
      contentMd: mergeOneDriveParagraphs(before?.contentMd ?? '', ours.contentMd, theirs.contentMd),
    })
  }
  return exportMarkdown(merged.map((day) => ({ ...day, createdAt: 0, updatedAt: 0 })))
}
