import { beforeEach, describe, expect, it, vi } from 'vitest'
const sync = vi.hoisted(() => ({ getActiveProviderId: vi.fn(), getActiveProviderStatus: vi.fn(),
  getEmptySyncStatus: vi.fn(() => ({ connected: false, localDirty: false })), setActiveProviderId: vi.fn() }))
vi.mock('../lib/sync', () => sync)
import { useSyncStore } from './useSyncStore'

describe('sync notification lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSyncStore.setState({ activeProvider: 'onedrive',
      syncAttention: { operation: 'push', message: 'OneDrive changed remotely.', at: 1 } })
    sync.getActiveProviderStatus.mockResolvedValue({ connected: true, localDirty: false })
  })
  it('clears OneDrive attention when disconnecting the active provider', async () => {
    sync.getActiveProviderId.mockResolvedValue(null)
    await useSyncStore.getState().loadState()
    expect(useSyncStore.getState().syncAttention).toBeNull()
  })
  it('clears old attention when activating another provider', async () => {
    await useSyncStore.getState().setActiveProvider('dropbox')
    expect(useSyncStore.getState().syncAttention).toBeNull()
  })
  it('preserves an unresolved issue during an ordinary state refresh', async () => {
    sync.getActiveProviderId.mockResolvedValue('onedrive')
    await useSyncStore.getState().loadState()
    expect(useSyncStore.getState().syncAttention?.message).toBe('OneDrive changed remotely.')
  })
})
