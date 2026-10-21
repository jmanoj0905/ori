// Right island: the mini crease pattern, the numbered step list (click to jump)
// and the preset menu (Paper plane, Cup, Crane) with stoppable playback.
// Step N is frames[N]; steps past the cursor are aria-disabled (greyed) but
// still clickable (jump forward = redo).
import { useCallback, useEffect, useRef, useState } from 'react'
import { current } from '@engine'
import type { History } from '@engine'
import { useStudio } from '../store'
import { useSettings } from '../../settings/store'
import { ConfirmDialog } from './ConfirmDialog'
import { MiniCP } from './MiniCP'

export const PRESET_MENU = [
  { id: 'plane', name: 'Paper plane' },
  { id: 'cup', name: 'Cup' },
  { id: 'crane', name: 'Crane' },
] as const
type PresetId = (typeof PRESET_MENU)[number]['id']

export const CONFIRM_PRESET = 'Playing a preset starts a new sheet and replaces your folds.'
export const REDO_CLEARED = 'Redo history cleared'

export function Steps() {
  const history = useStudio(s => s.history)
  const jumpTo = useStudio(s => s.jumpTo)
  const [playing, setPlaying] = useState<PresetId | null>(null)
  const [ask, setAsk] = useState<PresetId | null>(null)
  const [toast, setToast] = useState<History | null>(null)
  const ctl = useRef<AbortController | null>(null)
  const currentRef = useRef<HTMLButtonElement>(null)

  useEffect(() => () => ctl.current?.abort(), [])
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [history.cursor])

  // A fold made after jumping back truncates the redo steps: offer to undo that.
  useEffect(
    () =>
      useStudio.subscribe((s, prev) => {
        const a = s.history
        const b = prev.history
        if (a === b) return
        const truncated =
          a.cursor === b.cursor + 1 && a.frames.length === a.cursor + 1 && b.frames.length > b.cursor + 1 &&
          a.steps[a.cursor - 1] !== b.steps[b.cursor] // a redo / jump reuses the same step
        setToast(truncated && !ctl.current ? b : null)
      }),
    [],
  )
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(t)
  }, [toast])

  const stop = useCallback(() => {
    ctl.current?.abort()
    ctl.current = null
    setPlaying(null)
  }, [])

  const start = useCallback(async (id: PresetId) => {
    ctl.current?.abort() // a new preset aborts the running one
    const c = (ctl.current = new AbortController())
    setPlaying(id)
    setToast(null)
    try {
      const { playPreset } = await import('../presetPlayer')
      await playPreset(id, { signal: c.signal })
    } finally {
      if (ctl.current === c) {
        ctl.current = null
        setPlaying(null)
      }
    }
  }, [])

  const choose = (id: PresetId) => {
    // Mid-gesture: cancel it first, then (maybe) ask.
    useStudio.getState().cancel()
    const { history: h } = useStudio.getState()
    if (h.steps.length > 0 && useSettings.getState().confirmPresetReplace) setAsk(id)
    else void start(id)
  }

  const { steps, cursor } = history
  return (
    <section className="island steps" aria-label="Steps">
      <MiniCP frame={current(history)} />
      <ol className="step-list" aria-label="Fold steps">
        <li>
          <button
            type="button"
            className="step-item"
            aria-current={cursor === 0 ? 'step' : undefined}
            ref={cursor === 0 ? currentRef : undefined}
            onClick={() => jumpTo(0)}
          >
            <span className="mono">0</span> · Blank sheet
          </button>
        </li>
        {steps.map((s, i) => {
          const n = i + 1
          const future = n > cursor
          return (
            <li key={i}>
              <button
                type="button"
                className="step-item"
                aria-disabled={future || undefined}
                aria-current={n === cursor ? 'step' : undefined}
                ref={n === cursor ? currentRef : undefined}
                onClick={() => jumpTo(n)}
              >
                {n} · {s.label}
              </button>
            </li>
          )
        })}
      </ol>
      <div role="group" aria-label="Presets" className="presets">
        {PRESET_MENU.map(p => (
          <button key={p.id} type="button" className="preset-btn" aria-pressed={playing === p.id} onClick={() => choose(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      {playing && (
        <button type="button" className="tbtn text stop" onClick={stop}>Stop</button>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{REDO_CLEARED}</span>
          <button
            type="button"
            className="tbtn text"
            onClick={() => {
              useStudio.getState().restoreHistory(toast)
              setToast(null)
            }}
          >
            Undo
          </button>
        </div>
      )}
      {ask !== null && (
        <ConfirmDialog
          title="Replace your work?"
          message={CONFIRM_PRESET}
          confirmLabel="Play preset"
          onCancel={() => setAsk(null)}
          onConfirm={() => {
            const id = ask
            setAsk(null)
            void start(id)
          }}
        />
      )}
    </section>
  )
}
