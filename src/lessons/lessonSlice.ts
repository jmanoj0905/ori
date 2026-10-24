/*
 * Lesson mode (spec 06 "Follow-along flow"; Plan 4 Task 3): the lesson state
 * slice of the studio store, as pure logic against a small host interface
 * (LessonHost: get / set on the store's state plus the committer, the
 * announcer, motion and the lesson loader), so this module needs no React,
 * zustand or studio import (src/boundaries.test.ts). store.ts spreads
 * `createLessonSlice(host)` into the studio store.
 *
 * The lesson's own model ("track"): starting a lesson commits every step's
 * demo gesture (and turn over) from a blank sheet through the host's
 * committer (the engine Worker), giving a History of real engine steps whose
 * frames match the lesson's targets (schema.test). The learner's history is
 * always a prefix of the track plus at most the step being tried:
 *
 *   - Release (`submitFold`, called by the store when a learner commit lands,
 *     before it is pushed): the committed frame is checked against the
 *     current step's target (`checkStep`, with the step's allowMirror). A
 *     match advances: the history becomes the track's prefix up to the new
 *     step, so the lesson continues from its own frame — the same physical
 *     state; only when the learner made an equivalent fold placed
 *     differently (the other half moved, a mirror image) does the model
 *     re-orient to the diagram's. That keeps the next step's ghost, Show me
 *     and keyboard points lined up, and the history (autosave, share links)
 *     made of steps that replay exactly. A miss is never pushed: the fold is
 *     undone at once, with a gentle message; from the HINT_AFTER-th (2nd)
 *     miss the hint shows and is announced (and the Stage pulses the target
 *     landmarks).
 *   - A turn over step matches only a turn over (a turned model is the same
 *     model to checkStep), and a fold never matches it. Turning over when
 *     the step is not a turn over asks first (`askTurn`); a confirmed turn
 *     is a free move: pushed, not judged.
 *   - Show me: back on the lesson's frame (dropping a free turn), the step's
 *     demo is previewed in the store's visual-only `settling` slot, its
 *     progress tweened 0 → 1 over SHOW_MS (one frame at the end with reduced
 *     motion), held SHOW_HOLD_MS, then cleared. The index and history stay:
 *     the learner then folds it themselves. Anything that takes the
 *     settling slot (a new gesture) ends it.
 *   - Skip: the track's next frame, the step recorded in `skipped`.
 *   - Jumping back (the lesson outline, or undo / redo / jumpTo, which call
 *     `syncLessonIndex`): the index follows the history cursor to the last
 *     track frame at or before it; skips at or after it are forgotten.
 *   - Done: `finishedAt` is set when the last step matches or is skipped;
 *     the outline shows the summary.
 */
import { PAPER_SIZES, createPaper, current, preview as previewFold, push, startHistory } from '@engine'
import type { FoldKind, Frame, Gesture, History, PaperSize, Preview, Result, Step, Tool, Vec2 } from '@engine'
import type { PaperSettings, SheetSize } from '../paper'
import { checkStep } from './check'
import type { Lesson, LessonStep } from './schema'

/** A hint appears from this many misses on a step. */
export const HINT_AFTER = 2
/** Show me: the demo's fold-in tween, then how long the folded ghost stays. */
export const SHOW_MS = 700
export const SHOW_HOLD_MS = 900

export const MISS_TEXT = 'Not quite: that fold doesn’t match this step, so it was undone. Try again.'
export const SUCCESS_TEXT = 'Well folded.'
export const TURN_CONFIRM = 'This step isn’t a turn over. Turn the model over anyway?'
export const START_FAILED = 'That lesson could not be started.'

export type LessonMessage = { kind: 'success' | 'miss' | 'info'; text: string }

export type LessonProgress = {
  id: string
  /** The current step (0-based); steps.length when the lesson is done. */
  index: number
  /** Misses on the current step. */
  misses: number
  /** Indices of skipped steps. */
  skipped: number[]
  startedAt: number
  finishedAt: number | null
  message: LessonMessage | null
  /** A turn over was asked for on a step that is not one: waiting for confirmTurn. */
  askTurn: boolean
  /** Show me is playing. */
  showing: boolean
  /** The lesson's own model: frames[i] is the state before step i (see header). */
  track: History
}

export type SettleStyle = { kind: FoldKind; tool: Tool; progress: number; demo?: boolean }

