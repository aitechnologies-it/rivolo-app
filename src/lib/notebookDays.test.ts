import { describe, expect, it } from 'vitest'
import { dayPath, decodeNotebookDay, encodeNotebookDay, splitNotebookDays } from './notebookDays'
import { readNotebookAuthors, writeNotebookAuthors } from './oneDriveBlame'

const day = (dayId: string, contentMd = 'Caffè ☕\n\n<!-- day:2025-01-01 -->\n<!-- rivolo:authors:v1 AAA= -->') => ({ dayId, humanTitle: 'A title', contentMd })
describe('daily notebook codec', () => {
  it.each(['2024-02-29', '2026-01-01', '2027-01-01', '2026-12-31'])('round-trips Unicode and literal structural markers for %s', (id) => {
    expect(decodeNotebookDay(encodeNotebookDay(day(id)), id)).toEqual(day(id))
    expect(dayPath(id)).toBe(`${id.slice(0, 4)}/${id.slice(5, 7)}/${id}.md`)
  })
  it('accepts an explicitly empty day', () => { expect(decodeNotebookDay(encodeNotebookDay(day('2026-10-01', '')), '2026-10-01').contentMd).toBe('') })
  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '../2026-10-01'])('rejects invalid day %s', (id) => { expect(() => dayPath(id)).toThrow() })
  it('rejects duplicates, foreign days, and unmarked files', () => {
    const text = encodeNotebookDay(day('2026-10-01'))
    for (const invalid of [text + '\n\n' + text, encodeNotebookDay(day('2026-10-02')), 'No markers']) expect(() => decodeNotebookDay(invalid, '2026-10-01')).toThrow()
  })
  it('splits a multi-year notebook into one footer per day, preserving author fingerprints', async () => {
    const a = encodeNotebookDay(day('2026-01-01', 'One')), b = encodeNotebookDay(day('2027-01-01', 'Two'))
    const source = await writeNotebookAuthors(a + '\n\n' + b, new Map([['2026-01-01', ['Alice']], ['2027-01-01', ['Bob']]]))
    const files = await splitNotebookDays(source)
    expect(files.size).toBe(2)
    expect([...await readNotebookAuthors(files.get('2026-01-01')!)]).toEqual([['2026-01-01', ['Alice']]])
    expect([...await readNotebookAuthors(files.get('2027-01-01')!)]).toEqual([['2027-01-01', ['Bob']]])
  })
})
