import { describe, expect, it } from 'vitest'
import { annotateLocalNotebook, readNotebookAuthors, writeNotebookAuthors } from './oneDriveBlame'
import { mergeOneDriveNotebooksWithAuthors } from './oneDriveMerge'
import { exportMarkdown, parseMarkdown } from './markdown'
import { appendAuthorsMetadata } from './notebookMetadata'

const dayId = '2026-10-01'
const notebook = (text: string) => exportMarkdown([{ dayId, humanTitle: 'Thursday', contentMd: text, createdAt: 0, updatedAt: 0 }])
const attributed = (text: string, names: (string | null)[]) => writeNotebookAuthors(notebook(text), new Map([[dayId, names]]))

describe('OneDrive line attribution', () => {
  it('shares names in metadata without changing visible Markdown or leaking it into notes', async () => {
    const file = await attributed('Caffè ☕\nSecond', ['Caterina Bruchi', 'José'])
    expect(parseMarkdown(file).days[0].contentMd).toBe('Caffè ☕\nSecond')
    expect((await readNotebookAuthors(file)).get(dayId)).toEqual(['Caterina Bruchi', 'José'])
  })
  it('preserves unchanged authors and assigns only added/changed local lines', async () => {
    const base = await attributed('First\nSecond', ['Bob', 'Bob'])
    const local = await annotateLocalNotebook(notebook('First\nChanged\nNew'), base, 'Alice')
    expect((await readNotebookAuthors(local)).get(dayId)).toEqual(['Bob', 'Alice', 'Alice'])
  })
  it('tracks both writers and the winning editor on conflicts', async () => {
    const base = await attributed('First\nSecond', ['Original', 'Original'])
    const local = await annotateLocalNotebook(notebook('Alice first\nSecond\nAlice added'), base, 'Alice')
    const remote = await annotateLocalNotebook(notebook('Bob first\nBob second\nBob added'), base, 'Bob')
    const merged = await mergeOneDriveNotebooksWithAuthors(base, local, remote)
    expect(parseMarkdown(merged).days[0].contentMd).toBe('Alice first\nBob second\nBob added\nAlice added')
    expect((await readNotebookAuthors(merged)).get(dayId)).toEqual(['Alice', 'Bob', 'Bob', 'Alice'])
  })
  it('does not invent authors for notes predating tracking', async () => {
    const file = await annotateLocalNotebook(notebook('History'), null, 'Alice')
    expect((await readNotebookAuthors(file)).get(dayId)).toEqual([null])
  })
  it('invalidates stale external metadata and preserves known unchanged lines while merging', async () => {
    const base = await attributed('First\nSecond', ['Bob', 'Bob'])
    const external = base.replace('Second', 'External edit')
    expect((await readNotebookAuthors(external)).has(dayId)).toBe(false)
    const merged = await mergeOneDriveNotebooksWithAuthors(base, base, external)
    expect((await readNotebookAuthors(merged)).get(dayId)).toEqual(['Bob', null])
  })
  it('ignores malformed metadata without discarding the note', async () => {
    const file = appendAuthorsMetadata(notebook('Safe'), { names: [3], days: null })
    expect((await readNotebookAuthors(file)).size).toBe(0)
    expect(parseMarkdown(file).days[0].contentMd).toBe('Safe')
  })
  it('round-trips literal metadata examples inside note text', () => {
    const text = 'Example\n\n<!-- rivolo:authors:v1 e30= -->'
    expect(parseMarkdown(notebook(text)).days[0].contentMd).toBe(text)
  })
  it('keeps repeated lines correctly attributed after an insertion', async () => {
    const base = await attributed('Same\nSame\nEnd', ['Alice', 'Bob', 'Bob'])
    const next = await annotateLocalNotebook(notebook('Same\nNew\nSame\nEnd'), base, 'Carol')
    expect((await readNotebookAuthors(next)).get(dayId)).toEqual(['Alice', 'Carol', 'Bob', 'Bob'])
  })
})