/** The part of the studio state the slice reads and writes. */
export type LessonHostState = {
  history: History
  pending: boolean
  replaying: boolean
  gesture: Gesture | null
  preview: Preview | null
  refusal: string | null
  settling: Preview | null
  settleStyle: SettleStyle | null
  lesson: LessonProgress | null
  lessonData: Lesson | null
}

export type CommitReq = { frame: Frame; gesture: Gesture } | { frame: Frame; turnOver: true }

export type Tween = (from: number, to: number, ms: number, onFrame: (v: number) => void, instant: boolean, signal?: AbortSignal) => Promise<void>

export type LessonHost = {
  get(): LessonHostState
  set(p: Partial<LessonHostState>): void
  commit(req: CommitReq): Promise<Result<{ frame: Frame; step: Step }>>
  load(id: string): Promise<Lesson | null>
  announce(text: string): void
  reduced(): boolean
  tween: Tween
  wait(ms: number): Promise<void>
  now(): number
  /** Start a blank sheet of this size, keeping the paper look (the store's newSheet(size)). */
  newSheet(size: SheetSize): void
  setPaper(p: Partial<PaperSettings>): void
}

export type LessonActions = {
  /** Load the lesson, fold its track and start at step 1 on a blank sheet. False if it can't start. */
  startLesson(id: string): Promise<boolean>
  /**
   * Judge a learner's commit (the store calls this instead of pushing it):
   * pushes the track on a match, drops it on a miss. Returns the match.
   */
  submitFold(base: History, result: { frame: Frame; step: Step }): boolean
  showMe(): Promise<void>
  skipStep(): void
  /** Rewind to step i (0-based, at most the current step). */
  lessonJump(i: number): void
  /** After any history navigation: the index follows the cursor. */
  syncLessonIndex(): void
  exitLesson(): void
}

// ---- pure helpers ----

const sheet = (size: SheetSize): PaperSize =>
  size === 'square' || size === 'a4' ? PAPER_SIZES[size] : { width: size.width, height: size.height }

/** The track's first i steps as a History with its cursor on frame i (frames shared, by identity). */
export function trackPrefix(track: History, i: number): History {
  const n = Math.max(0, Math.min(i, track.steps.length))
  let h = startHistory(track.frames[0]!)
  for (let j = 0; j < n; j++) h = push(h, track.steps[j]!, track.frames[j + 1]!)
  return h
}

/** The step being folded, or null (no lesson, or done). */
export function expectedStep(s: Pick<LessonHostState, 'lesson' | 'lessonData'>): LessonStep | null {
  const { lesson, lessonData } = s
  if (!lesson || !lessonData || lesson.finishedAt !== null) return null
  return lessonData.steps[lesson.index] ?? null
}

/** The model shows the lesson's own frame for the current step (no free turn on top). */
export function aligned(s: Pick<LessonHostState, 'lesson' | 'history'>): boolean {
  const l = s.lesson
  return !!l && current(s.history) === l.track.frames[l.index]
}

const targetCache = new WeakMap<Frame, { step: LessonStep; out: { preview: Preview; demo: Gesture } | null }>()

/**
 * The current step's target, for the Stage's ghost: its demo previewed flat on
 * the lesson frame (cached per frame and step). Null when there is nothing to
 * show: no lesson, done, a turn over step, the model off the lesson's frame
 * (a free turn over), or a gesture / Show me on screen.
 */
export function lessonTarget(
  s: Pick<LessonHostState, 'lesson' | 'lessonData' | 'history' | 'gesture' | 'settling'>,
): { preview: Preview; demo: Gesture; pulse: boolean } | null {
  const step = expectedStep(s)
  if (!step?.demo || !aligned(s) || s.gesture || s.settling) return null
  const frame = current(s.history)
  let hit = targetCache.get(frame)
  if (!hit || hit.step !== step) {
    const r = previewFold(frame, { ...step.demo, progress: 1 })
    hit = { step, out: r.ok ? { preview: r.preview, demo: step.demo } : null }
    targetCache.set(frame, hit)
  }
  return hit.out && { ...hit.out, pulse: s.lesson!.misses >= HINT_AFTER }
}

/** The current step's grab and target points, offered as keyboard-fold landmarks (none off the lesson frame). */
export function lessonPoints(s: Pick<LessonHostState, 'lesson' | 'lessonData' | 'history'>): { grab: Vec2; target: Vec2 } | null {
  const step = expectedStep(s)
  if (!step?.demo || !aligned(s)) return null
  return { grab: step.demo.grab, target: step.demo.target }
}

