import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { SYNC_PROVIDER_IDS, type SyncProviderId } from '../../lib/syncState'

export const useSyncPanelNavigation = (activeProvider: SyncProviderId | null, ready: boolean) => {
  const location = useLocation()
  const [providerDraft, selectProvider] = useState<SyncProviderId | null>(null)
  const [openRequest, setOpenRequest] = useState(0)
  const [handledLocation, setHandledLocation] = useState<string | null>(null)

  // Apply each navigation once, after provider state has loaded. Subsequent manual
  // selections and collapses must remain under the user's control.
  if (ready && handledLocation !== location.key) {
    setHandledLocation(location.key)
    if (location.hash === '#settings-sync') {
      const requested = new URLSearchParams(location.search).get('syncProvider')
      const provider = SYNC_PROVIDER_IDS.find((id) => id === requested)
      selectProvider(provider ?? activeProvider)
      setOpenRequest(openRequest + 1)
    }
  }

  const openPanel = (provider: SyncProviderId | null = activeProvider) => {
    selectProvider(provider)
    setOpenRequest((request) => request + 1)
  }

  return { provider: providerDraft ?? activeProvider ?? 'dropbox', selectProvider, openPanel, openRequest }
}
