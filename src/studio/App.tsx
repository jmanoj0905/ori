// The studio shell: a full-bleed ivory canvas hosting the Stage, with the
// floating islands around it (top bar, tools, fold bar, paper panel) and the
// hint line. The Stage follows the store (model, preview, paper). Islands fade
// to 40% while a fold gesture is active (App.css, [data-folding]).
import './App.css'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { current, poses } from '@engine'
import type { Stage } from '../render/Stage'
import { setPaperDefaultsSource, useStudio, type StudioState } from './store'
import { useInput } from '../input/useInput'
import { useSettings } from '../settings/store'
import { prefersReducedMotion, setReducedMotionSource } from './motion'
import { TopBar } from './islands/TopBar'
import { Tools } from './islands/Tools'
import { FoldBar } from './islands/FoldBar'
import { HintLine } from './islands/HintLine'
import { Steps } from './islands/Steps'
import { PaperPanel } from './islands/PaperPanel'
import { Notice } from './islands/Notice'
import { bootStudio } from './boot'
import { exportPng } from '../persistence/png'
import { measureInsets, NARROW_PX } from './insets'
import { LiveLog } from './LiveLog'
import { SheetHost } from './SheetHost'
import { useUi } from './ui'
import './islands/islands.css'

// The store reads reduced motion lazily (settings import the store, not vice versa).
setReducedMotionSource(() => prefersReducedMotion(useSettings.getState().reducedMotion))
setPaperDefaultsSource(() => useSettings.getState().paperDefaults)

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

const subscribeResize = (cb: () => void) => {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}
const isNarrow = () => window.innerWidth < NARROW_PX

export function App() {
  const narrow = useSyncExternalStore(subscribeResize, isNarrow, () => false)
  const folding = useStudio(s => s.gesture !== null)
  const [paperOpen, setPaperOpen] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [stageReady, setStageReady] = useState<Stage | null>(null)
  useInput(stageReady)
  // Restore the autosave first; only an unrestored studio opens on the user's
  // paper defaults (settings, section 5). Then autosave starts (see boot.ts).
  useEffect(() => bootStudio(useStudio), [])
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
  // Keep the camera framing centred on the area the islands leave free.
  const dockRef = useRef<HTMLDivElement>(null)
  const kfActive = useUi(s => s.kf) !== 'idle'
  const busy = folding || kfActive
  const layout = useCallback(() => {
    if (!stageReady || busy) return // never rescale the paper under a live fold; it reframes when the gesture ends
    const q = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null
    stageReady.setInsets(
      measureInsets({ width: window.innerWidth, height: window.innerHeight }, { tools: q('.tools'), steps: q('.steps'), dock: dockRef.current?.getBoundingClientRect() }),
    )
  }, [stageReady, busy])
  useEffect(() => {
    layout()
    window.addEventListener('resize', layout)
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null
    for (const sel of ['.tools', '.steps']) {
      const el = document.querySelector(sel)
      if (el) ro?.observe(el)
    }
    if (dockRef.current) ro?.observe(dockRef.current)
    return () => {
      window.removeEventListener('resize', layout)
      ro?.disconnect()
    }
  }, [layout, sheetOpen])
  return (
    <main className="studio" data-folding={folding ? '' : undefined}>
      <div className="stage-host" data-stage-host ref={hostRef} />
      <TopBar paperOpen={paperOpen && (sheetOpen || !narrow)} onTogglePaper={() => {
          // A collapsed sheet hides the panel: the button opens both rather than toggling blind.
          if (!sheetOpen && narrow) {
            setSheetOpen(true)
            setPaperOpen(true)
          } else setPaperOpen(o => !o)
        }}
        onExport={stageReady ? t => void exportPng(stageReady, useStudio.getState().history.cursor, t) : undefined}
        onSettings={() => useUi.getState().open('settings')} />
      <div className="lower">
        <div className="bottom">
          <FoldBar />
          <HintLine />
        </div>
        {/* Wide: the islands float where they are. Narrow (< 720 px): this is the bottom sheet. */}
        <div className="dock" ref={dockRef} data-open={sheetOpen ? '' : undefined}>
          <button type="button" className="dock-handle" aria-expanded={sheetOpen} aria-controls="dock-body" onClick={() => setSheetOpen(o => !o)}>
            <span className="grabber" aria-hidden="true" />
            Steps, presets and paper
          </button>
          <Tools />
          <div className="dock-body" id="dock-body">
            <Steps />
            {paperOpen && <PaperPanel onClose={() => setPaperOpen(false)} />}
          </div>
        </div>
      </div>
      <Notice />
      <LiveLog />
      <SheetHost />
    </main>
  )
}
