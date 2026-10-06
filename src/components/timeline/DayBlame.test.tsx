import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DayBlameDetails } from './DayBlame'
import { useDayAttribution } from './useDayAttribution'
import { writeNotebookAuthors, writeNotebookAttribution } from '../../lib/oneDriveBlame'
import { exportMarkdown } from '../../lib/markdown'
import { groupLineAttribution } from '../../lib/editor/blameGutter'

const mocks = vi.hoisted(() => ({ state: vi.fn() }))
vi.mock('../../lib/oneDriveState', () => ({ getOneDriveState: mocks.state }))
vi.mock('../../store/useSyncStore', () => ({ useSyncStore: (selector: (state: unknown) => unknown) => selector({ status: { lastSyncAt: 1 } }) }))
const dayId = '2026-10-01'
const notebook = (contentMd: string) => exportMarkdown([{ dayId, contentMd, humanTitle: 'Thursday', createdAt: 0, updatedAt: 0 }])
const timestamp = new Date(2026, 9, 2, 12).getTime()
beforeEach(() => { vi.clearAllMocks() })
describe('day author gutter data', () => {
  it('loads authors only when the gutter is enabled and previews unsynced changes', async () => {
    const mergeBaseContent = await writeNotebookAuthors(notebook('First\nSecond'), new Map([[dayId, ['Bob', 'Carol']]]))
    mocks.state.mockResolvedValue({ mergeBaseContent, accountName: 'Alice' })
    const { result, rerender } = renderHook(({ enabled }) => useDayAttribution(dayId, 'First\nChanged', timestamp, enabled), { initialProps: { enabled: false } })
    expect(mocks.state).not.toHaveBeenCalled()
    expect(result.current.attribution).toBeNull()
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.attribution).toEqual([{ author: 'Bob', date: null }, { author: 'Alice', date: '2026-10-02' }])
  })
  it('keeps dates and groups consecutive lines without splitting an author into different date blocks', async () => {
    const content = 'First\nSecond\nThird'
    const mergeBaseContent = await writeNotebookAttribution(notebook(content), new Map([[dayId, [
      { author: 'Bob', date: dayId }, { author: 'Bob', date: '2026-10-02' }, { author: 'Bob', date: null },
    ]]]))
    mocks.state.mockResolvedValue({ mergeBaseContent, accountName: 'Alice' })
    const { result } = renderHook(() => useDayAttribution(dayId, content, timestamp, true))
    await waitFor(() => expect(result.current.attribution).not.toBeNull())
    expect(groupLineAttribution(result.current.attribution!, dayId)).toEqual([{ author: 'Bob', start: 0, end: 2, dates: ['2026-10-02'] }])
  })
  it('does not assign the signed-in user or a date to untracked historical notes', async () => {
    mocks.state.mockResolvedValue({ mergeBaseContent: null, accountName: 'Alice' })
    const { result } = renderHook(() => useDayAttribution(dayId, 'Historical note', timestamp, true))
    await waitFor(() => expect(result.current.attribution).toEqual([{ author: null, date: null }]))
  })
  it('provides attribution for every line without truncating long notes', async () => {
    mocks.state.mockResolvedValue({ mergeBaseContent: null, accountName: 'Alice' })
    const { result } = renderHook(() => useDayAttribution(dayId, Array.from({ length: 205 }, (_, i) => `Row ${i}`).join('\n'), timestamp, true))
    await waitFor(() => expect(result.current.attribution).toHaveLength(205))
  })
  it('reports a load failure and retries after toggling authors', async () => {
    mocks.state.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ mergeBaseContent: null, accountName: 'Alice' })
    const { result, rerender } = renderHook(({ enabled }) => useDayAttribution(dayId, 'Note', timestamp, enabled), { initialProps: { enabled: true } })
    await waitFor(() => expect(result.current.failed).toBe(true))
    rerender({ enabled: false }); rerender({ enabled: true })
    await waitFor(() => expect(result.current.attribution).toEqual([{ author: null, date: null }]))
    expect(result.current.failed).toBe(false)
  })
  it('shows the full author and different dates in a closable detail popup', async () => {
    const onClose = vi.fn()
    render(<DayBlameDetails group={{ author: 'Caterina Bruchi', start: 0, end: 2, dates: ['2026-10-02'] }} left={8} top={30} onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Line author details' })).toHaveTextContent('Caterina Bruchi')
    expect(screen.getByText('Oct 02, 2026')).toHaveAttribute('datetime', '2026-10-02')
    await userEvent.click(screen.getByRole('button', { name: 'Close author details' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
