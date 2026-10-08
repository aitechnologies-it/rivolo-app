import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DayEditorCardHeader } from './DayEditorCard'

const day = { dayId: '2026-10-01', humanTitle: 'Thursday', contentMd: 'Note', createdAt: 1, updatedAt: 1 }
const setup = () => {
  const onDelete = vi.fn()
  const props = { day, onDelete, onDateChange: vi.fn(), isFuture: false, isToday: true,
    isYesterday: false, isTomorrow: false, title: 'Today', humanDate: '1 Oct', datePart: '1 Oct', weekdayPart: undefined,
    relativeLabel: 'Today', titleFontFamily: 'inherit' }
  render(<div className="group"><DayEditorCardHeader {...props} /></div>)
  return { onDelete }
}
describe('day note actions', () => {
  it('keeps Delete available and closes the mobile menu after deleting', async () => {
    const { onDelete } = setup()
    const menu = screen.getByRole('button', { name: 'Open note actions' })
    await userEvent.click(menu)
    const panel = document.getElementById('day-actions-2026-10-01')!
    expect(within(panel).getByRole('button', { name: 'Delete note' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /line authors/ })).not.toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Delete note' }))
    expect(onDelete).toHaveBeenCalledWith(day.dayId)
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(panel).not.toBeInTheDocument()
  })
})
