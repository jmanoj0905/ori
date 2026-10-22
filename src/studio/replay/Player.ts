// The replay Player (spec 05 "Replay and recording"; R61, R62). Plays a
// history from the blank sheet to the cursor, one step per STEP_MS at speed 1.
//
// Time is a step float t in [0, steps]: n = floor(t) steps are complete
// (frames[n] is the base), f = t - n is the progress through step n + 1.
//   - a fold step swings: preview(frames[n], {recorded gesture, angleDeg:
//     f × committed angle}) — the moving flap at that angle, drawn as solid
//     paper on top of frames[n] (the Stage's solid preview style);
//   - a compound step (reverse / squash / petal) or a turn over shows
//     frames[n] for f < 0.5 and frames[n + 1] for f ≥ 0.5 (R62; compound
//     previews are end-state poses anyway, R15).
// Preview.frame is only ever drawn, never fed back into the engine, and the
// history is never modified.
//
// Determinism (Task 5's recorder): `viewAt(t)` is a pure function of t, so a
// recorder can render exact times (t = i × fps step) without the wall clock;
// play() is only a wall-clock driver around seek(), and its clock is
// injectable (tests use a manual one). Reduced motion: play advances whole
// steps, one per beat (STEP_MS / speed), with no in-between frames; seek
// lands on whole steps too.
import { poses as posesOf, preview } from '@engine'
import type { FacePose, FoldKind, Frame, History, Preview, Tool } from '@engine'
import { replayStepOf } from '../../persistence/replay'
import { isReducedMotion } from '../motion'

/** One replay step at speed 1. Long enough to read each fold, short enough for a 22-step crane (~18 s). */
export const STEP_MS = 800

export type Speed = 0.5 | 1 | 2
export const SPEEDS: readonly Speed[] = [0.5, 1, 2]

/** What to draw at one replay time. */
export type ReplayView = {
  t: number
  /** Total steps replayed (the history's cursor). */
  steps: number
  playing: boolean
  autoFrame: boolean
  /** The step being shown: the step in progress (n + 1) when f > 0, else n. */
  step: number
  /** f, progress through the step in progress (0 at whole steps). */
  progress: number
  /** The committed frame to draw (frames[n], or frames[n + 1] past half of a compound step). */
  frame: Frame
  /** poses(frame), cached per frame so an unchanged frame is the same object. */
  poses: FacePose[]
  /** The fold in progress, drawn as solid paper in place of `frame` (null at whole steps). */
  swing: Preview | null
  /** How to draw the swing. */
  style: { kind: FoldKind; tool: Tool }
}

/** The wall clock play() runs on. Defaults to performance.now + requestAnimationFrame. */
export type Clock = {
  now(): number
  request(cb: (now: number) => void): number
  cancel(id: number): void
}

export type PlayerOptions = { clock?: Clock; reduced?: () => boolean }

const rafClock: Clock = {
  now: () => performance.now(),
  request: cb => requestAnimationFrame(cb),
  cancel: id => cancelAnimationFrame(id),
}

type Replayable = Pick<History, 'frames' | 'steps' | 'cursor'>

export class Player {
  readonly steps: number
  private readonly frames: readonly Frame[]
  private readonly history: Replayable
  private readonly clock: Clock
  private readonly reduced: () => boolean
  private readonly poseCache = new Map<Frame, FacePose[]>()
  private readonly listeners = new Set<(v: ReplayView) => void>()
  private time = 0
  private rate: Speed = 1
  private auto = false
  private raf: number | null = null
  /** play() anchor: the time and clock reading playback (re)started from. */
  private anchor = { t: 0, now: 0 }

  constructor(history: Replayable, { clock = rafClock, reduced = isReducedMotion }: PlayerOptions = {}) {
    this.history = history
    this.steps = Math.max(0, Math.min(history.cursor, history.steps.length))
    this.frames = history.frames.slice(0, this.steps + 1)
    this.clock = clock
    this.reduced = reduced
  }

  get t(): number {
    return this.time
  }

  get playing(): boolean {
    return this.raf !== null
  }

