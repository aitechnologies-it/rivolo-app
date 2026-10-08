import { EditorView, GutterMarker, gutter } from '@codemirror/view'
import type { LineAttribution } from '../oneDriveBlame'
import { formatDayTitle } from '../dates'

export type BlameGroup = { author: string | null; start: number; end: number; dates: string[] }
export const authorInitials = (name: string | null) => {
  if (!name?.trim()) return '?'
  const parts = name.trim().split(/\s+/)
  return (parts.length === 1 ? Array.from(parts[0]).slice(0, 2).join('') :
    Array.from(parts[0])[0] + Array.from(parts.at(-1)!)[0]).toUpperCase()
}
export const groupLineAttribution = (attribution: LineAttribution[], dayId: string) => {
  const groups: BlameGroup[] = []
  let dates = new Set<string>()
  attribution.forEach(({ author, date }, index) => {
    let group = groups.at(-1)
    if (!group || group.author !== author) { group = { author, start: index, end: index, dates: [] }; groups.push(group); dates = new Set() }
    group.end = index
    if (date && date !== dayId && !dates.has(date)) { dates.add(date); group.dates.push(date) }
  })
  return groups
}

// Draw distinct hues before reusing the palette, keeping each author consistent.
const AUTHOR_HUES = [8, 42, 85, 145, 185, 220, 265]
const authorHues = new Map<string | null, number>()
let availableHues = [...AUTHOR_HUES]
const authorHue = (author: string | null) => {
  const existing = authorHues.get(author)
  if (existing !== undefined) return existing
  if (!availableHues.length) availableHues = [...AUTHOR_HUES]
  const [hue] = availableHues.splice(Math.floor(Math.random() * availableHues.length), 1)
  authorHues.set(author, hue)
  return hue
}

class Spacer extends GutterMarker {
  toDOM() { const element = document.createElement('span'); element.className = 'cm-blame-spacer'; return element }
}
class Rail extends GutterMarker {
  elementClass = 'cm-blame-rail'
}
class Badge extends GutterMarker {
  elementClass = 'cm-blame-start'
  readonly group: BlameGroup
  readonly open: (group: BlameGroup, anchor: HTMLElement) => void
  constructor(group: BlameGroup, open: Badge['open']) { super(); this.group = group; this.open = open }
  toDOM() {
    const button = document.createElement('button')
    const label = [this.group.author || 'Unknown author', ...this.group.dates.map(formatDayTitle)].join(' · ')
    button.type = 'button'
    button.className = 'cm-blame-badge'
    button.style.setProperty('--blame-hue', String(authorHue(this.group.author)))
    button.textContent = authorInitials(this.group.author)
    button.title = label
    button.setAttribute('aria-label', label)
    button.setAttribute('aria-haspopup', 'dialog')
    button.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
    button.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() })
    button.addEventListener('click', (event) => { event.stopPropagation(); this.open(this.group, button) })
    // CodeMirror normally hides decorative gutters from assistive technology.
    // These markers are real buttons, so expose their containing gutter.
    queueMicrotask(() => button.closest('.cm-gutters')?.setAttribute('aria-hidden', 'false'))
    return button
  }
}

export const blameGutter = (dayId: string, attribution: LineAttribution[] | null,
  open: (group: BlameGroup, anchor: HTMLElement) => void) => {
  const groups = groupLineAttribution(attribution ?? [], dayId)
  const starts = new Map(groups.map((group) => [group.start, group]))
  const rail = new Rail()
  return [gutter({
    class: 'cm-blame-gutter',
    renderEmptyElements: true,
    initialSpacer: () => new Spacer(),
    lineMarker: (view, line) => {
      const index = view.state.doc.lineAt(line.from).number - 1
      const group = starts.get(index)
      return group ? new Badge(group, open) : attribution?.[index] ? rail : null
    },
  }), EditorView.theme({
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
    '.cm-blame-gutter': { width: '36px', minWidth: '36px', maxWidth: '36px', padding: '0', flexShrink: '0' },
    '.cm-blame-gutter .cm-gutterElement': { padding: '0 4px', position: 'relative', boxSizing: 'border-box', overflow: 'visible' },
    '.cm-blame-spacer': { display: 'block', width: '28px' },
    '.cm-blame-badge': { display: 'block', width: '28px', height: '20px', margin: '0', padding: '0',
      border: '1px solid var(--theme-border)', borderRadius: '5px', background: 'hsl(var(--blame-hue) var(--theme-blame-saturation) var(--theme-blame-lightness))',
      color: 'var(--theme-blame-text)', font: '600 10px/18px system-ui, sans-serif', cursor: 'pointer' },
    '.cm-blame-badge:hover, .cm-blame-badge:focus-visible': { borderColor: 'var(--theme-accent)', outline: 'none' },
    '.cm-blame-rail::before': { content: '""', position: 'absolute', top: '0', bottom: '0', left: '17px',
      borderLeft: '1px solid var(--theme-border)' },
  })]
}
