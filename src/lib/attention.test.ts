import { describe, expect, it } from 'vitest'
import { buildAttentionItems, getAttentionSettingsHref } from './attention'

// Upstream moved general attention coverage to AttentionBanner.test.tsx; this
// fork keeps the OneDrive-specific settings link here.
describe('buildAttentionItems', () => {
  it('links OneDrive notifications directly to its settings panel', () => {
    const [item] = buildAttentionItems({ persistFailureMessage: null, syncAttentionMessage: 'OneDrive is busy.',
      setupNotices: [], activeSyncProvider: 'onedrive' })
    expect(getAttentionSettingsHref(item)).toBe('/settings?syncProvider=onedrive#settings-sync')
  })
})
