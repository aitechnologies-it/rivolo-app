import { useEffect, useRef, type RefObject } from 'react'
import { isApplePlatform } from '../../lib/device'

type ShortcutsPopoverProps = {
  shortcutsRef: RefObject<HTMLDivElement | null>
  showShortcuts: boolean
  onToggle: () => void
  buttonClassName: string
}

export default function ShortcutsPopover({
  shortcutsRef,
  showShortcuts,
  onToggle,
  buttonClassName,
}: ShortcutsPopoverProps) {
  const primaryModifierLabel = isApplePlatform() ? 'Cmd' : 'Ctrl'
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!showShortcuts) return
    dialogRef.current?.focus({ preventScroll: true })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      onToggle()
      triggerRef.current?.focus()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onToggle, showShortcuts])

  return (
    <div ref={shortcutsRef} className="hero-ui-fade-up relative">
      <button
        ref={triggerRef}
        className={buttonClassName}
        type="button"
        aria-label="Help and shortcuts"
        aria-expanded={showShortcuts}
        aria-haspopup="dialog"
        onClick={onToggle}
      >
        <img src="/question-mark.svg" alt="" className="h-5 w-5" />
      </button>
      {showShortcuts && (
        <div
          ref={dialogRef}
          tabIndex={-1}
          className="absolute left-0 z-20 mt-2 max-h-[calc(100dvh-12rem-env(safe-area-inset-bottom))] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-lg focus:outline-none"
          role="dialog"
          aria-label="Help and shortcuts"
        >
          <div className="grid gap-4">
            <section lang="it" aria-labelledby="project-tag-guide-title" className="space-y-3 text-sm leading-relaxed">
              <div className="flex items-center justify-between gap-2">
                <h2 id="project-tag-guide-title" className="font-semibold text-[var(--theme-text)]">Hashtag e progetti</h2>
                <button
                  type="button"
                  aria-label="Close help"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--theme-text-muted)] hover:bg-[var(--theme-hover)]"
                  onClick={() => {
                    onToggle()
                    triggerRef.current?.focus()
                  }}
                >
                  <span aria-hidden="true" className="text-xl">×</span>
                </button>
              </div>
              <ul className="list-disc space-y-2 pl-4">
                <li>Scrivi <code className="text-[var(--theme-tag)]">#progetto</code> nelle note.</li>
                <li>Stesso progetto, <strong>stesso tag</strong>: minuscolo e senza spazi.</li>
                <li>Aggiungi <code>#idea</code> o <code>#followup</code> per il tipo di nota.</li>
              </ul>
              <code className="block break-words rounded-lg bg-[var(--theme-surface-soft)] p-3">Inviare bozza #fcrf #followup</code>
              <p>Cerca <code>#fcrf</code> in <strong>Find</strong> per ritrovare le note.</p>
            </section>
            <h2 className="border-t border-[var(--theme-border)] pt-4 font-semibold text-[var(--theme-text)]">Keyboard shortcuts</h2>
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Input Modes:
              </div>
              <div className="grid gap-1">
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">K</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Ask the AI</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">F</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Find</span>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Others:
              </div>
              <div className="grid gap-1">
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">Shift</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">E</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>New Today entry</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">Shift</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">Y</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Scroll to Today/Top</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">Shift</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">S</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Show/hide sidebar</span>
                </div>
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">S</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Sync push</span>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Editing:
              </div>
              <div className="grid gap-1">
                <div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 font-semibold">
                  <span className="flex items-center gap-1">
                    <kbd className="kbd">{primaryModifierLabel}</kbd>
                    <span className="text-slate-400">+</span>
                    <kbd className="kbd">Enter</kbd>
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span>Toggle/Create todo</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
