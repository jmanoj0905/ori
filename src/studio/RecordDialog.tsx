// The Record dialog (spec 05 "Replay and recording"; Plan 3 Task 5): records
// the history replay (up to the cursor) as a GIF or WebM with size and
// frame-rate presets, a progress bar and Cancel. Lazy-loaded from the Export
// menu with the recorder (R58); gifenc loads only inside the GIF worker.
//
// Recording is replay mode (R61): it enters replay for its duration (editing
// suspended; the replay bar, if open, steps aside so only the recorder draws)
// and leaves it afterwards exactly as it found it — if the studio was not
// replaying, syncStage redraws the current history frame; the Stage restores
// its own camera and canvas (endCapture). Frames come from Player.viewAt, so
// a recording looks exactly like the replay, in the user's paper and washi.
//
// WebM is offered only where MediaRecorder records WebM (Review Focus 4).
// GIFs have a size budget (record.ts gifEstimate): the estimate is shown, and
// an over-budget size / frame rate disables Record with a short explanation.
// A WebM needs the tab visible (hidden tabs throttle timers): hiding it stops
// the recording with RECORD_HIDDEN.
// Cancel (or Esc, or closing) aborts: the GIF worker is terminated and nothing
// is downloaded (Review Focus 5). A failure shows RECORD_FAILED, no download.
//
// A11y: a labelled modal (useModal: focus in, Tab trapped, Esc, focus back);
// options are radio groups in fieldsets; while recording, a progressbar with
// aria-valuenow (0–100) and a polite status line.
import { useEffect, useId, useRef, useState } from 'react'
import { download, exportName } from '../persistence/png'
import { RECORD_FAILED, RECORD_HIDDEN, notify } from '../persistence/notice'
import {
  FPS,
  GIF_MAX_FRAMES,
  RecordHiddenError,
  SIZES,
  gifEstimate,
  record,
  webmSupported,
  type RecordFormat,
  type RecordFps,
  type RecordSize,
  type RecordStage,
} from '../persistence/record'
import { Player, STEP_MS, type ReplayView } from './replay/Player'
import { drawView, type ReplayStage } from './replay/draw'
import { useStudio } from './store'
import { useModal } from './useModal'

/** The Stage as the recorder needs it (render/Stage implements it). */
export type RecordableStage = ReplayStage & {
  readonly aspect: number
  beginCapture(width: number, height: number): void
  captureFrame(): CanvasImageSource
  endCapture(): void
}

export type RecordDialogProps = {
  stage: RecordableStage
  onClose(): void
  /** True while a recording runs (App hides the replay bar so only the recorder draws). */
  onBusy?(busy: boolean): void
}

export const BUSY_MESSAGE = 'Finish the current fold first, then record.'

