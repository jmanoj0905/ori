// Immutable undo/redo/jump history over frames. Pure TypeScript.
import type { Frame, Tool } from './types'

export type Step = { kind: Tool | 'turnOver'; params: unknown; label: string; at: number }

/** frames[0] is the blank sheet; steps[i] produced frames[i + 1]. */
export type History = {
  readonly frames: Frame[]
  readonly steps: Step[]
  readonly cursor: number
}

const make = (frames: Frame[], steps: Step[], cursor: number): History =>
  Object.freeze({ frames: Object.freeze(frames) as Frame[], steps: Object.freeze(steps) as Step[], cursor })

export const startHistory = (f: Frame): History => make([f], [], 0)

export const push = (h: History, step: Step, f: Frame): History =>
  make([...h.frames.slice(0, h.cursor + 1), f], [...h.steps.slice(0, h.cursor), step], h.cursor + 1)

export const jumpTo = (h: History, index: number): History => {
  if (!Number.isFinite(index)) return h // NaN / ±Infinity: keep the cursor
  const i = Math.min(Math.max(Math.trunc(index), 0), h.frames.length - 1)
  return i === h.cursor ? h : make(h.frames, h.steps, i)
}

export const undo = (h: History): History => jumpTo(h, h.cursor - 1)
export const redo = (h: History): History => jumpTo(h, h.cursor + 1)
export const current = (h: History): Frame => h.frames[h.cursor]
export const canUndo = (h: History): boolean => h.cursor > 0
export const canRedo = (h: History): boolean => h.cursor < h.frames.length - 1
