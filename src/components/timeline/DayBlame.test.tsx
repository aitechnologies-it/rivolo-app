import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DayBlame from './DayBlame'
import { writeNotebookAuthors } from '../../lib/oneDriveBlame'
import { exportMarkdown } from '../../lib/markdown'

const mocks = vi.hoisted(() => ({ state: vi.fn() }))
vi.mock('../../lib/oneDriveState', () => ({ getOneDriveState: mocks.state }))
vi.mock('../../store/useSyncStore', () => ({ useSyncStore: (selector: (state: unknown) => unknown) => selector({ status: { lastSyncAt: 1 } }) }))
const dayId = '2026-10-01'
const notebook = (contentMd: string) => exportMarkdown([{ dayId, contentMd, humanTitle: 'Thursday', createdAt: 0, updatedAt: 0 }])

beforeEach(() => { vi.clearAllMocks() })
describe('day authors view', () => {
  it('shows the author beside each line, and previews the current user for unsynced changes', async () => {
    const mergeBaseContent = await writeNotebookAuthors(notebook('First\nSecond'), new Map([[dayId, ['Bob', 'Carol']]]))
    mocks.state.mockResolvedValue({ mergeBaseContent, accountName: 'Alice' })
    render(<DayBlame dayId={dayId} content={'First\nChanged'} />)
    expect(await screen.findByText('Bob')).toBeVisible()
    expect(screen.getByText('Alice')).toBeVisible()
    expect(screen.queryByText('Carol')).not.toBeInTheDocument()
  })
  it('shows unknown for older content instead of assigning the signed-in user', async () => {
    mocks.state.mockResolvedValue({ mergeBaseContent: null, accountName: 'Alice' })
    render(<DayBlame dayId={dayId} content="Historical note" />)
    expect(await screen.findByText('Unknown author')).toBeVisible()
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })
  it('renders long notes incrementally', async () => {
    mocks.state.mockResolvedValue({ mergeBaseContent: null, accountName: 'Alice' })
    render(<DayBlame dayId={dayId} content={Array.from({ length: 205 }, (_, i) => `Row ${i}`).join('\n')} />)
    const more = await screen.findByRole('button', { name: 'Show more lines' })
    expect(screen.queryByText('Row 204')).not.toBeInTheDocument()
    await userEvent.click(more)
    expect(screen.getByText('Row 204')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Show more lines' })).not.toBeInTheDocument()
  })
})
