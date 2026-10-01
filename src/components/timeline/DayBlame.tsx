import { useEffect, useState } from 'react'
import { getOneDriveState } from '../../lib/oneDriveState'
import { parseMarkdown } from '../../lib/markdown'
import { alignLineAuthors, readNotebookAuthors, type LineAuthor } from '../../lib/oneDriveBlame'
import { textLines } from '../../lib/sequenceDiff'
import { useSyncStore } from '../../store/useSyncStore'

export default function DayBlame({ dayId, content }: { dayId: string; content: string }) {
  const lastSyncAt = useSyncStore((state) => state.status.lastSyncAt)
  const [result, setResult] = useState<{ key: string; authors: LineAuthor[]; failed?: boolean } | null>(null)
  const [limit, setLimit] = useState(200)
  const key = `${dayId}:${lastSyncAt}:${content}`
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const state = await getOneDriveState()
      const baseline = state.mergeBaseContent ?? ''
      const baseDay = parseMarkdown(baseline).days.find((day) => day.dayId === dayId)
      const authors = await readNotebookAuthors(baseline, dayId)
      const aligned = alignLineAuthors(baseDay?.contentMd ?? '', content, authors.get(dayId) ?? [],
        state.mergeBaseContent === null ? null : state.accountName)
      if (!cancelled) setResult({ key, authors: aligned })
    })().catch(() => { if (!cancelled) setResult({ key, authors: [], failed: true }) })
    return () => { cancelled = true }
  }, [content, dayId, key])

  if (result?.key !== key) return <p role="status" className="py-3 text-xs text-slate-500">Loading authors…</p>
  if (result.failed) return <p role="alert" className="py-3 text-xs text-slate-500">Could not load authors. Close and reopen to retry.</p>
  const lines = textLines(content)
  return (
    <div className="mt-3 min-w-0" role="region" aria-label={`Line authors for ${dayId}`}>
      <p className="mb-2 text-xs text-slate-500">Last editor · Read-only · Unsynced edits show your name. Older or external edits may have an unknown author.</p>
      <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200">
        {lines.slice(0, limit).map((line, index) => (
          <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem] border-b border-slate-100 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <div className="min-w-0 whitespace-pre-wrap break-words px-2 py-1 text-sm [overflow-wrap:anywhere]">
              <span className="mr-2 select-none text-xs text-slate-400" aria-label={`Line ${index + 1}`}>{index + 1}</span>
              {line || '\u00a0'}
            </div>
            <div className="min-w-0 border-l border-slate-100 px-2 py-1 text-xs text-slate-500 [overflow-wrap:anywhere]">
              {line.trim() ? result.authors[index] || 'Unknown author' : ''}
            </div>
          </div>
        ))}
      </div>
      {lines.length > limit && <button type="button" className="mt-2 min-h-11 rounded-lg border border-slate-200 px-3 text-xs text-slate-600" onClick={() => setLimit((value) => value + 200)}>Show more lines</button>}
      {!lines.length && <p className="py-2 text-xs text-slate-500">No lines yet.</p>}
    </div>
  )
}