  get speed(): Speed {
    return this.rate
  }

  /** Whole-replay length in ms at the current speed. */
  get duration(): number {
    return (this.steps * STEP_MS) / this.rate
  }

  /** Camera: false keeps the user's view; true re-frames to the model bounds on each frame. */
  get autoFrame(): boolean {
    return this.auto
  }

  set autoFrame(on: boolean) {
    if (on === this.auto) return
    this.auto = on
    this.emit()
  }

  /** Subscribe to the views to draw; returns the unsubscribe. */
  onFrame(cb: (v: ReplayView) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  play(): void {
    if (this.playing) return
    if (this.time >= this.steps) this.time = 0
    this.anchorAt(this.time)
    this.raf = this.clock.request(this.tick)
    this.emit()
  }

  pause(): void {
    if (!this.playing) return
    this.clock.cancel(this.raf!)
    this.raf = null
    this.emit()
  }

  /** Show time t (clamped to [0, steps]; whole steps under reduced motion). Playback continues from there. */
  seek(t: number): void {
    if (!Number.isFinite(t)) return
    this.time = this.clamp(t)
    if (this.playing) this.anchorAt(this.time)
    this.emit()
  }

  setSpeed(s: Speed): void {
    if (!SPEEDS.includes(s) || s === this.rate) return
    this.rate = s
    if (this.playing) this.anchorAt(this.time)
    this.emit()
  }

  dispose(): void {
    if (this.raf !== null) this.clock.cancel(this.raf)
    this.raf = null
    this.listeners.clear()
  }

  /** The view at time t: pure (no emit, no state change), for drawing exact times. */
  viewAt(t: number): ReplayView {
    const time = this.clamp(Number.isFinite(t) ? t : 0)
    const n = Math.floor(time)
    const f = time - n
    const base = { t: time, steps: this.steps, playing: this.playing, autoFrame: this.auto }
    const whole = (i: number, step = i) => ({
      ...base, step, progress: f, frame: this.frames[i]!, poses: this.posesOf(this.frames[i]!), swing: null,
      style: { kind: 'valley' as FoldKind, tool: 'fold' as Tool },
    })
    if (f === 0 || n >= this.steps) return whole(n)
    const r = replayStepOf(this.history.steps[n])
    const g = r && 'gesture' in r ? r.gesture : null
    if (g && g.tool === 'fold' && typeof g.angleDeg === 'number') {
      const p = preview(this.frames[n]!, { ...g, angleDeg: f * g.angleDeg })
      if (p.ok) {
        return {
          ...base, step: n + 1, progress: f, frame: this.frames[n]!, poses: this.posesOf(this.frames[n]!),
          swing: p.preview, style: { kind: g.kind, tool: 'fold' },
        }
      }
    }
    // Compound tools, turn over, or a swing the engine would not preview: jump at half way.
    return whole(f < 0.5 ? n : n + 1, n + 1)
  }

  private readonly tick = (now: number): void => {
    this.raf = null
    const beats = ((now - this.anchor.now) * this.rate) / STEP_MS
    const reduced = this.reduced()
    const t = this.clamp(this.anchor.t + (reduced ? Math.floor(beats) : beats))
    const end = t >= this.steps
    if (!end) this.raf = this.clock.request(this.tick)
    // Reduced motion: emit only when a whole step changes (no in-between frames).
    const changed = t !== this.time
    this.time = t
    if (end || changed || !reduced) this.emit()
  }

  private anchorAt(t: number): void {
    this.anchor = { t, now: this.clock.now() }
  }

  private clamp(t: number): number {
    const c = Math.min(this.steps, Math.max(0, t))
    return this.reduced() ? Math.floor(c) : c
  }

  private posesOf(f: Frame): FacePose[] {
    let p = this.poseCache.get(f)
    if (!p) this.poseCache.set(f, (p = posesOf(f)))
    return p
  }

  private emit(): void {
    if (!this.listeners.size) return
    const v = this.viewAt(this.time)
    for (const cb of this.listeners) cb(v)
  }
}
