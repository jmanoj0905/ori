// The studio shell: a full-bleed ivory canvas hosting the Stage, with the
// floating islands around it (top bar, tools, fold bar, paper panel) and the
// hint line. The Stage follows the store (model, preview, paper). Islands fade
// to 40% while a fold gesture is active (App.css, [data-folding]).
import './App.css'
import { useEffect, useRef, useState } from 'react'
import { current, poses } from '@engine'
import type { Stage } from '../render/Stage'
import { useStudio, type StudioState } from './store'
import { useInput } from '../input/useInput'
import { useSettings } from '../settings/store'
import { prefersReducedMotion, setReducedMotionSource } from './motion'
import { TopBar } from './islands/TopBar'
import { Tools } from './islands/Tools'
import { FoldBar } from './islands/FoldBar'
import { HintLine } from './islands/HintLine'
import { Steps } from './islands/Steps'
import { PaperPanel } from './islands/PaperPanel'
import { LiveLog } from './LiveLog'
import { SheetHost } from './SheetHost'
import { useUi } from './ui'
import './islands/islands.css'

// The store reads reduced motion lazily (settings import the store, not vice versa).
setReducedMotionSource(() => prefersReducedMotion(useSettings.getState().reducedMotion))

/** Push the store's model, preview and paper into the Stage (only what changed). */
export function syncStage(stage: Stage, s: StudioState, prev?: StudioState): void {
  if (!prev || s.paper !== prev.paper) stage.setPaper(s.paper)
  if (!prev || s.history !== prev.history) {
    const frame = current(s.history)
    stage.setFrame(frame, poses(frame))
  }
  const shown = s.preview ?? s.settling
  const was = prev && (prev.preview ?? prev.settling)
  if (!prev || shown !== was) {
    const g = s.gesture ?? (s.settling ? s.settleStyle : null)
    stage.setPreview(shown, g ? { kind: g.kind, tool: g.tool, progress: g.progress } : {})
  }
}

export function App() {
  const folding = useStudio(s => s.gesture !== null)
  const [paperOpen, setPaperOpen] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const [stageReady, setStageReady] = useState<Stage | null>(null)
  useInput(stageReady)
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
        setStageReady(st)
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
    <main className="studio" data-folding={folding ? '' : undefined}>
      <div className="stage-host" data-stage-host ref={hostRef} />
      <TopBar paperOpen={paperOpen} onTogglePaper={() => setPaperOpen(o => !o)} onSettings={() => useUi.getState().open('settings')} />
      <Tools />
      <Steps />
      {paperOpen && <PaperPanel onClose={() => setPaperOpen(false)} />}
      <div className="bottom">
        <FoldBar />
        <HintLine />
      </div>
      <LiveLog />
      <SheetHost />
    </main>
  )
}
