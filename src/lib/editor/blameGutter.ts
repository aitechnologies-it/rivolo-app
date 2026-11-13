import { Facet, RangeSet, StateField, type EditorState } from '@codemirror/state'
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
  readonly author: string | null
  constructor(author: string | null) { super(); this.author = author }
  eq(other: Rail) { return this.author === other.author }
  toDOM() {
    const element = document.createElement('span')
    element.className = 'cm-blame-rail'
    element.style.setProperty('--blame-hue', String(authorHue(this.author)))
    return element
  }
}
class Badge extends GutterMarker {
  elementClass = 'cm-blame-start'
  readonly group: BlameGroup
  readonly open: (group: BlameGroup, anchor: HTMLElement) => void
  constructor(group: BlameGroup, open: Badge['open']) { super(); this.group = group; this.open = open }
  eq(other: Badge) {
    return this.open === other.open && this.group.author === other.group.author &&
    this.group.start === other.group.start && this.group.end === other.group.end &&
    this.group.dates.length === other.group.dates.length && this.group.dates.every((date, i) => date === other.group.dates[i])
  }
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

type BlameConfig = { dayId: string; attribution: LineAttribution[] | null; open: Badge['open'] }
const config = Facet.define<BlameConfig, BlameConfig>({ combine: (values) => values[0] })
const buildMarkers = (state: EditorState): RangeSet<GutterMarker> => {
  const { dayId, attribution, open } = state.facet(config)
  const groups = groupLineAttribution(attribution ?? [], dayId)
  const starts = new Map(groups.map((group) => [group.start, group]))
  const rails = new Map<string | null, Rail>()
  const ranges = []
  for (let index = 0; index < Math.min(attribution?.length ?? 0, state.doc.lines); index++) {
    const group = starts.get(index)
    const author = attribution![index].author
    if (!rails.has(author)) rails.set(author, new Rail(author))
    const marker: GutterMarker = group ? new Badge(group, open) : rails.get(author)!
    ranges.push(marker.range(state.doc.line(index + 1).from))
  }
  return RangeSet.of(ranges)
}
// Keep marker positions attached to text while the async attribution catches up.
// The field and gutter keep their identity across React reconfiguration.
const markers = StateField.define<RangeSet<GutterMarker>>({
  create: buildMarkers,
  update(value, transaction) {
    if (transaction.startState.facet(config) !== transaction.state.facet(config)) return buildMarkers(transaction.state)
    return transaction.docChanged ? value.map(transaction.changes) : value
  },
})
const authorGutter = gutter({
  class: 'cm-blame-gutter',
  renderEmptyElements: true,
  initialSpacer: () => new Spacer(),
  markers: (view) => view.state.field(markers),
})
const theme = EditorView.theme({
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
  '.cm-blame-gutter': { width: '36px', minWidth: '36px', maxWidth: '36px', padding: '0', flexShrink: '0' },
  '.cm-blame-gutter .cm-gutterElement': { padding: '0 4px', position: 'relative', boxSizing: 'border-box', overflow: 'visible' },
  '.cm-blame-spacer': { display: 'block', width: '28px' },
  '.cm-blame-badge': { display: 'block', width: '28px', height: '22px', margin: '0', padding: '0',
    border: '1px solid hsl(var(--blame-hue) 40% 50% / 0.65)', borderRadius: '5px', background: 'hsl(var(--blame-hue) var(--theme-blame-saturation) var(--theme-blame-lightness))',
    color: 'var(--theme-blame-text)', font: '600 11px/20px system-ui, sans-serif', boxSizing: 'border-box', cursor: 'pointer' },
  '.cm-blame-badge::before': { content: '""', position: 'absolute', top: '-1px', left: '1px', width: '34px', height: '24px' },
  '.cm-blame-badge:hover, .cm-blame-badge:focus-visible': { borderColor: 'var(--theme-accent)', outline: '2px solid var(--theme-accent)', outlineOffset: '1px' },
  '.cm-blame-rail, .cm-blame-badge::after': { display: 'block', position: 'absolute', top: '0', bottom: '0', left: '17px',
    width: '2px', background: 'hsl(var(--blame-hue) 40% 50% / 0.65)', pointerEvents: 'none' },
  '.cm-blame-badge::after': { content: '""', top: '24px' },
})

export const blameGutter = (dayId: string, attribution: LineAttribution[] | null, open: Badge['open']) =>
  [config.of({ dayId, attribution, open }), markers, authorGutter, theme]
