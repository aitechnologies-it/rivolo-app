import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DayEditorCardHeader } from './DayEditorCard'

const day = { dayId: '2026-10-01', humanTitle: 'Thursday', contentMd: 'Note', createdAt: 1, updatedAt: 1 }
const setup = (showBlameButton = true, blameOpen = false) => {
  const onToggleBlame = vi.fn(), onDelete = vi.fn()
  const props = { day, showBlameButton, blameOpen, onToggleBlame, onDelete, onDateChange: vi.fn(), isFuture: false, isToday: true,
    isYesterday: false, isTomorrow: false, title: 'Today', humanDate: '1 Oct', datePart: '1 Oct', weekdayPart: undefined,
    relativeLabel: 'Today', titleFontFamily: 'inherit' }
  render(<div className="group"><DayEditorCardHeader {...props} /></div>)
  return { onToggleBlame, onDelete }
}
describe('day author actions', () => {
  it('keeps desktop Authors in the hover controls and mobile Authors beside Delete in the actions menu', async () => {
    const { onToggleBlame, onDelete } = setup()
    const menu = screen.getByRole('button', { name: 'Open note actions' })
    await userEvent.click(menu)
    const panel = document.getElementById('day-actions-2026-10-01')!
    expect(within(panel).getByRole('button', { name: 'Delete note' })).toBeVisible()
    await userEvent.click(within(panel).getByRole('button', { name: 'Show line authors for 2026-10-01' }))
    expect(onToggleBlame).toHaveBeenCalledOnce()
    expect(onDelete).not.toHaveBeenCalled()
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(panel).not.toBeInTheDocument()
  })
  it('lets mobile users hide authors through the same menu while keeping the editor', async () => {
    const { onToggleBlame } = setup(true, true)
    await userEvent.click(screen.getByRole('button', { name: 'Open note actions' }))
    const panel = document.getElementById('day-actions-2026-10-01')!
    expect(within(panel).getByRole('button', { name: 'Hide line authors for 2026-10-01' })).toHaveTextContent('Hide authors')
    await userEvent.click(within(panel).getByRole('button', { name: 'Hide line authors for 2026-10-01' }))
    expect(onToggleBlame).toHaveBeenCalledOnce()
  })
  it('keeps the delete action available without authors for other providers', async () => {
    setup(false)
    await userEvent.click(screen.getByRole('button', { name: 'Open note actions' }))
    expect(screen.queryByRole('button', { name: /line authors/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeVisible()
  })
})
