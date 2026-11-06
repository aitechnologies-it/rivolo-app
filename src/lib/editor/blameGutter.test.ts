import { describe, expect, it, vi } from 'vitest'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { authorInitials, blameGutter, groupLineAttribution } from './blameGutter'

describe('line author gutter', () => {
  it('uses display-name initials, supports Unicode and marks unknown authors', () => {
    expect(authorInitials(' Caterina   Bruchi ')).toBe('CB')
    expect(authorInitials('José Álvarez')).toBe('JÁ')
    expect(authorInitials('Alice')).toBe('AL')
    expect(authorInitials('Li')).toBe('LI')
    expect(authorInitials(null)).toBe('?')
    expect(authorInitials('  ')).toBe('?')
  })
  it('keeps distinct author blocks and only unique edit dates different from the note day', () => {
    expect(groupLineAttribution([
      { author: 'Bob', date: '2026-10-01' }, { author: 'Bob', date: '2026-10-02' },
      { author: 'Bob', date: '2026-10-02' }, { author: 'Carol', date: null }, { author: 'Bob', date: null },
    ], '2026-10-01')).toEqual([
      { author: 'Bob', start: 0, end: 2, dates: ['2026-10-02'] },
      { author: 'Carol', start: 3, end: 3, dates: [] }, { author: 'Bob', start: 4, end: 4, dates: [] },
    ])
    expect(groupLineAttribution([], '2026-10-01')).toEqual([])
  })
  it('reuses badge DOM through typing and attribution refresh, and moves blocks with inserted lines', () => {
    const compartment = new Compartment()
    const open = vi.fn()
    const attribution = [{ author: 'Bob', date: null }, { author: 'Carol', date: null }]
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({ parent, state: EditorState.create({ doc: 'First\nSecond',
      extensions: [compartment.of(blameGutter('2026-10-01', attribution, open))] }) })
    try {
      const bob = parent.querySelector('.cm-blame-badge')
      expect(bob).not.toBeNull()
      view.dispatch({ changes: { from: 2, insert: 'x' } })
      expect(parent.querySelector('.cm-blame-badge')).toBe(bob)
      view.dispatch({ effects: compartment.reconfigure(blameGutter('2026-10-01', [...attribution], open)) })
      expect(parent.querySelector('.cm-blame-badge')).toBe(bob)
      view.dispatch({ changes: { from: 5, insert: '\nInserted' } })
      const carol = parent.querySelector('[aria-label="Carol"]')
      expect([...parent.querySelectorAll('.cm-blame-gutter .cm-gutterElement')].indexOf(carol!.parentElement!)).toBe(3)
      const button = bob as HTMLButtonElement
      button.click()
      expect(open).toHaveBeenCalledOnce()
    } finally { view.destroy(); parent.remove() }
  })

})
