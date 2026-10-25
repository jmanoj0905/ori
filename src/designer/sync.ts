// Crease pattern ↔ 3D sync (spec 07 "Crease pattern ↔ 3D sync"; Plan 5 Task 4).
//
//   3D → CP: whenever the studio's history moves for any other reason (a fold
//   or turn over, undo / redo / jump, a new sheet, a restored model), the
//   designer shows the current frame's crease pattern. A designer pattern
//   step shows the pattern it recorded (the designer's own assignments; its
//   frame marks open creases 'F').
//   CP → 3D: a designer edit becomes a pattern step showing the pattern
//   unfolded (pre-creased), and "Fold all" one showing it folded flat:
//     - on a blank sheet it is pushed;
//     - when the history's last step (at the cursor) is already a pattern
//       step, that step is replaced (edits do not pile up in the 3D history;
//       the designer has its own undo);
//     - after folding in 3D it BRANCHES the history (engine `branch`): the
//       folded steps are never rewritten, the original stays reachable
//       (branchOf, "Back to folded steps"), and a warning is shown.
//   Patterns over LIVE_SYNC_MAX_EDGES creases are not mirrored live (building
//   thousands of faces per edit would stall the 3D view): the designer is
//   "detached" and the 3D view takes the pattern on Fold all.
import { branch, current, patternFrame, patternStep, push, undo, type Frame, type History, type PatternParams } from '@engine'
import type { StoreApi } from 'zustand'
import { angleOf, type CP } from './cp'
import type { DesignerStore } from './designerSlice'

export const LIVE_SYNC_MAX_EDGES = 1500
export const BRANCH_WARNING = 'Editing the crease pattern started a new branch: your folded steps are kept.'

/** The part of the studio store the sync uses. */
export type StudioLike = { history: History; restoreHistory(h: History): void; pending: boolean; replaying: boolean }

/** A frame's crease pattern: its vertices, edges and assignments ('F' reads as unassigned), no faces. */
export function cpOf(frame: Frame): CP {
  const edges_assignment = frame.edges_assignment.map(a => (a === 'B' || a === 'M' || a === 'V' ? a : 'U'))
  return {
    vertices_coords: frame.vertices_coords.map(p => [p[0], p[1]]),
    edges_vertices: frame.edges_vertices.map(([u, v]) => [u, v]),
    edges_assignment,
    edges_foldAngle: edges_assignment.map(angleOf),
    faces_vertices: [],
    faceOrders: [],
  }
}

/** The crease pattern the history shows at its cursor (a pattern step's own record, else the frame's). */
export function cpOfHistory(h: History): CP {
  const step = h.cursor > 0 ? h.steps[h.cursor - 1] : undefined
  if (step?.kind === 'pattern') {
    const { cp } = step.params as PatternParams
    return cpOf({ ...cp, edges_foldAngle: [], faces_vertices: [], faceOrders: [] })
  }
  return cpOf(current(h))
}

const sameArr = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]) =>
  a.length === b.length && a.every((p, i) => p.length === b[i]!.length && p.every((x, k) => Math.abs(x - b[i]![k]!) < 1e-12))

/** Same vertices, edges and assignments (faces and fold angles aside). */
export function samePattern(a: CP, b: CP): boolean {
  return (
    a.edges_assignment.length === b.edges_assignment.length &&
    a.edges_assignment.every((x, i) => x === b.edges_assignment[i]) &&
    sameArr(a.edges_vertices, b.edges_vertices) &&
    sameArr(a.vertices_coords, b.vertices_coords)
  )
}

/** Put pattern `cp` (shown as `frame`) into the history: push, replace or branch (see header). */
export function applyPattern(h: History, cp: CP, frame: Frame): { history: History; branched: boolean } {
  const last = h.cursor > 0 ? h.steps[h.cursor - 1] : undefined
  const folded = frame.edges_foldAngle.some(a => a !== 0)
  if (last?.kind === 'pattern' && h.cursor === h.steps.length) return { history: push(undo(h), patternStep(cp, folded), frame), branched: false }
  if (h.cursor === 0) return { history: push(h, patternStep(cp, folded), frame), branched: false }
  return { history: branch(h, cp, frame), branched: true }
}

const creaseCount = (cp: CP) => cp.edges_assignment.reduce((n, a) => n + (a === 'B' ? 0 : 1), 0)

export type Link = {
  /** Fold all landed: show `frame` (the folded pattern) in 3D. */
  folded(frame: Frame): void
  /** Back to the history the last branch left (the folded steps). */
  backToFolded(): void
  unlink(): void
}

/**
 * Keep the designer and the studio in step (see header). `notify` shows the
 * branch warning. Returns the link (Fold all, Back to folded steps, unlink).
 */
export function linkDesigner(studio: StoreApi<StudioLike>, designer: DesignerStore, notify: (message: string) => void): Link {
  let syncing = false
  const show = (h: History) => {
    syncing = true
    try {
      studio.getState().restoreHistory(h)
    } finally {
      syncing = false
    }
    return studio.getState().history === h
  }
  const put = (cp: CP, frame: Frame) => {
    const s = studio.getState()
    if (s.pending || s.replaying) return
    const before = s.history
    const r = applyPattern(before, cp, frame)
    if (!show(r.history)) return
    if (r.branched) {
      designer.setState({ branchedFrom: before })
      notify(BRANCH_WARNING)
    }
  }
  const fromStudio = () => {
    const cp = cpOfHistory(studio.getState().history)
    if (samePattern(cp, designer.getState().cp)) return
    syncing = true
    try {
      designer.getState().load(cp, true)
      designer.setState({ detached: false })
    } finally {
      syncing = false
    }
  }

  // Entering designer mode: the 3D model wins unless the designer holds a pattern too large to mirror.
  if (!designer.getState().detached) fromStudio()

  const offStudio = studio.subscribe((s, prev) => {
    if (s.history !== prev.history && !syncing) fromStudio()
  })
  const offDesigner = designer.subscribe((s, prev) => {
    if (s.cp === prev.cp || syncing) return
    if (creaseCount(s.cp) > LIVE_SYNC_MAX_EDGES) {
      if (!s.detached) designer.setState({ detached: true })
      return
    }
    const r = patternFrame(s.cp)
    if (!r.ok) return
    if (s.detached) designer.setState({ detached: false })
    put(s.cp, r.frame)
  })

  return {
    folded(frame) {
      put(designer.getState().cp, frame)
      designer.setState({ detached: false })
    },
    backToFolded() {
      const h = designer.getState().branchedFrom
      if (!h) return
      designer.setState({ branchedFrom: null })
      if (show(h)) fromStudio()
    },
    unlink() {
      offStudio()
      offDesigner()
    },
  }
}
