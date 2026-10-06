import { formatDayTitle } from '../../lib/dates'
import type { BlameGroup } from '../../lib/editor/blameGutter'

export function DayBlameDetails({ group, left, top, onClose }: { group: BlameGroup; left: number; top: number; onClose: () => void }) {
  return <div role="dialog" aria-label="Line author details" className="absolute z-20 w-56 max-w-[calc(100%-16px)] rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg" style={{ left, top }}>
    <div className="flex items-start justify-between gap-2">
      <p className="min-w-0 break-words py-2 font-semibold">{group.author || 'Unknown author'}</p>
      <button type="button" aria-label="Close author details" onClick={onClose} className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg hover:bg-slate-50">×</button>
    </div>
    {group.dates.map((date) => <time key={date} dateTime={date} className="block">{formatDayTitle(date)}</time>)}
  </div>
}
