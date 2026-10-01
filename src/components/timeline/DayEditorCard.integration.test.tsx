import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DayEditorCard from './DayEditorCard'

vi.mock('../../store/useSyncStore', () => ({ useSyncStore: (select: (state: object) => unknown) => select({ activeProvider: 'onedrive' }) }))
vi.mock('./useDayAttribution', () => ({ useDayAttribution: () => ({ attribution: null, loading: false, failed: false }) }))
vi.mock('@uiw/react-codemirror', () => ({ default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
  <textarea aria-label="Note editor" value={value} onChange={(event) => onChange(event.target.value)} /> }))

describe('author toggle in the note editor', () => {
  it('retains the editor node, selection and editing when authors are enabled and disabled', async () => {
    const onChange = vi.fn(), onBlur = vi.fn()
    const day = { dayId: '2026-10-01', humanTitle: 'Thursday', contentMd: 'First\nSecond', createdAt: 1, updatedAt: 1 }
    render(<DayEditorCard day={day} shouldMountEditor={true} isFuture={false} isToday={true} isYesterday={false} isTomorrow={false}
      heroReveal={false} title="Today" humanDate="1 Oct" datePart="1 Oct" weekdayPart={undefined} relativeLabel="Today"
      searchQuery="" quote={null} dateError={null} autocorrection={false} markdownExtension={[]} editorTheme={[]} clearActiveLine={[]}
      titleFontFamily="inherit" previousDayId={null} nextDayId={null} onChange={onChange} onBlur={onBlur} onDelete={vi.fn()}
      onDateChange={vi.fn()} onFocusDay={vi.fn()} onRequestEditorMount={vi.fn()} registerEditor={vi.fn()} registerDayRef={vi.fn()} />)
    const editor = screen.getByRole('textbox', { name: 'Note editor' }) as HTMLTextAreaElement
    editor.setSelectionRange(1, 4)
    await userEvent.click(screen.getByRole('button', { name: 'Show line authors for 2026-10-01' }))
    expect(screen.getByRole('textbox', { name: 'Note editor' })).toBe(editor)
    expect(editor).toBeVisible()
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([1, 4])
    expect(editor.readOnly).toBe(false)
    fireEvent.change(editor, { target: { value: 'Edited\nSecond' } })
    expect(onChange).toHaveBeenCalledWith(day.dayId, 'Edited\nSecond')
    await userEvent.click(screen.getByRole('button', { name: 'Hide line authors for 2026-10-01' }))
    expect(screen.getByRole('textbox', { name: 'Note editor' })).toBe(editor)
    expect(editor).toBeVisible()
    expect(onBlur).toHaveBeenCalledWith(day.dayId)
  })
})
