import { describe, expect, it } from 'vitest'
import { authorInitials, groupLineAttribution } from './blameGutter'

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
})
