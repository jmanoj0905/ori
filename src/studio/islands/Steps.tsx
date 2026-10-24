// Right island: the mini crease pattern, the numbered step list (click to jump)
// and the preset menu (Paper plane, Cup, Crane) with stoppable playback, and
// the Lessons button (the lesson menu loads on demand; spec 06). In lesson
// mode the App shows the lesson outline here instead.
// Step N is frames[N]; steps past the cursor are aria-disabled (greyed) but
// still clickable (jump forward = redo).
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { current } from '@engine'
import type { History } from '@engine'
import { useStudio } from '../store'
import { useSettings } from '../../settings/store'
import { ConfirmDialog } from './ConfirmDialog'
import { MiniCP } from './MiniCP'
import { notify } from '../../persistence/notice'
import { download } from '../../persistence/png'
import { stageDown, useUi } from '../ui'

export const PRESET_MENU = [
  { id: 'plane', name: 'Paper plane' },
  { id: 'cup', name: 'Cup' },
  { id: 'crane', name: 'Crane' },
] as const
type PresetId = (typeof PRESET_MENU)[number]['id']

export const CONFIRM_PRESET = 'Playing a preset starts a new sheet and replaces your folds.'
export const CONFIRM_LESSON = 'Starting a lesson starts a new sheet and replaces your folds.'
export const LESSON_FAILED = "Couldn't load the lessons. Check your connection and try again."

const LessonMenu = lazy(() => import('../../lessons/LessonMenu'))
export const REDO_CLEARED = 'Redo history cleared'
export const PRESET_FAILED = "Couldn't load the preset. Check your connection and try again."

/**
 * Lesson authoring (spec 06, dev builds only): download the history up to the
 * cursor as a lesson skeleton (lessons/devExport) to caption by hand.
 */
async function exportLesson(): Promise<void> {
  const { history, paper } = useStudio.getState()
  const { lessonSkeleton } = await import('../../lessons/devExport')
  const sk = lessonSkeleton(history, { id: 'new-lesson', title: 'New lesson', difficulty: 1, paper: paper.size })
  download(new Blob([JSON.stringify(sk, null, 2)], { type: 'application/json' }), 'new-lesson.json')
}

/** `onReplay` enters replay mode (App; refused while a commit is pending); absent while the Stage is not ready. */
export function Steps({ onReplay }: { onReplay?: () => boolean } = {}) {
  const history = useStudio(s => s.history)
  const jumpTo = useStudio(s => s.jumpTo)
  const down = useUi(s => stageDown(s.stage))
  const pending = useStudio(s => s.pending)
  const [playing, setPlaying] = useState<PresetId | null>(null)
  const [ask, setAsk] = useState<PresetId | null>(null)
  const [lessonsOpen, setLessonsOpen] = useState(false)
  const [askLesson, setAskLesson] = useState<string | null>(null)
  const [toast, setToast] = useState<History | null>(null)
  const ctl = useRef<AbortController | null>(null)
  /** A Replay click waiting for an in-flight commit to land (one at most; dropped on unmount). */
  const replayRetry = useRef<(() => void) | null>(null)
  const currentRef = useRef<HTMLButtonElement>(null)

  useEffect(() => () => {
    ctl.current?.abort()
    replayRetry.current?.()
    replayRetry.current = null
  }, [])
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
    } catch {
      // The player chunk failed to load (offline, a deploy replaced it): say so.
      notify(PRESET_FAILED)
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

  const startLesson = (id: string) => {
    stop()
    setLessonsOpen(false)
    void useStudio.getState().startLesson(id).catch(() => notify(LESSON_FAILED))
  }
  const chooseLesson = (id: string) => {
    useStudio.getState().cancel()
    const { history: h } = useStudio.getState()
    if (h.steps.length > 0 && useSettings.getState().confirmPresetReplace) setAskLesson(id)
    else startLesson(id)
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
                {future && <span className="sr-only"> (undone)</span>}
              </button>
            </li>
          )
        })}
      </ol>
      <div role="group" aria-label="Presets" className="presets">
        {PRESET_MENU.map(p => (
          <button key={p.id} type="button" className="preset-btn" aria-pressed={playing === p.id} disabled={down} onClick={() => choose(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      {playing && (
        <button type="button" className="tbtn text stop" onClick={stop}>Stop</button>
      )}
      <button
        type="button"
        className="tbtn text lessons-btn"
        aria-expanded={lessonsOpen}
        disabled={down}
        onClick={() => setLessonsOpen(o => !o)}
      >
        Lessons
      </button>
      {lessonsOpen && (
        <Suspense fallback={<p className="lesson-empty">Loading lessons…</p>}>
          <LessonMenu onPick={chooseLesson} />
        </Suspense>
      )}
      <button
        type="button"
        className="tbtn text replay-btn"
        disabled={!onReplay || down || cursor === 0 || (pending && !playing)}
        title={cursor === 0 ? 'Fold something to replay it' : 'Replay the folds from the blank sheet'}
        onClick={() => {
          // R61: replay stops preset playback and cancels any live fold (the store does that).
          stop()
          replayRetry.current?.()
          replayRetry.current = null
          if (!onReplay?.()) {
            // A commit was still landing (preset playback): try once more as soon as it has.
            const un = useStudio.subscribe(s => {
              if (s.pending) return
              un()
              replayRetry.current = null
              onReplay?.()
            })
            replayRetry.current = un
          }
        }}
      >
        Replay
      </button>
      {import.meta.env.DEV && (
        <button type="button" className="tbtn text" disabled={cursor === 0} onClick={() => void exportLesson().catch(() => notify('Lesson export failed.'))}>
          Export lesson
        </button>
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
      {askLesson !== null && (
        <ConfirmDialog
          title="Replace your work?"
          message={CONFIRM_LESSON}
          confirmLabel="Start lesson"
          onCancel={() => setAskLesson(null)}
          onConfirm={() => {
            const id = askLesson
            setAskLesson(null)
            startLesson(id)
          }}
        />
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
