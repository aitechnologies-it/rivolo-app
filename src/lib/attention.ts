import type { SetupNotice, SetupNoticeId } from './setupAttention'
import type { SyncProviderId } from './syncState'

export type AttentionItem = {
  id: string
  title: string
  description: string
  settingsSectionId: 'settings-ai' | 'settings-sync' | 'settings-data'
  dismissibleSetupNoticeId?: SetupNoticeId
  syncProvider?: SyncProviderId
}

export const getAttentionSettingsHref = (item: AttentionItem) =>
  `/settings${item.syncProvider ? `?syncProvider=${item.syncProvider}` : ''}#${item.settingsSectionId}`

type BuildAttentionItemsOptions = {
  persistFailureMessage: string | null
  syncAttentionMessage: string | null
  setupNotices: SetupNotice[]
  activeSyncProvider?: SyncProviderId | null
}

export const buildAttentionItems = ({
  persistFailureMessage,
  syncAttentionMessage,
  setupNotices,
  activeSyncProvider,
}: BuildAttentionItemsOptions): AttentionItem[] => [
  ...(persistFailureMessage
    ? [
        {
          id: 'persist-attention',
          title: "Notes aren't saving",
          description: persistFailureMessage,
          settingsSectionId: 'settings-data' as const,
        },
      ]
    : []),
  ...(syncAttentionMessage
    ? [
        {
          id: 'sync-attention',
          title: 'Sync needs attention',
          description: syncAttentionMessage,
          settingsSectionId: 'settings-sync' as const,
          syncProvider: activeSyncProvider ?? undefined,
        },
      ]
    : []),
  ...setupNotices.map((notice) => ({
    ...notice,
    dismissibleSetupNoticeId: notice.id,
  })),
]
