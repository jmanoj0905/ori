// The studio shell: a full-bleed ivory canvas hosting the Stage, with the
// wordmark island and the hint line. The Stage follows the store (model,
// preview, paper); later tasks add the islands.
import './App.css'
import { useEffect, useRef } from 'react'
import { current, poses } from '@engine'
import type { Stage } from '../render/Stage'
import { useStudio, type StudioState } from './store'

/** Push the store's model, preview and paper into the Stage (only what changed). */
function syncStage(stage: Stage, s: StudioState, prev?: StudioState): void {
  if (!prev || s.paper !== prev.paper) stage.setPaper(s.paper)
  if (!prev || s.history !== prev.history) {
    const frame = current(s.history)
    stage.setFrame(frame, poses(frame))
  }
  if (!prev || s.preview !== prev.preview) {
    const g = s.gesture
    stage.setPreview(s.preview, g ? { kind: g.kind, tool: g.tool, progress: g.progress } : {})
  }
}

export function App() {
  const hint = useStudio(s => s.hint)
  const refusal = useStudio(s => s.refusal)
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // Three.js is loaded lazily so it stays out of the main chunk; a missing
    // WebGL context (e.g. jsdom) must not take the shell down.
    let stage: Stage | undefined
    let unsubscribe: (() => void) | undefined
    let cancelled = false
    void import('../render/Stage')
      .then(m => {
        if (cancelled) return
        const st = new m.Stage(host)
        stage = st
        syncStage(st, useStudio.getState())
        unsubscribe = useStudio.subscribe((s, prev) => syncStage(st, s, prev))
        // Dev-only hook for manual and browser checks (stripped from production builds).
        if (import.meta.env.DEV) Object.assign(window, { __ori: { store: useStudio, stage: st } })
      })
      .catch(err => console.warn('Stage unavailable:', err))
    return () => {
      cancelled = true
      unsubscribe?.()
      stage?.dispose()
    }
  }, [])
  return (
    <main className="studio">
      <div className="stage-host" data-stage-host ref={hostRef} />
      <header className="island topbar">
        <h1 className="wordmark">ori · 折り</h1>
      </header>
      <p className="hint" role="status" aria-live="polite" data-refusal={refusal ? '' : undefined}>
        {refusal ?? hint}
      </p>
    </main>
  )
}
