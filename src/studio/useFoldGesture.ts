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
//
// Swing vs new fold (spec 09): with the Fold tool, a press collects the hinge
// candidates of the grabbed flap (hingesAt) and every move reads the drag
// (readDrag): along a hinge's normal it swings the flap on that existing
// crease, otherwise (or with the force-new modifier held) it is a new fold,
// whose bisector locks onto a nearby existing crease when crease snapping is
// on. A swing released within SETTLE_OPEN_DEG of flat settles fully open.
// Other tools (reverse, squash, petal) keep their plain bisector drag.
import { current, hingesAt, landmarks, snapCreaseLine, snapPoint } from '@engine'
import type { Frame, HingeCandidate, Line, Vec2 } from '@engine'
import type { Pick } from '../render/Stage'
import { snapRadiusPaper } from '../render/pickMath'
import { useStudio, type DragOptions, type StudioState } from './store'
import { useSettings } from '../settings/store'
import { readDrag, settleOpen, type Reading } from './dragReading'

/** Crease snap: a new fold's bisector within this angle of an existing crease locks onto it. */
const CREASE_SNAP_DEG = 4
/** A drag shorter than this (CSS px) keeps the previous reading. */
const MIN_DRAG_PX = 6

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
  /** Highlight the flap under the cursor and its hinge segments (null clears it). */
  setHoverFlap?(faces: readonly number[] | null, hinges: readonly (readonly [Vec2, Vec2])[]): void
}

type StoreLike = { getState(): StudioState }
export type GestureOptions = {
  snapRadiusPx?: () => number
  /** Frame scheduler for the hover query (default requestAnimationFrame). */
  raf?: (cb: () => void) => void
}
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
  /** The live drag: its hinge candidates, current reading and the last drag sent to the store. */
  let active: {
    id: number
    grab: Vec2
    moved: boolean
    hinges: readonly HingeCandidate[]
    reading: Reading
    last: { target: Vec2; progress: number; opts?: DragOptions } | null
  } | null = null
  let forceNew = false
  const radiusPx = opts.snapRadiusPx ?? (() => useSettings.getState().snapRadiusPx)
  const raf = opts.raf ?? (cb => void requestAnimationFrame(cb))

  /** Landmarks the user has snapping switched on for (Tools island / settings). */
  const enabled = () => {
    const sn = useSettings.getState().snap
    const ls = landmarks(current(store.getState().history), { edges: true })
    return ls.filter(l =>
      l.kind === 'corner' ? sn.corners : l.kind === 'midpoint' ? sn.midpoints : l.kind === 'intersection' ? sn.intersections : sn.edges)
  }

  const radiusPaper = () => snapRadiusPaper(radiusPx(), stage.pxPerUnit())
  const snapTo = (p: Vec2) => snapPoint(p, enabled(), radiusPaper())
  const snap = (p: Vec2): Vec2 => snapTo(p).p

  const setCursor = (c: string) => {
    stage.canvas.style.cursor = c
  }

  // Hover flap: the latest hovered hit, queried at most once per animation frame.
  let hoverHit: Pick | null = null
  let hoverQueued = false
  /** What the flap highlight currently shows (frame + face), so an unchanged hover does not rebuild it. */
  let hoverShown: { frame: Frame; face: number } | null = null
  const clearHover = () => {
    hoverHit = null
    if (hoverShown === null) return
    hoverShown = null
    stage.setHoverFlap?.(null, [])
  }
  const showHover = () => {
    hoverQueued = false
    const hit = hoverHit
    if (!hit || active || store.getState().tool !== 'fold') return clearHover()
    const frame = current(store.getState().history)
    if (hoverShown && hoverShown.frame === frame && hoverShown.face === hit.face) return
    const hinges = hingesAt(frame, hit.folded, 1, hit.face)
    const faces = hinges.length ? [...new Set(hinges.flatMap(h => h.faces))] : [hit.face]
    hoverShown = { frame, face: hit.face }
    stage.setHoverFlap?.(faces, hinges.flatMap(h => h.segments))
  }

  return {
    /** Hold-modifier (forceNewFold): while on, drags ignore hinge candidates and make a new fold. */
    setForceNew(on: boolean): void {
      forceNew = on
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
      const { gesture, tool, history } = store.getState()
      const hinges = gesture && tool === 'fold' ? hingesAt(current(history), grab, gesture.layers, hit.face) : []
      active = { id: e.pointerId, grab, moved: false, hinges, reading: { mode: 'new' }, last: null }
      stage.setHoverMarker?.(null)
      clearHover()
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
      // Spec 09: the flap under the cursor and its hinges (Fold tool only).
      if (!stage.setHoverFlap) return
      hoverHit = hit
      if (!hoverQueued) {
        hoverQueued = true
        raf(showHover)
      }
    },

    /** The pointer left the canvas: drop the hover feedback. */
    leave(): void {
      if (!active) setCursor('')
      stage.setHoverMarker?.(null)
      clearHover()
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
      const { grab, hinges } = active
      const cursor = stage.projectToPaperPlane(e.clientX, e.clientY)
      const st = store.getState()
      const fold = st.tool === 'fold'
      const reading = fold
        ? readDrag({ grab, cursor, hinges, prev: active.reading, forceNew, minDrag: MIN_DRAG_PX / stage.pxPerUnit() })
        : active.reading
      active.reading = reading
      const h = reading.mode === 'swing' ? hinges[reading.hinge] : undefined
      let target: Vec2
      let progress: number
      let dragOpts: DragOptions | undefined
      if (h) {
        target = cursor
        progress = dragProgress(grab, h.line, cursor)
        dragOpts = { crease: h.line, kind: h.openKind, reading: 'swing' }
      } else {
        target = snap(cursor)
        const crease = bisector(grab, target)
        if (!crease) return
        const hit = fold && useSettings.getState().snap.creases
          ? snapCreaseLine(current(st.history), crease, { angleDeg: CREASE_SNAP_DEG, dist: radiusPaper() })
          : null
        progress = dragProgress(grab, hit ?? crease, cursor)
        dragOpts = !fold ? undefined : hit ? { crease: hit, reading: 'new' } : { reading: 'new' }
      }
      active.moved = true
      active.last = { target, progress, ...(dragOpts ? { opts: dragOpts } : {}) }
      st.drag(target, progress, dragOpts)
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
      const { moved, reading, hinges, last } = active
      active = null
      setCursor(stage.pick(e.clientX, e.clientY) ? 'grab' : '')
      if (!moved) return store.getState().cancel()
      // A swing released close to flat settles fully open.
      const h = reading.mode === 'swing' ? hinges[reading.hinge] : undefined
      if (h && last) {
        const settled = settleOpen(last.progress, h.rangeDeg)
        if (settled !== last.progress) store.getState().drag(last.target, settled, last.opts)
      }
      await store.getState().release()
    },
  }
}
