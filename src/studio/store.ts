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
// Async commit (R33): release() and turnOver() return a Promise<boolean>
// (true when a step was pushed). While a commit is pending, `pending` is
// true, the preview stays on screen (until the result lands, so the Stage can
// settle into it), and begin / drag / setLayers / setKind / release /
// turnOver are ignored (not queued: a gesture started mid-commit would be
// planned against a frame that is about to change). Undo, redo, jumpTo and
// newSheet stay live; if the history changed while a commit was in flight,
// its result is dropped (it was computed from a frame that is no longer
// current) and the promise resolves false.
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
import type { FoldKind, Gesture, History, PaperSize, Preview, Tool, Vec2 } from '@engine'
import { createWorkerCommitter, type CommitRequest, type Committer } from './committer'

export const HINT_START = 'Grab a corner and drag it across.'
/** Shown when the committer itself fails (worker crash), not an engine refusal. */
export const COMMIT_FAILED = 'Something went wrong with that fold. Try again.'

export const SWATCHES = Object.freeze({
  vermilion: '#D9472B',
  indigo: '#2F4A8A',
  matcha: '#7A9A57',
  ochre: '#C9962B',
  sumi: '#2B2A28',
})

export type SheetSize = 'square' | 'a4' | { width: number; height: number }

export type PaperSettings = {
  mode: 'kami' | 'washi' | 'plain' | 'custom'
  front: string
  back: string
  pattern?: 'seigaiha' | 'asanoha'
  thickness: number
  translucency: number
  size: SheetSize
}

export const DEFAULT_PAPER: PaperSettings = Object.freeze({
  mode: 'kami',
  front: SWATCHES.vermilion,
  back: '#FFFFFF',
  thickness: 0.5,
  translucency: 0,
  size: 'square',
})

export type StudioState = {
  history: History
  tool: Tool
  kind: FoldKind
  gesture: Gesture | null
  preview: Preview | null
  refusal: string | null
  paper: PaperSettings
  hint: string
  /** A commit (release or turn over) is in flight. */
  pending: boolean

  /** Start a fold gesture; `face` is the face hit at grab (Gesture.face). */
  begin(grab: Vec2, face?: number): void
  drag(target: Vec2, progress: number): void
  setLayers(k: number): void
  setKind(k: FoldKind): void
  release(): Promise<boolean>
  cancel(): void
  undo(): void
  redo(): void
  jumpTo(i: number): void
  turnOver(): Promise<boolean>
  setTool(t: Tool): void
  setPaper(p: Partial<PaperSettings>): void
  newSheet(size: SheetSize): void
}

export type StudioOptions = { committer?: Committer }

const sizeOf = (size: SheetSize): PaperSize | null => {
  if (size === 'square' || size === 'a4') return PAPER_SIZES[size]
  const { width, height } = size
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null
}

const idle = { gesture: null, preview: null, refusal: null } as const

export function createStudioStore({ committer = createWorkerCommitter() }: StudioOptions = {}) {
  return create<StudioState>()((set, get) => {
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
      set({ pending: true })
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
      return true
    }

    /** History navigation: drops any gesture, then moves the cursor. */
    const navigate = (h: History) => set({ ...idle, history: h })

    return {
      history: startHistory(createPaper(PAPER_SIZES.square)),
      tool: 'fold',
      kind: 'valley',
      ...idle,
      paper: DEFAULT_PAPER,
      hint: HINT_START,
      pending: false,

      begin(grab, face) {
        if (get().pending) return
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
        if (get().pending) return
        set({ kind })
        const { gesture } = get()
        if (!gesture) return
        const g = { ...gesture, kind }
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
        set(idle)
      },

      undo: () => navigate(undoHistory(get().history)),
      redo: () => navigate(redoHistory(get().history)),
      jumpTo: i => navigate(jumpHistory(get().history, i)),

      turnOver() {
        if (get().pending) return Promise.resolve(false)
        set(idle)
        return runCommit({ frame: current(get().history), turnOver: true })
      },

      setTool(tool) {
        if (get().pending) return set({ tool })
        set({ ...idle, tool })
      },

      setPaper(p) {
        set({ paper: { ...get().paper, ...p } })
      },

      newSheet(size) {
        const s = sizeOf(size)
        if (!s) return
        set({
          ...idle,
          history: startHistory(createPaper(s)),
          paper: { ...get().paper, size },
          hint: HINT_START,
        })
      },
    }
  })
}

/** The app's store: commits run in the engine Worker. */
export const useStudio = createStudioStore()
