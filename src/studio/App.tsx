// Replay mode (R61): the Replay button (Steps island) enters it; the replay bar
// (lazy, R58) takes the fold bar's place and the Player owns the Stage; the
// editing islands go inert (the store ignores edits anyway); Exit / Esc leaves
// and syncStage redraws the current history frame.
// The studio shell: a full-bleed ivory canvas hosting the Stage, with the
// floating islands around it (top bar, tools, fold bar, paper panel) and the
// hint line. The Stage follows the store (model, preview, paper). Islands fade
// to 40% while a fold gesture is active (App.css, [data-folding]).
import './App.css'
import { Suspense, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { current, poses } from '@engine'
import type { Stage } from '../render/Stage'
import { setPaperDefaultsSource, useStudio, type StudioState } from './store'
import { useInput } from '../input/useInput'
import { useSettings } from '../settings/store'
import { isReducedMotion, prefersReducedMotion, setReducedMotionSource, tween } from './motion'
import { TopBar } from './islands/TopBar'
import { Tools } from './islands/Tools'
import { FoldBar } from './islands/FoldBar'
import { HintLine } from './islands/HintLine'
import { Steps } from './islands/Steps'
import { PaperPanel } from './islands/PaperPanel'
import { Notice } from './islands/Notice'
import { bootStudio, recordingGate } from './boot'
import { exportPng } from '../persistence/png'
import { EXPORT_FAILED, notify } from '../persistence/notice'
import { measureInsets, NARROW_PX } from './insets'
import { LiveLog } from './LiveLog'
import { SheetHost } from './SheetHost'
import { CoachMark } from './CoachMark'
import { ShareDialog } from './ShareDialog'
import { OpenPrompt } from './islands/OpenPrompt'
import { STAGE_MESSAGES, stageDown, useUi } from './ui'
import { expectedStep, lessonTarget } from '../lessons/lessonSlice'
import './islands/islands.css'

// The store and the Stage read reduced motion lazily, from the live setting.
setReducedMotionSource(() => prefersReducedMotion(useSettings.getState().reducedMotion))
setPaperDefaultsSource(() => useSettings.getState().paperDefaults)

/**
 * Push the store's model, preview and paper into the Stage (only what changed).
 * R61: while replaying, the replay Player draws the model (only the paper look
 * still follows the store); leaving replay redraws the current history frame
 * exactly, as on a fresh sync.
 */
export function syncStage(stage: Stage, s: StudioState, prev?: StudioState): void {
  if (s.replaying) {
    if (!prev || s.paper !== prev.paper) stage.setPaper(s.paper)
    return
  }
  if (prev?.replaying) {
    stage.setPaper(s.paper)
    const frame = current(s.history)
    stage.setFrame(frame, poses(frame))
    stage.setPreview(s.preview ?? s.settling, {})
    return
  }
  if (!prev || s.paper !== prev.paper) stage.setPaper(s.paper)
  if (!prev || s.history !== prev.history) {
    const frame = current(s.history)
    stage.setFrame(frame, poses(frame))
  }
  const shown = s.preview ?? s.settling
  const was = prev && (prev.preview ?? prev.settling)
  if (!prev || shown !== was) {
    const g = s.gesture ?? (s.settling ? s.settleStyle : null)
    if (!shown && was && prev) {
      // R55: the preview goes away because the fold landed (the commit pushed a
      // step, or the settle tween ended): the Stage lets the flap ease down.
      // A refusal or a cancel leaves the history alone: no landing.
      // Show me's demo (settleStyle.demo) just goes away: nothing landed.
      const landed = s.history !== prev.history || (prev.settling !== null && prev.preview === null && !prev.settleStyle?.demo)
      const st = prev.gesture ?? prev.settleStyle
      stage.setPreview(null, landed && st ? { kind: st.kind, tool: st.tool, progress: st.progress, land: true } : {})
    } else stage.setPreview(shown, g ? { kind: g.kind, tool: g.tool, progress: g.progress } : {})
  }
}

let shownTarget: { preview: unknown; pulse: boolean } | null = null

/**
 * Lesson mode (spec 06): the current step's target ghost on the Stage, and
 * the step's camera framing when the step changes.
 */
export function syncLesson(stage: Stage, s: StudioState, prev?: StudioState, animate = false): void {
  const t = s.replaying ? null : lessonTarget(s)
  if (!t) {
    if (shownTarget) stage.setTarget(null)
    shownTarget = null
  } else if (!shownTarget || shownTarget.preview !== t.preview || shownTarget.pulse !== t.pulse) {
    shownTarget = { preview: t.preview, pulse: t.pulse }
    stage.setTarget({ preview: t.preview, kind: t.demo.kind, tool: t.demo.tool, points: [t.demo.grab, t.demo.target], pulse: t.pulse })
  }
  const step = expectedStep(s)
  const moved = !prev || s.lesson?.index !== prev.lesson?.index || s.lesson?.id !== prev.lesson?.id
  if (step?.camera && moved) stage.view(step.camera, animate)
}

const ReplayBar = lazy(() => import('./replay/ReplayBar'))
const LessonOutline = lazy(() => import('../lessons/LessonOutline'))
const RecordDialog = lazy(() => import('./RecordDialog'))

/** Enter replay: stops preset playback first (the Steps island), refused while a commit is pending. */
const enterReplay = (): boolean => useStudio.getState().setReplaying(true)
const exitReplay = (): void => {
  useStudio.getState().setReplaying(false)
}

const subscribeResize = (cb: () => void) => {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}
const isNarrow = () => window.innerWidth < NARROW_PX

export function App() {
  const narrow = useSyncExternalStore(subscribeResize, isNarrow, () => false)
  const folding = useStudio(s => s.gesture !== null)
  const replaying = useStudio(s => s.replaying)
  const inLesson = useStudio(s => s.lesson !== null)
  // Leaving replay: focus goes back to the Replay button (once the dock is no longer inert).
  const wasReplaying = useRef(false)
  useEffect(() => {
    if (wasReplaying.current && !replaying) document.querySelector<HTMLButtonElement>('.replay-btn')?.focus()
    wasReplaying.current = replaying
  }, [replaying])
  const [paperOpen, setPaperOpen] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [recordOpen, setRecordOpen] = useState(false)
  /** A recording owns the Stage: the replay bar (and its Player) step aside meanwhile. */
  const [recording, setRecording] = useState(false)
  const setBusy = useCallback((busy: boolean) => {
    recordingGate.setState({ busy })
    setRecording(busy)
  }, [])
  const [stageReady, setStageReady] = useState<Stage | null>(null)
  // A recording leaves the Stage showing its last captured frame. When it ends, redraw the model
  // from the store (a no-op visually when nothing changed) unless replay is drawing it.
  useEffect(() => {
    if (!recording && stageReady && !useStudio.getState().replaying) syncStage(stageReady, useStudio.getState())
  }, [recording, stageReady])
  useInput(stageReady)
  // Restore the autosave first; only an unrestored studio opens on the user's
  // paper defaults (settings, section 5). Then autosave starts (see boot.ts).
  useEffect(() => {
    void bootStudio(useStudio)
  }, [])
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // Three.js is loaded lazily so it stays out of the main chunk; a missing
    // WebGL context (e.g. jsdom) must not take the shell down.
    let stage: Stage | undefined
    let unsubscribe: (() => void) | undefined
    let cancelled = false
    const ui = useUi.getState()
    ui.setStage('loading')
    void import('../render/Stage')
      .then(m => {
        if (cancelled) return
        let st: Stage
        try {
          st = new m.Stage(host, {
            tween,
            reducedMotion: isReducedMotion,
            onContextLost: () => useUi.getState().setStage('lost'),
            onContextRestored: () => useUi.getState().setStage('ready'),
          })
        } catch (err) {
          // No WebGL (blocked, unsupported, or the GPU process is gone).
          console.warn('Stage unavailable:', err)
          ui.setStage('webgl')
          return
        }
        stage = st
        ui.setStage('ready')
        setStageReady(st)
        syncStage(st, useStudio.getState())
        syncLesson(st, useStudio.getState())
        unsubscribe = useStudio.subscribe((s, prev) => {
          syncStage(st, s, prev)
          syncLesson(st, s, prev, !prefersReducedMotion(useSettings.getState().reducedMotion))
        })
        // Dev / e2e-only hook for manual and browser checks. VITE_ORI_E2E is set only by
        // `npm run build:e2e`; in a production build both conditions are constant false and
        // the hook is dropped from the bundle (scripts/bundle-size.mjs asserts it).
        if (import.meta.env.DEV || import.meta.env.VITE_ORI_E2E === '1') {
          Object.assign(window, { __ori: { store: useStudio, stage: st, ui: useUi, settings: useSettings } })
        }
      })
      .catch(err => {
        // The 3D chunk failed to load (offline, or a deploy replaced the file).
        console.warn('Stage unavailable:', err)
        if (!cancelled) ui.setStage('chunk')
      })
    return () => {
      cancelled = true
      unsubscribe?.()
      stage?.dispose()
    }
  }, [])
  // Keep the camera framing centred on the area the islands leave free.
  const dockRef = useRef<HTMLDivElement>(null)
  const kfActive = useUi(s => s.kf) !== 'idle'
  const stageStatus = useUi(s => s.stage)
  const stageMessage = STAGE_MESSAGES[stageStatus]
  const reducedMotion = useSettings(s => prefersReducedMotion(s.reducedMotion))
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
  }, [layout, sheetOpen, inLesson])
  return (
    // Landmarks: the top bar is the page's banner, so it sits beside <main>, not
    // inside it (a banner nested in main is not a top-level landmark). <main> uses
    // display: contents, so the islands still position against .studio.
    <div className="studio" data-folding={folding ? '' : undefined} data-replaying={replaying ? '' : undefined}>
      <TopBar paperOpen={paperOpen && (sheetOpen || !narrow)} onTogglePaper={() => {
          // A collapsed sheet hides the panel: the button opens both rather than toggling blind.
          if (!sheetOpen && narrow) {
            setSheetOpen(true)
            setPaperOpen(true)
          } else setPaperOpen(o => !o)
        }}
        onExport={stageReady ? t => void exportPng(stageReady, useStudio.getState().history.cursor, t) : undefined}
        onExportFile={(kind, o) => {
          const { history } = useStudio.getState()
          void import('../persistence/fileExport').then(m =>
            kind === 'fold' ? m.exportFold(history) : m.exportSvg(history, { style: o.style, grid: o.grid ? 8 : undefined }),
          ).catch(() => notify(EXPORT_FAILED))
        }}
        onShare={() => setShareOpen(true)}
        onRecord={stageReady ? () => setRecordOpen(true) : undefined}
        onSettings={() => useUi.getState().open('settings')} />
      <main className="studio-main">
        <div className="stage-host" data-stage-host ref={hostRef} />
        {stageMessage && (
          <div className="stage-error island" role="alert">
            <p>{stageMessage}</p>
            {stageStatus === 'chunk' && (
              <button type="button" className="tbtn text primary" onClick={() => location.reload()}>Reload</button>
            )}
          </div>
        )}
        <div className="lower">
          <div className="bottom">
            {replaying && stageReady ? (
              <Suspense fallback={null}>
                {!recording && <ReplayBar stage={stageReady} onExit={exitReplay} />}
              </Suspense>
            ) : (
              <>
                <FoldBar />
                <HintLine />
              </>
            )}
          </div>
          {/* Wide: the islands float where they are. Narrow (< 720 px): this is the bottom sheet. */}
          <div className="dock" ref={dockRef} data-open={sheetOpen ? '' : undefined} inert={replaying}>
            <button type="button" className="dock-handle" aria-expanded={sheetOpen} aria-controls="dock-body" onClick={() => setSheetOpen(o => !o)}>
              <span className="grabber" aria-hidden="true" />
              Steps, presets and paper
            </button>
            <Tools onView={stageReady ? v => stageReady.view(v, !prefersReducedMotion(useSettings.getState().reducedMotion)) : undefined} />
            <div className="dock-body" id="dock-body">
              {inLesson ? (
                <Suspense fallback={null}>
                  <LessonOutline />
                </Suspense>
              ) : (
                <Steps onReplay={stageReady ? enterReplay : undefined} />
              )}
              {paperOpen && <PaperPanel onClose={() => setPaperOpen(false)} />}
            </div>
          </div>
        </div>
        <CoachMark stage={stageReady && !stageDown(stageStatus) ? stageReady : null} reduced={reducedMotion} />
        <Notice />
        {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
        {recordOpen && stageReady && (
          <Suspense fallback={null}>
            <RecordDialog stage={stageReady} onClose={() => setRecordOpen(false)} onBusy={setBusy} />
          </Suspense>
        )}
        <LiveLog />
        <SheetHost />
        {/* Last, so it is top-most. A share link waits for a recording to end (recordingGate), so it never sits under the record scrim. */}
        <OpenPrompt />
      </main>
    </div>
  )
}