/** "1 min 05 s", "42 s". */
export function duration(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(t / 60)
  const sec = t % 60
  return m > 0 ? `${m} min ${String(sec).padStart(2, '0')} s` : `${sec} s`
}

export const stepWords = (l: Lesson, i: number) => `Step ${i + 1} of ${l.steps.length}: ${l.steps[i]!.caption}`

export function summaryWords(l: Lesson, p: LessonProgress): string {
  const skipped = p.skipped.length
  const done = l.steps.length - skipped
  const time = duration((p.finishedAt ?? p.startedAt) - p.startedAt)
  return `Lesson complete: ${l.title}. ${done} of ${l.steps.length} steps folded, ${skipped} skipped, in ${time}.`
}

// ---- the slice ----

export function createLessonSlice(host: LessonHost): LessonActions {
  const { get, set } = host
  let showCtl: AbortController | null = null
  /** Bumped by every start, exit and restart: a slow track build for an old start is dropped. */
  let generation = 0

  const stopShow = () => {
    showCtl?.abort()
    showCtl = null
  }

  const progress = (p: Partial<LessonProgress>) => {
    const l = get().lesson
    if (l) set({ lesson: { ...l, ...p } })
  }

  /** Move to step `next` (a match or a skip of the step before it): history = the track prefix. */
  const advance = (next: number, extra: Partial<LessonProgress>, words: string) => {
    const { lesson: l, lessonData: data } = get()
    if (!l || !data) return
    const done = next >= data.steps.length
    const p: LessonProgress = {
      ...l, ...extra, index: next, misses: 0, askTurn: false, showing: false,
      finishedAt: done ? host.now() : null,
    }
    set({ history: trackPrefix(l.track, next), lesson: p, gesture: null, preview: null, refusal: null, settling: null, settleStyle: null })
    host.announce(done ? `${words} ${summaryWords(data, p)}` : `${words} ${stepWords(data, next)}`)
  }

  /** Fold the lesson's track (every demo, committed in turn). Null if a step refuses. */
  const buildTrack = async (l: Lesson): Promise<History | null> => {
    let h = startHistory(createPaper(sheet(l.paper)))
    for (const [i, s] of l.steps.entries()) {
      const frame = current(h)
      let r: Result<{ frame: Frame; step: Step }>
      try {
        r = await host.commit(s.tool === 'turnOver' ? { frame, turnOver: true } : { frame, gesture: s.demo! })
      } catch (e) {
        console.error(`Lesson ${l.id}: step ${i + 1} did not fold:`, e)
        return null
      }
      if (!r.ok) {
        console.error(`Lesson ${l.id}: step ${i + 1} did not fold: ${r.reason}`)
        return null
      }
      h = push(h, r.step, r.frame)
    }
    return h
  }

  const actions: LessonActions = {
    async startLesson(id) {
      if (get().pending || get().replaying) return false
      const gen = ++generation
      stopShow()
      let lesson: Lesson | null = null
      try {
        lesson = await host.load(id)
      } catch (e) {
        console.error(`Lesson ${id} failed to load:`, e)
      }
      if (gen !== generation) return false
      if (!lesson) {
        host.announce(START_FAILED)
        return false
      }
      if (get().pending || get().replaying) return false
      set({ pending: true })
      const track = await buildTrack(lesson)
      set({ pending: false })
      if (gen !== generation) return false
      if (!track) {
        host.announce(START_FAILED)
        return false
      }
      host.newSheet(lesson.paper)
      if (lesson.material) host.setPaper(lesson.material)
      const now = host.now()
      set({
        lessonData: lesson,
        lesson: { id: lesson.id, index: 0, misses: 0, skipped: [], startedAt: now, finishedAt: null, message: null, askTurn: false, showing: false, track },
        history: trackPrefix(track, 0),
        gesture: null, preview: null, refusal: null, settling: null, settleStyle: null,
      })
      host.announce(`Lesson: ${lesson.title}. ${stepWords(lesson, 0)}`)
      return true
    },

    submitFold(base, result) {
      const s = get()
      const step = expectedStep(s)
      const l = s.lesson
      const data = s.lessonData
      if (!step || !l || !data) return false
      stopShow()
      const turned = result.step.kind === 'turnOver'
      const ok =
        step.tool === 'turnOver'
          ? turned
          : !turned && checkStep(result.frame, step.target, { allowMirror: step.allowMirror === true }).match
      if (ok) {
        advance(l.index + 1, { message: { kind: 'success', text: SUCCESS_TEXT } }, SUCCESS_TEXT)
        return true
      }
      const misses = l.misses + 1
      const hint = misses >= HINT_AFTER
      const text = hint ? `${MISS_TEXT} Hint: ${step.hint}` : MISS_TEXT
      set({ history: base, lesson: { ...l, misses, askTurn: false, message: { kind: 'miss', text } } })
      host.announce(text)
      return false
    },

    async showMe() {
      const s = get()
      const step = expectedStep(s)
      const l = s.lesson
      const data = s.lessonData
      if (!step || !l || !data || s.pending || s.replaying) return
      stopShow()
      if (step.tool === 'turnOver' || !step.demo) {
        const text = `Show me: ${step.caption} Use Turn over.`
        progress({ message: { kind: 'info', text } })
        host.announce(text)
        return
      }
      // back on the lesson's own frame first (a free turn over is dropped)
      if (!aligned(s)) set({ history: trackPrefix(l.track, l.index) })
      const frame = l.track.frames[l.index]!
      const demo = step.demo
      const ctl = (showCtl = new AbortController())
      let last: Preview | null = null
      const style = (progress: number): SettleStyle => ({ kind: demo.kind, tool: demo.tool, progress, demo: true })
      const draw = (p: number) => {
        if (ctl.signal.aborted) return
        // someone else took the slot (a gesture began): stop showing
        if (last && get().settling !== last) return ctl.abort()
        const r = previewFold(frame, { ...demo, progress: p })
        if (!r.ok) return
        last = r.preview
        set({ settling: r.preview, settleStyle: style(p), gesture: null, preview: null, refusal: null })
      }
      set({ lesson: { ...l, showing: true, askTurn: false, message: { kind: 'info', text: `Watch: ${step.caption}` } } })
      host.announce(`Showing step ${l.index + 1}: ${step.caption}`)
      await host.tween(0.02, 1, SHOW_MS, draw, host.reduced(), ctl.signal)
      if (!ctl.signal.aborted) await host.wait(SHOW_HOLD_MS)
      if (showCtl === ctl) showCtl = null
      const now = get()
      if (last && now.settling === last) set({ settling: null, settleStyle: null })
      if (now.lesson && now.lesson.id === l.id && now.lesson.showing) {
        set({ lesson: { ...now.lesson, showing: false, message: { kind: 'info', text: 'Your turn: fold it.' } } })
      }
    },

    skipStep() {
      const s = get()
      const l = s.lesson
      if (!expectedStep(s) || !l || s.pending || s.replaying) return
      stopShow()
      advance(l.index + 1, { skipped: [...l.skipped, l.index], message: { kind: 'info', text: `Step ${l.index + 1} skipped.` } }, `Step ${l.index + 1} skipped.`)
    },

    lessonJump(i) {
      const s = get()
      const l = s.lesson
      const data = s.lessonData
      if (!l || !data || s.pending || s.replaying || !Number.isInteger(i) || i < 0 || i > l.index || i >= data.steps.length) return
      stopShow()
      set({
        history: trackPrefix(l.track, i),
        lesson: { ...l, index: i, misses: 0, skipped: l.skipped.filter(k => k < i), finishedAt: null, askTurn: false, showing: false, message: null },
        gesture: null, preview: null, refusal: null, settling: null, settleStyle: null,
      })
      host.announce(`Back to ${stepWords(data, i)}`)
    },

    syncLessonIndex() {
      const { lesson: l, lessonData: data, history: h } = get()
      if (!l || !data) return
      stopShow()
      if (h.frames[0] !== l.track.frames[0]) {
        // the history was replaced by something that isn't this lesson
        actions.exitLesson()
        return
      }
      let c = Math.min(h.cursor, l.track.frames.length - 1)
      while (c > 0 && h.frames[c] !== l.track.frames[c]) c--
      if (c === l.index) return
      const done = c >= data.steps.length
      set({
        lesson: {
          ...l, index: c, misses: 0, skipped: l.skipped.filter(k => k < c), askTurn: false, showing: false, message: null,
          finishedAt: done ? (l.finishedAt ?? host.now()) : null,
        },
      })
      host.announce(done ? summaryWords(data, { ...l, finishedAt: l.finishedAt ?? host.now() }) : stepWords(data, c))
    },

    exitLesson() {
      generation++
      stopShow()
      if (!get().lesson && !get().lessonData) return
      const showing = get().settleStyle?.demo
      set({ lesson: null, lessonData: null, ...(showing ? { settling: null, settleStyle: null } : {}) })
    },
  }
  return actions
}
