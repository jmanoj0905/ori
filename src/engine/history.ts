// Immutable undo/redo/jump history over frames. Pure TypeScript.
import type { Frame, Tool } from './types'

/**
 * `pattern`: a crease pattern from the designer (Plan 5), shown unfolded or,
 * after "Fold all", collapsed flat. Its params are PatternParams.
 * `sculpted`: a soft-paper shape kept as a mesh snapshot (Plan 6, sculpt.ts).
 */
export type Step = { kind: Tool | 'turnOver' | 'pattern' | 'sculpted'; params: unknown; label: string; at: number }

/** A pattern step's record: the crease pattern itself (faces and orders are rebuilt on replay). */
export type PatternParams = {
  folded: boolean
  cp: { vertices_coords: Frame['vertices_coords']; edges_vertices: Frame['edges_vertices']; edges_assignment: Frame['edges_assignment'] }
}

/** frames[0] is the blank sheet; steps[i] produced frames[i + 1]. */
export type History = {
  readonly frames: Frame[]
  readonly steps: Step[]
  readonly cursor: number
  /** On a branch (see `branch`): the history it branched from, kept whole. */
  readonly branchOf?: History
}

const make = (frames: Frame[], steps: Step[], cursor: number, branchOf?: History): History =>
  Object.freeze({
    frames: Object.freeze(frames) as Frame[],
    steps: Object.freeze(steps) as Step[],
    cursor,
    ...(branchOf ? { branchOf } : {}),
  })

export const startHistory = (f: Frame): History => make([f], [], 0)

export const push = (h: History, step: Step, f: Frame): History =>
  make([...h.frames.slice(0, h.cursor + 1), f], [...h.steps.slice(0, h.cursor), step], h.cursor + 1, h.branchOf)

export const jumpTo = (h: History, index: number): History => {
  if (!Number.isFinite(index)) return h // NaN / ±Infinity: keep the cursor
  const i = Math.min(Math.max(Math.trunc(index), 0), h.frames.length - 1)
  return i === h.cursor ? h : make(h.frames, h.steps, i, h.branchOf)
}

export const undo = (h: History): History => jumpTo(h, h.cursor - 1)
export const redo = (h: History): History => jumpTo(h, h.cursor + 1)
export const current = (h: History): Frame => h.frames[h.cursor]
export const canUndo = (h: History): boolean => h.cursor > 0
export const canRedo = (h: History): boolean => h.cursor < h.frames.length - 1

/**
 * The step that records crease pattern `cp` with the designer's assignments
 * (folded, by default, when any of its creases is folded).
 */
export function patternStep(cp: Frame, folded = cp.edges_foldAngle.some(a => a !== 0)): Step {
  const params: PatternParams = {
    folded,
    cp: { vertices_coords: cp.vertices_coords, edges_vertices: cp.edges_vertices, edges_assignment: cp.edges_assignment },
  }
  return { kind: 'pattern', params, label: folded ? 'Fold all' : 'Crease pattern', at: Date.now() }
}

/**
 * Editing the crease pattern after folding in 3D (spec 07): a new line of
 * history that keeps every step up to the cursor as it was and continues
 * with a pattern step recording `cp`, showing `frame` (the pattern's engine
 * frame: patternFrame or foldPattern; `cp` itself by default). The original
 * history (redo steps included) is not rewritten: it stays reachable as
 * `branchOf`.
 */
export const branch = (h: History, cp: Frame, frame: Frame = cp): History => {
  const b = push(h, patternStep(cp, frame.edges_foldAngle.some(a => a !== 0)), frame)
  return make(b.frames, b.steps, b.cursor, h)
}
