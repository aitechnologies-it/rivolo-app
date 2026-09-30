import { useCallback, useEffect, useRef } from 'react'
import { getTabSyncBlockReason } from '../../lib/tabSyncCoordinator'
import type { SyncProviderId } from '../../lib/sync'
import {
  blockedPushMessage,
  pullFromSyncAndRefresh,
  pushToSyncAndRefresh,
  recordSyncAttention,
} from '../../store/syncActions'

type AutoSyncStatus = {
  connected: boolean
  targetName: string | null
  localDirty: boolean
}

const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 1000
const ONEDRIVE_SYNC_INTERVAL_MS = 5_000
const FOREGROUND_BACKGROUND_MIN_MS = 15 * 1000

type AutoSyncReason = 'start' | 'reconnect' | 'foreground' | 'interval' | 'queued'

export const useAutoSync = (status: AutoSyncStatus, provider: SyncProviderId | null = null) => {
  const statusRef = useRef({ ...status, provider })
  const retryAt = useRef(0)
  const failures = useRef(0)
  const intervalMs = provider === 'onedrive' ? ONEDRIVE_SYNC_INTERVAL_MS : AUTO_SYNC_INTERVAL_MS
  const lastAutoSyncAt = useRef(0)
  const autoSyncInFlight = useRef(false)
  const autoSyncRequestedWhileRunning = useRef(false)
  const backgroundedAt = useRef<number | null>(null)

  useEffect(() => {
    statusRef.current = { ...status, provider }
  }, [status, provider])

  useEffect(() => {
    retryAt.current = 0
    failures.current = 0
  }, [provider, status.targetName, status.connected])

  const reconcileOnce = useCallback(
    async (reason: AutoSyncReason) => {
      const currentStatus = statusRef.current
      if (!navigator.onLine) return
      if (!currentStatus.connected || !currentStatus.targetName) return
      if (getTabSyncBlockReason()) return

      const now = Date.now()
      const isOneDrive = currentStatus.provider === 'onedrive'
      if (isOneDrive && now < retryAt.current) return
      const interval = isOneDrive ? ONEDRIVE_SYNC_INTERVAL_MS : AUTO_SYNC_INTERVAL_MS
      if (reason === 'interval' && now - lastAutoSyncAt.current < interval) {
        return
      }

      lastAutoSyncAt.current = now
      const failed = () => {
        if (isOneDrive) {
          failures.current += 1
          retryAt.current = Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(failures.current, 4))
        }
      }
      const succeeded = () => { failures.current = 0; retryAt.current = 0 }

      if (currentStatus.localDirty) {
        console.info('[Sync] auto-push:trigger', { reason })
        try {
          const result = await pushToSyncAndRefresh(false)
          succeeded()
          if (result.status === 'blocked') {
            recordSyncAttention('push', blockedPushMessage(result.reason))
          }
        } catch (error: unknown) {
          failed()
          recordSyncAttention(
            'push',
            error instanceof Error ? error.message : 'Automatic push failed.',
          )
        }
        return
      }

      console.info('[Sync] auto-pull:trigger', { reason })
      try {
        await pullFromSyncAndRefresh({ force: false })
        succeeded()
      } catch (error: unknown) {
        failed()
        recordSyncAttention(
          'pull',
          error instanceof Error ? error.message : 'Automatic pull failed.',
        )
      }
    },
    [],
  )

  const maybeAutoSync = useCallback(
    async (reason: AutoSyncReason) => {
      if (autoSyncInFlight.current) {
        autoSyncRequestedWhileRunning.current = true
        return
      }

      autoSyncInFlight.current = true
      try {
        let nextReason = reason
        do {
          autoSyncRequestedWhileRunning.current = false
          await reconcileOnce(nextReason)
          nextReason = 'queued'
        } while (autoSyncRequestedWhileRunning.current)
      } finally {
        autoSyncInFlight.current = false
      }
    },
    [reconcileOnce],
  )

  useEffect(() => {
    console.info('[Sync] auto-sync:event', { reason: 'start' })
    void maybeAutoSync('start')
  }, [maybeAutoSync, status.connected, status.targetName, provider])

  useEffect(() => {
    if (!status.connected || !status.targetName) return

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      console.info('[Sync] auto-sync:event', { reason: 'interval' })
      void maybeAutoSync('interval')
    }, intervalMs)

    return () => window.clearInterval(intervalId)
  }, [maybeAutoSync, status.connected, status.targetName, intervalMs])

  useEffect(() => {
    const handleOnline = () => {
      console.info('[Sync] auto-sync:event', { reason: 'reconnect' })
      void maybeAutoSync('reconnect')
    }
    const handleBackground = () => {
      if (backgroundedAt.current === null) {
        backgroundedAt.current = Date.now()
      }
    }
    const handleForeground = () => {
      if (document.visibilityState !== 'visible') return

      const startedAt = backgroundedAt.current
      backgroundedAt.current = null
      if (
        startedAt === null ||
        (statusRef.current.provider !== 'onedrive' && Date.now() - startedAt < FOREGROUND_BACKGROUND_MIN_MS)
      ) {
        return
      }

      console.info('[Sync] auto-sync:event', { reason: 'foreground' })
      void maybeAutoSync('foreground')
    }
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') {
        handleBackground()
        return
      }
      handleForeground()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('blur', handleBackground)
    window.addEventListener('focus', handleForeground)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('blur', handleBackground)
      window.removeEventListener('focus', handleForeground)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [maybeAutoSync])
}
