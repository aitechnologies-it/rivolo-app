// Regression tests from the OneDrive audit (2026-11-12): auto-sync scheduling.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoSync } from './useAutoSync'
import { registerPendingEditorSaves } from '../../lib/pendingEditorSaves'

type DayEvent = { type: 'day-changed'; dayId: string; item: string; revision: string }
const events = vi.hoisted(() => ({ startDailyOneDriveEvents: vi.fn<(target: unknown, onChanged: (event?: DayEvent) => void) => () => void>(() => vi.fn()) }))
const provider = vi.hoisted(() => ({ getActiveProviderStatus: vi.fn() }))
const actions = vi.hoisted(() => ({ blockedPushMessage: vi.fn(), pullFromSyncAndRefresh: vi.fn(), pushToSyncAndRefresh: vi.fn(), recordSyncAttention: vi.fn(), clearSyncIssue: vi.fn() }))
vi.mock('../../lib/oneDriveState', () => ({ getOneDriveState: async () => ({ folderId: '/drives/owner/items/notebook', accountId: 'alice', targetGeneration: 1 }) }))
vi.mock('../../lib/oneDriveDailyState', () => ({ targetFromState: () => ({ folder: '/drives/owner/items/notebook', account: 'alice', generation: 1 }) }))
vi.mock('../../lib/oneDriveEvents', () => events)
vi.mock('../../lib/sync', () => provider)
vi.mock('../../lib/tabSyncCoordinator', () => ({ getTabSyncBlockReason: () => null }))
vi.mock('../../store/syncActions', () => actions)

const status = { connected: true, targetName: '/Rivolo', notebookChannel: '/drives/owner/items/notebook', localDirty: false }
const day = (dayId: string): DayEvent => ({ type: 'day-changed', dayId, item: `/drives/owner/items/${dayId}`, revision: 'v2' })
const start = async () => {
  const hook = renderHook(() => useAutoSync(status, 'onedrive'))
  await act(async () => Promise.resolve())
  return { hook, changed: events.startDailyOneDriveEvents.mock.calls[0][1] }
}

describe('OneDrive auto-sync audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    provider.getActiveProviderStatus.mockResolvedValue({ localDirty: false })
    actions.pullFromSyncAndRefresh.mockResolvedValue({ status: 'noop' })
    actions.pushToSyncAndRefresh.mockResolvedValue({ status: 'clean' })
  })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

  it('does not check OneDrive every second while the user keeps typing', async () => {
    const unregister = registerPendingEditorSaves(() => ['2026-10-01'])
    const { hook } = await start()
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      // Measured: 31 pulls in 30 seconds, each a full folder listing here
      // because no day was reported as deferred.
      expect(actions.pullFromSyncAndRefresh.mock.calls.length).toBeLessThanOrEqual(5)
    } finally { unregister(); hook.unmount() }
  })

  it('still lists the folder after a deletion notice that arrives during a single-day check', async () => {
    const { hook, changed } = await start()
    let finish!: (value: { status: 'noop'; deferredDayIds: string[] }) => void
    actions.pullFromSyncAndRefresh.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    await act(async () => changed(day('2026-10-01')))
    // While that check runs: a collaborator deletes a day (inventory notice)
    // and the day being checked is deferred because the user is typing in it.
    await act(async () => changed())
    actions.pullFromSyncAndRefresh.mockResolvedValue({ status: 'noop' })
    await act(async () => { finish({ status: 'noop', deferredDayIds: ['2026-10-01'] }); await vi.advanceTimersByTimeAsync(2_000) })
    const later = actions.pullFromSyncAndRefresh.mock.calls.slice(2).map(([options]) => options)
    expect(later).toContainEqual({ force: false })
    hook.unmount()
  })

  it('measures a return to the app: the folder is listed twice, once on focus and once when live updates reconnect', async () => {
    const { hook, changed } = await start()
    actions.pullFromSyncAndRefresh.mockClear()
    act(() => window.dispatchEvent(new Event('blur')))
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve() })
    await act(async () => changed()) // the relay's "ready" after the socket reconnects
    expect(actions.pullFromSyncAndRefresh.mock.calls).toEqual([[{ force: false }], [{ force: false }]])
    hook.unmount()
  })
})
