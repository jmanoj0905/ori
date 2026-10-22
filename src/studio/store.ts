// The studio store: the single source of truth for the model (an engine
// History), the active tool and fold kind, the in-flight gesture and its
// preview, the paper settings and the hint line.
//
// Gesture lifecycle:
//   begin(grab)            → gesture { target: grab, progress: 0, layers: 1 }
//   drag(target, progress) → preview(current(history), gesture), synchronous
//   setLayers / setKind    → update the gesture, re-run the preview mid-drag
//   release()              → commit off-thread (the committer), push on success
//   cancel()               → clear gesture, preview and refusal
// The preview always runs against current(history): Preview.frame (the
// creased-but-open edited frame) is for rendering only and is never fed back.
//
// Settle (spec 03 step 4): the commit lands in `history` at once, so the final
// state is always correct. The release preview then lives on as `settling`, a
// purely visual Preview that eases from the released angle to the committed one
// (R41: a release commits at the previewed angle, so usually there is nothing
// to ease) over SETTLE_MS (re-running the synchronous preview each frame); the Stage shows it
// in place of the committed paper, then reveals the committed frame. Reduced
// motion skips it entirely. Anything that touches the model or starts a gesture
// (begin, undo / redo / jumpTo, turnOver, newSheet, tool change, re-commit)
// aborts the tween and clears `settling`, so input is never blocked or fought.
//
// Async commit (R33): release() and turnOver() return a Promise<boolean>
// (true when a step was pushed). While a commit is pending, `pending` is
// true, the preview stays on screen (until the result lands, so the Stage can
// settle into it), and begin / drag / setLayers / setKind / release /
// turnOver are ignored (not queued: a gesture started mid-commit would be
// planned against a frame that is about to change). Undo, redo, jumpTo and
// newSheet stay live; if the history changed while a commit was in flight,
// its result is dropped (it was computed from a frame that is no longer
// current) and the promise resolves false.
//
// Replay mode (R61, studio/replay): while `replaying`, the Player owns the
// Stage and every editing action (gestures, keyboard folds, tools, kind,
// presets via commitStep, undo / redo / jumps, the slider, new sheet) is
// ignored, so the history and the autosave never change. Paper settings stay
// live (they are the look, not the model). Entering it ends any gesture or
// settle; it is refused while a commit is in flight.
import { create } from 'zustand'
import {
  PAPER_SIZES,
  createPaper,
  current,
  jumpTo as jumpHistory,
  preview as previewFold,
  push,
  redo as redoHistory,
  startHistory,
  undo as undoHistory,
} from '@engine'
import type { FoldKind, Gesture, History, Line, PaperSize, Preview, Tool, Vec2 } from '@engine'
import { createWorkerCommitter, type CommitRequest, type Committer } from './committer'
import { SETTLE_MS, isReducedMotion, tween } from './motion'
import { DEFAULT_PAPER, type PaperSettings, type SheetSize } from '../paper'

export { DEFAULT_PAPER, SWATCHES } from '../paper'
export type { PaperSettings, SheetSize } from '../paper'

export const HINT_START = 'Grab a corner and drag it across.'
/** Shown when the committer itself fails (worker crash), not an engine refusal. */
export const COMMIT_FAILED = 'Something went wrong with that fold. Try again.'

/**
 * Where new sheets get their paper (the settings' paper defaults). Injected like
 * the reduced-motion source, so the store stays testable without the settings
 * store; the app wires it at start-up. Unset: the sheet keeps the current paper.
 */
let paperDefaultsSource: (() => PaperSettings) | null = null
export const setPaperDefaultsSource = (fn: (() => PaperSettings) | null): void => { paperDefaultsSource = fn }

/** The recorded parameters of the last fold step, when the cursor sits on it. */
export type LastFold = {
  tool: Tool
  grab: Vec2
  target: Vec2
  layers: number
  kind: FoldKind
  angleDeg: number
  crease: Line
  snapAngle: boolean
  face?: number
}

/**
 * R53: only the LAST fold of the history is offered for the post-release
 * slider / kind toggle (spec 03: "the last fold, until the next fold is made").
 * With the cursor before the end (after undo or a jump back) there is none, so
 * a re-commit can never truncate the redo steps.
 */
export function lastFold(h: History): LastFold | null {
  if (h.cursor !== h.steps.length) return null
  const step = h.cursor > 0 ? h.steps[h.cursor - 1] : undefined
  if (!step || step.kind !== 'fold') return null
  const p = step.params as Partial<LastFold> | null
  if (!p || !p.grab || !p.target || !p.crease || typeof p.angleDeg !== 'number') return null
  return {
    tool: p.tool ?? 'fold',
    grab: p.grab,
    target: p.target,
    layers: p.layers ?? 1,
    kind: p.kind ?? 'valley',
    angleDeg: p.angleDeg,
    crease: p.crease,
    snapAngle: p.snapAngle ?? false,
    ...(p.face === undefined ? {} : { face: p.face }),
  }
}

