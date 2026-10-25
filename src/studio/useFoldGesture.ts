// The bridge from pointer events on the Stage canvas to the studio store:
// press picks the top flap and snaps the grab, moves snap the target and
// compute the drag progress, release commits. Raw events, bindings, layers,
// Esc and pointercancel/blur belong to the input router (src/input/router.ts),
// which calls down/move/up/cancel here; pointer capture is the router's job.
//
// Coordinates: the engine's gesture points are FOLDED-space points (z = 0).
// The grab comes from pick().folded (where the visible flap is), the target
// from projectToPaperPlane (the view ray meets z = 0). Both are re-read from
// the Stage on every event, and the snap radius is recomputed per event from
// the Stage's current zoom, so a resize or devicePixelRatio change mid-drag
// cannot desync the gesture (the grab is held in paper space, never in pixels).
import { current, landmarks, snapPoint } from '@engine'
import type { Line, Vec2 } from '@engine'
import type { Pick } from '../render/Stage'
import { snapRadiusPaper } from '../render/pickMath'
import { useStudio, type StudioState } from './store'
import { useSettings } from '../settings/store'

/** Default snap radius in CSS pixels (the settings store takes over in Task 5). */
export const SNAP_RADIUS_PX = 12

/** What the gesture needs from the Stage (a mock in tests). */
export interface GestureStage {
  readonly canvas: HTMLElement
  pick(clientX: number, clientY: number): Pick | null
  projectToPaperPlane(clientX: number, clientY: number): Vec2
  /** CSS pixels per paper unit at the current zoom. */
  pxPerUnit(): number
  /** Highlight the landmark under the cursor while hovering (null clears it). */
  setHoverMarker?(p: Vec2 | null): void
}

type StoreLike = { getState(): StudioState }
export type GestureOptions = { snapRadiusPx?: () => number }
type PointerLike = { button?: number; pointerId: number; clientX: number; clientY: number }

/**
 * Fold progress of a cursor for a grab and its crease: 0 at the grab, 0.5 on
 * the crease, 1 at the grab's mirror image across the crease. It is the
 * cursor's displacement from the grab along the crease normal (toward the
 * crease) divided by the grab-to-mirror distance, clamped to [0, 1]: pulling
 * past the mirror is a flat fold, going back behind the grab is 0. Movement
 * along the crease does not count. A grab on the crease has no side to fold
 * to, so its progress is 0.
 *
 * Note the crease is the perpendicular bisector of grab and target, so with
 * an unconstrained drag the raw cursor sits on the mirror (progress ~ 1); it
 * is lower only when snapping moved the target off the cursor.
 */
export function dragProgress(grab: Vec2, crease: Line, cursor: Vec2): number {
  const [nx, ny] = [-crease.vector[1], crease.vector[0]]
  const len = Math.hypot(nx, ny)
  if (len === 0) return 0
  // Signed distance of the grab from the crease along the unit normal.
  const side = ((grab[0] - crease.origin[0]) * nx + (grab[1] - crease.origin[1]) * ny) / len
  if (Math.abs(side) < 1e-9) return 0
  const toward = side > 0 ? -1 : 1 // normal direction pointing from grab to crease
  const moved = (((cursor[0] - grab[0]) * nx + (cursor[1] - grab[1]) * ny) / len) * toward
  return Math.min(1, Math.max(0, moved / (2 * Math.abs(side))))
}

const bisector = (grab: Vec2, target: Vec2): Line | null => {
  const d: Vec2 = [target[0] - grab[0], target[1] - grab[1]]
  if (Math.hypot(d[0], d[1]) < 1e-4) return null
  return { origin: [(grab[0] + target[0]) / 2, (grab[1] + target[1]) / 2], vector: [-d[1], d[0]] }
}

/** The pointer handlers, free of React so they can be driven directly in tests. */
export function createFoldGesture(stage: GestureStage, store: StoreLike = useStudio, opts: GestureOptions = {}) {
  let active: { id: number; grab: Vec2; moved: boolean } | null = null
  const radiusPx = opts.snapRadiusPx ?? (() => useSettings.getState().snapRadiusPx)

  /** Landmarks the user has snapping switched on for (Tools island / settings). */
  const enabled = () => {
    const sn = useSettings.getState().snap
    const ls = landmarks(current(store.getState().history), { edges: true })
    return ls.filter(l =>
      l.kind === 'corner' ? sn.corners : l.kind === 'midpoint' ? sn.midpoints : l.kind === 'intersection' ? sn.intersections : sn.edges)
  }

  const snapTo = (p: Vec2) => snapPoint(p, enabled(), snapRadiusPaper(radiusPx(), stage.pxPerUnit()))
  const snap = (p: Vec2): Vec2 => snapTo(p).p

  const setCursor = (c: string) => {
    stage.canvas.style.cursor = c
  }

  return {
    /** Hold-modifier: the next fold ignores hinge candidates (Task 8). Stub: no-op for now. */
    setForceNew(on: boolean): void {
      void on
    },

    /** Returns true when a gesture began (false: the router should treat the drag as refused). */
    down(e: PointerLike): boolean {
      if (store.getState().pending) return false
      if (active) {
        // A press from the same pointer is a duplicate; a different pointer means the
        // previous one was lost (released outside the window): drop its stale gesture.
        if (active.id === e.pointerId) return false
        active = null
        store.getState().cancel()
      }
      const hit = stage.pick(e.clientX, e.clientY)
      if (!hit) return false
      const grab = snap(hit.folded)
      store.getState().begin(grab, hit.face)
      active = { id: e.pointerId, grab, moved: false }
      stage.setHoverMarker?.(null)
      setCursor('grabbing')
      return true
    },

    /** Hover feedback while no drag is active. */
    hover(e: { clientX: number; clientY: number }): void {
      if (active) return
      const hit = stage.pick(e.clientX, e.clientY)
      setCursor(hit ? 'grab' : '')
      // Spec 03 step 1: the nearest landmark highlights.
      const near = hit ? snapTo(hit.folded) : null
      stage.setHoverMarker?.(near?.snapped ? near.p : null)
    },

    /** The pointer left the canvas: drop the hover feedback. */
    leave(): void {
      if (!active) setCursor('')
      stage.setHoverMarker?.(null)
    },

    /** Cancel the gesture as if Esc was pressed (also the pointercancel / blur path). */
    cancel(): void {
      active = null
      store.getState().cancel()
      setCursor('')
    },

    move(e: PointerLike): void {
      if (!active) return
      if (e.pointerId !== active.id) return
      const cursor = stage.projectToPaperPlane(e.clientX, e.clientY)
      const target = snap(cursor)
      const crease = bisector(active.grab, target)
      if (!crease) return
      active.moved = true
      store.getState().drag(target, dragProgress(active.grab, crease, cursor))
    },

    /** The pointer capture was lost without a pointerup: cancel cleanly. */
    lost(e: { pointerId: number }): void {
      if (!active || e.pointerId !== active.id) return
      active = null
      store.getState().cancel()
      setCursor('')
    },

    async up(e: PointerLike): Promise<void> {
      if (!active || e.pointerId !== active.id) return
      const { moved } = active
      active = null
      setCursor(stage.pick(e.clientX, e.clientY) ? 'grab' : '')
      if (moved) await store.getState().release()
      else store.getState().cancel()
    },
  }
}
