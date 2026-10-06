import { useEffect, useState } from 'react'
import { getOneDriveState } from '../../lib/oneDriveState'
import { getDailyState, targetFromState } from '../../lib/oneDriveDailyState'
import { parseMarkdown } from '../../lib/markdown'
import { alignLineAttribution, editDayId, readNotebookAttribution, type LineAttribution } from '../../lib/oneDriveBlame'
import { useSyncStore } from '../../store/useSyncStore'

export function useDayAttribution(dayId: string, content: string, editedAt: number, enabled: boolean) {
  const lastSyncAt = useSyncStore((state) => state.status.lastSyncAt)
  const [result, setResult] = useState<{ key: string; attribution: LineAttribution[]; failed?: boolean } | null>(null)
  const key = `${dayId}:${lastSyncAt}:${editedAt}:${content}`
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      const state = await getOneDriveState()
      const target = targetFromState(state)
      const dayState = target ? await getDailyState(target, dayId) : null
      const baseline = dayState?.baseline ?? state.mergeBaseContent ?? ''
      const baseDay = parseMarkdown(baseline).days.find((day) => day.dayId === dayId)
      const attribution = await readNotebookAttribution(baseline, dayId)
      const author = !dayState?.baseline && state.mergeBaseContent === null ? null : state.accountName
      const aligned = alignLineAttribution(baseDay?.contentMd ?? '', content, attribution.get(dayId) ?? [],
        { author, date: author ? editDayId(editedAt) : null })
      if (!cancelled) setResult({ key, attribution: aligned })
    })().catch(() => { if (!cancelled) setResult({ key, attribution: [], failed: true }) })
    return () => { cancelled = true }
  }, [content, dayId, editedAt, enabled, key])
  return {
    attribution: enabled && result?.key === key && !result.failed ? result.attribution : null,
    loading: enabled && result?.key !== key,
    failed: enabled && result?.key === key && Boolean(result.failed),
  }
}