/** Exact numeric input (spec 03): a crease line and/or a fold angle in degrees. */
export type NumericEdit = { crease?: Line; angleDeg?: number; kind?: FoldKind }

/** `refused`: the engine (or committer) rejected the step; false when merely skipped (pending / history moved). */
export type CommitStepResult = { ok: true } | { ok: false; refused: boolean; reason: string | null }

export type StudioState = {
  history: History
  tool: Tool
  kind: FoldKind
  gesture: Gesture | null
  preview: Preview | null
  /** Visual only: the flap easing into its committed angle after a release. */
  settling: Preview | null
  /** The released gesture's draw style (kind / tool / progress), kept for the settle. */
  settleStyle: { kind: FoldKind; tool: Tool; progress: number } | null
  refusal: string | null
  paper: PaperSettings
  hint: string
  /** A commit (release or turn over) is in flight, or boot is replaying the autosave. */
  pending: boolean
  /** Boot is replaying the autosave in the Worker (pending is true meanwhile; see boot.ts). */
  restoring: boolean
  /** The replay Player owns the Stage; editing is ignored (see header). */
  replaying: boolean

  /** Enter / leave replay mode. Entering cancels any gesture; refused (false) while a commit is pending. */
  setReplaying(on: boolean): boolean

  /** Start a fold gesture; `face` is the face hit at grab (Gesture.face). */
  begin(grab: Vec2, face?: number): void
  drag(target: Vec2, progress: number): void
  setLayers(k: number): void
  setKind(k: FoldKind): void
  /** Hold-to-snap the fold angle (angleSnap modifier); re-previews mid-drag. */
  setSnapAngle(on: boolean): void
  release(): Promise<boolean>
  cancel(): void
  undo(): void
  redo(): void
  jumpTo(i: number): void
  turnOver(): Promise<boolean>
  /**
   * Preset playback: commit one gesture or a turn over on the current frame,
   * through the committer (Worker), without any preview. Ignored (false) while
   * a commit is pending. The refusal, if any, lands in `refusal`.
   */
  commitStep(step: Gesture | { tool: 'turnOver' }): Promise<CommitStepResult>
  /** Restore a History captured earlier (toast Undo): like undo / jumpTo, drops any gesture, ignored while pending. */
  restoreHistory(h: History): void
  /**
   * Numeric input / angle slider. While a gesture is active it sets
   * Gesture.crease / Gesture.angleDeg and re-runs the preview. Otherwise it
   * re-commits the last fold with those values (R28), see setLastFold.
   */
  setNumeric(edit: NumericEdit): void
  /**
   * R28: replace the last history entry with the same fold re-committed at a
   * new angle and/or crease, against the frame before it (one undo step).
   * Calls made while one is in flight are coalesced (latest wins), so a slider
   * drag sends the Worker at most one request at a time. Refused: history is
   * unchanged and the refusal shows in the hint line. Resolves true on success.
   */
  setLastFold(edit: NumericEdit): Promise<boolean>
  setTool(t: Tool): void
  setPaper(p: Partial<PaperSettings>): void
  /**
   * Start a blank sheet. With an explicit `size` (the paper panel, a preset) only the size
   * changes and the current paper look is kept. Without one, the settings' paper defaults
   * (material, colours, size) apply.
   */
  newSheet(size?: SheetSize): void
}

export type StudioOptions = { committer?: Committer; reduced?: () => boolean }

const sizeOf = (size: SheetSize): PaperSize | null => {
  if (size === 'square' || size === 'a4') return PAPER_SIZES[size]
  const { width, height } = size
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null
}

const idle = { gesture: null, preview: null, refusal: null, settling: null, settleStyle: null } as const

