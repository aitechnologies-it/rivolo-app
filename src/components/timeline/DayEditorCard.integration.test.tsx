import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DayEditorCard from './DayEditorCard'
import { exportMarkdown, parseMarkdown } from '../../lib/markdown'
import { writeNotebookAuthors } from '../../lib/oneDriveBlame'

vi.mock('../../store/useSyncStore', () => ({ useSyncStore: (select: (state: object) => unknown) => select({ activeProvider: 'onedrive' }) }))
vi.mock('./useDayAttribution', () => ({ useDayAttribution: () => ({ attribution: null, loading: false, failed: false }) }))
vi.mock('@uiw/react-codemirror', () => ({ default: ({ value, onChange, onBlur }: {
  value: string; onChange: (value: string) => void; onBlur: (event: { nativeEvent: FocusEvent }) => void
}) => <textarea aria-label="Note editor" value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} /> }))

describe('note editor sync refresh', () => {
  it('retains the empty paragraph, editor node and cursor when its saved document returns', async () => {
    const onChange = vi.fn(), onBlur = vi.fn()
    const day = { dayId: '2026-10-01', humanTitle: 'Thursday', contentMd: 'First\nSecond\n\n', createdAt: 1, updatedAt: 1 }
    const card = (contentMd: string, updatedAt: number) => <DayEditorCard day={{ ...day, contentMd, updatedAt }} shouldMountEditor={true} isFuture={false} isToday={true} isYesterday={false} isTomorrow={false}
      heroReveal={false} title="Today" humanDate="1 Oct" datePart="1 Oct" weekdayPart={undefined} relativeLabel="Today"
      searchQuery="" quote={null} dateError={null} autocorrection={false} markdownExtension={[]} editorTheme={[]} clearActiveLine={[]}
      titleFontFamily="inherit" previousDayId={null} nextDayId={null} onChange={onChange} onBlur={onBlur} onDelete={vi.fn()}
      onDateChange={vi.fn()} onFocusDay={vi.fn()} onRequestEditorMount={vi.fn()} registerEditor={vi.fn()} registerDayRef={vi.fn()} />
    const { rerender } = render(card(day.contentMd, 1))
    const editor = screen.getByRole('textbox', { name: 'Note editor' }) as HTMLTextAreaElement
    editor.focus()
    editor.setSelectionRange(day.contentMd.length, day.contentMd.length)
    const saved = await writeNotebookAuthors(exportMarkdown([day]), new Map([[day.dayId, ['Bob', 'Bob', 'Alice', 'Alice']]]))
    rerender(card(parseMarkdown(saved).days[0].contentMd, 2))
    expect(screen.getByRole('textbox', { name: 'Note editor' })).toBe(editor)
    expect(editor).toBeVisible()
    expect(editor).toHaveValue(day.contentMd)
    expect(editor).toHaveFocus()
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([day.contentMd.length, day.contentMd.length])
    expect(screen.queryByRole('button', { name: /(?:Show|Hide) line authors/ })).not.toBeInTheDocument()
    expect(editor.readOnly).toBe(false)
    fireEvent.change(editor, { target: { value: 'First\nSecond\n\nContinued' } })
    expect(onChange).toHaveBeenCalledWith(day.dayId, 'First\nSecond\n\nContinued')
    fireEvent.blur(editor)
    expect(screen.getByRole('textbox', { name: 'Note editor' })).toBe(editor)
    expect(editor).toBeVisible()
    expect(onBlur).toHaveBeenCalledWith(day.dayId, expect.anything())
  })
})
