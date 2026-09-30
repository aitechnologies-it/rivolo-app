import { describe, expect, it } from 'vitest'
import { mergeOneDriveNotebooks, mergeOneDriveParagraphs } from './oneDriveMerge'
import { parseMarkdown } from './markdown'

describe('OneDrive paragraph merge', () => {
  it('keeps both users’ new paragraphs together, remote first', () => {
    expect(mergeOneDriveParagraphs('Existing', 'Existing\n\nAlice 1\n\nAlice 2', 'Existing\n\nBob 1\n\nBob 2'))
      .toBe('Existing\n\nBob 1\n\nBob 2\n\nAlice 1\n\nAlice 2')
  })
  it('uses the last push for edits to the same existing paragraph and keeps both additions', () => {
    expect(mergeOneDriveParagraphs('Existing', 'Alice edit\n\nAlice new', 'Bob edit\n\nBob new'))
      .toBe('Alice edit\n\nBob new\n\nAlice new')
  })
  it('preserves independent edits and insertions in different places', () => {
    expect(mergeOneDriveParagraphs('A\n\nB\n\nC', 'A edited\n\nB\n\nL\n\nC', 'A\n\nR\n\nB\n\nC edited'))
      .toBe('A edited\n\nR\n\nB\n\nL\n\nC edited')
  })
  it('does not duplicate additions on retry, while preserving intentional repeated paragraphs', () => {
    expect(mergeOneDriveParagraphs('A', 'A\n\nL\n\nL', 'A\n\nR\n\nL\n\nL'))
      .toBe('A\n\nR\n\nL\n\nL')
  })
  it('keeps fenced code with internal blank lines intact', () => {
    const code = '```js\nconst a = 1\n\nconst b = 2\n```'
    expect(mergeOneDriveParagraphs(code, `${code}\n\nL`, `${code}\n\nR`)).toBe(`${code}\n\nR\n\nL`)
  })
  it('preserves unilateral deletion and lets the last conflicting edit win', () => {
    expect(mergeOneDriveParagraphs('A\n\nB', 'A\n\nB', 'A')).toBe('A')
    expect(mergeOneDriveParagraphs('A\n\nB', 'A\n\nB edited', 'A')).toBe('A\n\nB edited')
  })
})

const day = (id: string, text: string) => `<!-- day:${id} -->\n${id}\n---\n\n${text}`
describe('OneDrive whole notebook merge', () => {
  it('merges new days and additions to the same new day without duplicate markers', () => {
    const base = day('2026-09-28', 'Old')
    const local = `${base}\n\n${day('2026-09-30', 'Alice')}`
    const remote = `${base}\n\n${day('2026-09-29', 'Bob yesterday')}\n\n${day('2026-09-30', 'Bob')}`
    const result = parseMarkdown(mergeOneDriveNotebooks(base, local, remote))
    expect(result.warnings).toEqual([])
    expect(result.days.map((entry) => [entry.dayId, entry.contentMd])).toEqual([
      ['2026-09-30', 'Bob\n\nAlice'], ['2026-09-29', 'Bob yesterday'], ['2026-09-28', 'Old'],
    ])
  })
  it('applies a remote day deletion while retaining a different local addition', () => {
    const base = `${day('2026-09-28', 'Old')}\n\n${day('2026-09-29', 'Keep')}`
    const local = `${base}\n\n${day('2026-09-30', 'New')}`
    const result = parseMarkdown(mergeOneDriveNotebooks(base, local, day('2026-09-29', 'Keep')))
    expect(result.days.map((entry) => entry.dayId)).toEqual(['2026-09-30', '2026-09-29'])
  })
  it('rejects malformed remote content instead of silently discarding it', () => {
    const base = day('2026-09-30', 'Old')
    expect(() => mergeOneDriveNotebooks(base, base, 'broken')).toThrow('day markers')
    expect(() => mergeOneDriveNotebooks(base, base, `${base}\n\n${base}`)).toThrow('day markers')
  })
})