export function createStudioStore({ committer = createWorkerCommitter(), reduced = isReducedMotion }: StudioOptions = {}) {
  return create<StudioState>()((set, get) => {
    let settleCtl: AbortController | null = null
    /** Stop a running settle; callers set `settling: null` themselves (idle does). */
    const endSettle = () => {
      settleCtl?.abort()
      settleCtl = null
    }

    /** Ease the just-committed flap from its released progress to 1 (see header). */
    const startSettle = (
      base: History, g: Gesture | undefined, shown: Preview | null, committed: number, isReduced: boolean,
    ) => {
      // R41: a release commits at the previewed angle, so the settle runs from the
      // release pose to the COMMITTED angle (never past it) and is a no-op when
      // they match (the usual case).
      if (!g || !shown || g.tool !== 'fold' || !Number.isFinite(committed)) return
      if (Math.abs(shown.angleDeg - committed) < 1e-6) return
      const style = { kind: g.kind, tool: g.tool, progress: g.progress }
      if (!isReduced) set({ settling: shown, settleStyle: style })
      const ctl = (settleCtl = new AbortController())
      void tween(shown.angleDeg, committed, SETTLE_MS, a => {
        if (ctl.signal.aborted) return
        if (a === committed) {
          settleCtl = null
          set({ settling: null, settleStyle: null })
          return
        }
        const r = previewFold(current(base), { ...g, angleDeg: a })
        if (r.ok) set({ settling: r.preview, settleStyle: style })
      }, isReduced, ctl.signal)
    }

    /** Preview `g` against the current frame; store the gesture with k clamped to what the engine took. */
    const runPreview = (g: Gesture) => {
      const r = previewFold(current(get().history), g)
      if (r.ok) set({ gesture: { ...g, layers: r.preview.layers }, preview: r.preview, refusal: null })
      else set({ gesture: g, preview: null, refusal: r.reason })
    }

    /** True once the gesture has been dragged (it has a preview or a refusal). */
    const dragged = () => get().preview !== null || get().refusal !== null

    /** Send `req` to the committer and push its step, unless the history moved meanwhile. */
    const runCommit = async (req: CommitRequest): Promise<boolean> => {
      const base = get().history
      const shown = get().preview
      const isReduced = reduced()
      endSettle()
      set({ pending: true, settling: null, settleStyle: null })
      let result
      try {
        result = await committer(req)
      } catch {
        if (get().history === base) set({ ...idle, refusal: COMMIT_FAILED })
        set({ pending: false })
        return false
      }
      if (get().history !== base) {
        set({ pending: false })
        return false
      }
      if (!result.ok) {
        set({ ...idle, refusal: result.reason, pending: false })
        return false
      }
      set({ ...idle, history: push(base, result.step, result.frame), pending: false })
      const angle = (result.step.params as { angleDeg?: number } | null)?.angleDeg
      startSettle(base, 'gesture' in req ? req.gesture : undefined, shown, angle ?? NaN, isReduced)
      return true
    }

    /** History navigation: drops any gesture, then moves the cursor. */
    const navigate = (h: History) => {
      endSettle()
      set({ ...idle, history: h })
    }

    /** At most one re-commit in flight; later edits merge into `queued` (latest wins). */
    let recommitting: Promise<boolean> | null = null
    let queued: NumericEdit | null = null
    /** Set when a re-commit's result was discarded because the history moved (undo, jump, new sheet). */
    let stale = false

    const recommit = async (edit: NumericEdit): Promise<boolean> => {
      const { gesture, pending, history } = get()
      const last = lastFold(history)
      if (gesture || pending || !last || get().replaying) return false
      const prev = undoHistory(history)
      const g: Gesture = {
        tool: last.tool, grab: last.grab, target: last.target, layers: last.layers, kind: edit.kind ?? last.kind,
        progress: 1, snapAngle: last.snapAngle, crease: edit.crease ?? last.crease,
        angleDeg: edit.angleDeg ?? last.angleDeg,
        ...(last.face === undefined ? {} : { face: last.face }),
      }
      endSettle()
      set({ pending: true, settling: null, settleStyle: null })
      let result
      try {
        result = await committer({ frame: current(prev), gesture: g })
      } catch {
        if (get().history === history) set({ refusal: COMMIT_FAILED })
        else stale = true
        set({ pending: false })
        return false
      }
      if (get().history !== history) {
        stale = true
        set({ pending: false })
        return false
      }
      if (!result.ok) {
        set({ refusal: result.reason, pending: false })
        return false
      }
      set({ refusal: null, history: push(prev, result.step, result.frame), pending: false })
      return true
    }

    return {
      history: startHistory(createPaper(PAPER_SIZES.square)),
      tool: 'fold',
      kind: 'valley',
      ...idle,
      paper: DEFAULT_PAPER,
      hint: HINT_START,
      pending: false,
      restoring: false,
      replaying: false,

      setReplaying(on) {
        if (on === get().replaying) return true
        if (on && get().pending) return false
        endSettle()
        queued = null
        set(on ? { ...idle, replaying: true } : { replaying: false })
        return true
      },

      begin(grab, face) {
        if (get().pending || get().replaying) return
        endSettle()
        const { tool, kind } = get()
        const g: Gesture = { tool, grab, target: grab, layers: 1, kind, progress: 0, snapAngle: false }
        set({ ...idle, gesture: face === undefined ? g : { ...g, face } })
      },

      drag(target, progress) {
        const { gesture, pending } = get()
        if (!gesture || pending) return
        runPreview({ ...gesture, target, progress })
      },

      setLayers(k) {
        const { gesture, pending } = get()
        if (!gesture || pending || !Number.isFinite(k)) return
        const g = { ...gesture, layers: Math.max(1, Math.trunc(k)) }
        if (dragged()) runPreview(g)
        else set({ gesture: g })
      },

      setKind(kind) {
        if (get().pending || get().replaying) return
        set({ kind })
        const { gesture } = get()
        if (!gesture) return
        const g = { ...gesture, kind }
        if (dragged()) runPreview(g)
        else set({ gesture: g })
      },

      setSnapAngle(on) {
        const { gesture, pending } = get()
        if (!gesture || pending || gesture.snapAngle === on) return
        const g = { ...gesture, snapAngle: on }
        if (dragged()) runPreview(g)
        else set({ gesture: g })
      },

      release() {
        const { gesture, preview, refusal, pending, history } = get()
        if (pending || !gesture) return Promise.resolve(false)
        if (!preview || refusal) {
          // Nothing valid to commit: end the gesture, keep the refusal for the hint line.
          set({ gesture: null, preview: null })
          return Promise.resolve(false)
        }
        return runCommit({ frame: current(history), gesture })
      },

      cancel() {
        if (get().pending) return
        endSettle()
        set(idle)
      },

      undo: () => { if (!get().replaying) navigate(undoHistory(get().history)) },
      redo: () => { if (!get().replaying) navigate(redoHistory(get().history)) },
      jumpTo: i => { if (!get().replaying) navigate(jumpHistory(get().history, i)) },

      turnOver() {
        if (get().pending || get().replaying) return Promise.resolve(false)
        endSettle()
        set(idle)
        return runCommit({ frame: current(get().history), turnOver: true })
      },

      commitStep(step) {
        if (get().pending || get().replaying) return Promise.resolve({ ok: false, refused: false, reason: null })
        endSettle()
        set(idle)
        const base = get().history
        const frame = current(base)
        return runCommit(step.tool === 'turnOver' ? { frame, turnOver: true } : { frame, gesture: step as Gesture }).then(ok => {
          if (ok) return { ok: true as const }
          const { refusal, history } = get()
          const refused = history === base && refusal !== null
          return { ok: false as const, refused, reason: refused ? refusal : null }
        })
      },

      restoreHistory(h) {
        if (get().pending || get().replaying) return
        navigate(h)
      },

      setNumeric(edit) {
        if (get().replaying) return
        const { gesture, pending } = get()
        if (!gesture) {
          void get().setLastFold(edit)
          return
        }
        if (pending) return
        if (edit.angleDeg !== undefined && !Number.isFinite(edit.angleDeg)) return
        const g = { ...gesture }
        if (edit.crease) g.crease = edit.crease
        if (edit.angleDeg !== undefined) g.angleDeg = edit.angleDeg
        runPreview(g)
      },

      setLastFold(edit) {
        if (get().replaying) return Promise.resolve(false)
        if (edit.angleDeg !== undefined && !Number.isFinite(edit.angleDeg)) return Promise.resolve(false)
        if (recommitting) {
          queued = { ...queued, ...edit }
          return recommitting
        }
        recommitting = (async () => {
          stale = false
          let ok = await recommit(edit)
          let expected = get().history
          // Edits queued meanwhile were meant for the fold they were made on: if the
          // history moved (undo / jump / new sheet) they would hit a different fold.
          while (queued && !stale && get().history === expected) {
            const next: NumericEdit = queued
            queued = null
            ok = await recommit(next)
            expected = get().history
          }
          queued = null
          recommitting = null
          return ok
        })()
        return recommitting
      },

      setTool(tool) {
        if (get().replaying) return
        if (get().pending) return set({ tool })
        endSettle()
        set({ ...idle, tool })
      },

      setPaper(p) {
        set({ paper: { ...get().paper, ...p } })
      },

      newSheet(size) {
        if (get().replaying) return
        const defaults = size === undefined ? paperDefaultsSource?.() : undefined
        const chosen = size ?? defaults?.size ?? get().paper.size
        const s = sizeOf(chosen)
        if (!s) return
        endSettle()
        set({
          ...idle,
          history: startHistory(createPaper(s)),
          paper: defaults ? { ...defaults } : { ...get().paper, size: chosen },
          hint: HINT_START,
        })
      },
    }
  })
}

/** The app's store: commits run in the engine Worker. */
export const useStudio = createStudioStore()