/** Adapt the Stage + the shared replay drawer to the recorder's interface (deterministic: no easing). */
function recordTarget(stage: RecordableStage): RecordStage<ReplayView> {
  const draw = drawView(stage, () => false)
  return {
    get aspect() {
      return stage.aspect
    },
    beginCapture: (w, h) => stage.beginCapture(w, h),
    draw,
    captureFrame: () => stage.captureFrame(),
    endCapture: () => stage.endCapture(),
  }
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'

const mb = (bytes: number): string => {
  const m = bytes / (1024 * 1024)
  return m >= 10 ? `${Math.round(m)} MB` : `${m.toFixed(1)} MB`
}

export function RecordDialog({ stage, onClose, onBusy }: RecordDialogProps) {
  const id = useId()
  const webm = useRef(webmSupported()).current
  const [format, setFormat] = useState<RecordFormat>('gif')
  const [size, setSize] = useState<RecordSize>(480)
  const [fps, setFps] = useState<RecordFps>(15)
  const [autoFrame, setAutoFrame] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [refused, setRefused] = useState(false)
  const ctl = useRef<AbortController | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const busyRef = useRef(onBusy)
  busyRef.current = onBusy

  const cancel = () => ctl.current?.abort()
  const close = () => (ctl.current ? cancel() : onClose())
  const { ref, onKeyDown } = useModal(close)

  // Closing mid-recording (unmount) cancels it.
  useEffect(() => () => ctl.current?.abort(), [])

  const start = async () => {
    if (ctl.current) return
    const studio = useStudio.getState()
    const wasReplaying = studio.replaying
    if (!wasReplaying && !studio.setReplaying(true)) {
      setRefused(true)
      return
    }
    setRefused(false)
    const abort = (ctl.current = new AbortController())
    busyRef.current?.(true)
    setProgress(0)
    const player = new Player(useStudio.getState().history, { reduced: () => false })
    player.autoFrame = autoFrame
    const opts = { format, size, fps }
    try {
      const blob = await record(player, recordTarget(stage), opts, abort.signal, p => setProgress(p))
      if (!abort.signal.aborted) download(blob, exportName(new Date(), player.steps, format))
    } catch (e) {
      if (e instanceof RecordHiddenError) notify(RECORD_HIDDEN)
      else if (!isAbort(e) && !abort.signal.aborted) notify(RECORD_FAILED)
    } finally {
      player.dispose()
      ctl.current = null
      if (!wasReplaying) useStudio.getState().setReplaying(false)
      busyRef.current?.(false)
      closeRef.current()
    }
  }

  const recording = progress !== null
  const cancelRef = useRef<HTMLButtonElement>(null)
  // The Record button goes away as recording starts: focus moves to Cancel.
  useEffect(() => {
    if (recording) cancelRef.current?.focus()
  }, [recording])
  const pct = Math.round((progress ?? 0) * 100)
  const steps = useStudio(s => s.history.cursor)
  const est = gifEstimate({ steps, duration: steps * STEP_MS }, { size, fps }, stage.aspect)
  const overBudget = format === 'gif' && !est.ok
  const alternatives = [
    est.reason === 'bytes' && size > 480 ? 'a smaller size' : null,
    fps > 15 ? '15 fps' : null,
    webm ? 'WebM video' : null,
  ].filter(Boolean).join(', or ')
  const budgetNote = est.reason === 'frames'
    ? `Too long for a GIF (${est.frames} frames; the limit is ${GIF_MAX_FRAMES}).`
    : `Too large for a GIF (about ${mb(est.bytes)}).`

  return (
    <div className="scrim" onKeyDown={onKeyDown}>
      <div ref={ref} className="island dialog record" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`}>Record the replay</h2>
        {recording ? (
          <>
            <p role="status" aria-live="polite">
              {format === 'webm' ? 'Recording the video in real time…' : 'Recording and encoding the GIF…'}
            </p>
            <div
              className="record-progress"
              role="progressbar"
              aria-label="Recording progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-valuetext={`${pct}%`}
            >
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="dialog-actions">
              <button ref={cancelRef} type="button" className="tbtn text" onClick={cancel}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <p>
              {steps} step{steps === 1 ? '' : 's'}, from the blank sheet, in your paper and canvas. Nothing is uploaded.
            </p>
            <fieldset className="record-opts">
              <legend>Format</legend>
              <label><input type="radio" name={`${id}-f`} checked={format === 'gif'} onChange={() => setFormat('gif')} /> GIF</label>
              {webm && (
                <label><input type="radio" name={`${id}-f`} checked={format === 'webm'} onChange={() => setFormat('webm')} /> WebM video</label>
              )}
            </fieldset>
            <fieldset className="record-opts">
              <legend>Size</legend>
              {SIZES.map(s => (
                <label key={s}><input type="radio" name={`${id}-s`} checked={size === s} onChange={() => setSize(s)} aria-label={`${s}p`} /> {s}p</label>
              ))}
            </fieldset>
            <fieldset className="record-opts">
              <legend>Frame rate</legend>
              {FPS.map(f => (
                <label key={f}><input type="radio" name={`${id}-r`} checked={fps === f} onChange={() => setFps(f)} aria-label={`${f} fps`} /> {f} fps</label>
              ))}
            </fieldset>
            <label className="record-opts autoframe">
              <input type="checkbox" checked={autoFrame} onChange={e => setAutoFrame(e.target.checked)} /> Auto-frame camera
            </label>
            <p className="record-note mono">
              {est.width} × {est.height}
              {format === 'gif' && ` · ${est.frames} frames · about ${mb(est.bytes)}`}
            </p>
            {overBudget && (
              <p className="record-warn" role="status">
                {budgetNote}{alternatives ? ` Choose ${alternatives}.` : ''}
              </p>
            )}
            {refused && <p role="alert">{BUSY_MESSAGE}</p>}
            <div className="dialog-actions">
              <button type="button" className="tbtn text" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="tbtn text primary"
                data-autofocus={overBudget ? undefined : ''}
                disabled={overBudget}
                onClick={() => void start()}
              >
                Record
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default RecordDialog
