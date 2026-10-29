// @vitest-environment jsdom
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Vec2 } from '@engine'
import { clientToPlane, planeToClient, pxPerUnit, snapRadiusPaper, type RectLike } from '../render/pickMath'
import { inProcessCommitter } from './committer'
import { createStudioStore } from './store'
import { current, layerAt, progressToAngle, startHistory } from '@engine'
import type { Frame } from '@engine'
import { halfFolded, openedHalf } from '../engine/testkit'
import { useUi } from './ui'
import { BELT_RADIUS_PX, rowPx } from './belt'
import { createFoldGesture, dragProgress, SNAP_RADIUS_PX, type GestureOptions, type GestureStage } from './useFoldGesture'

const line = (a: Vec2, b: Vec2) => ({ origin: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Vec2, vector: [-(b[1] - a[1]), b[0] - a[0]] as Vec2 })

describe('dragProgress', () => {
  const grab: Vec2 = [1, 1]
  const mirror: Vec2 = [0, 0]
  const crease = line(grab, mirror)
  test('0 at the grab, 0.5 at the crease, 1 at the mirror', () => {
    expect(dragProgress(grab, crease, grab)).toBeCloseTo(0)
    expect(dragProgress(grab, crease, [0.5, 0.5])).toBeCloseTo(0.5)
    expect(dragProgress(grab, crease, mirror)).toBeCloseTo(1)
  })
  test('clamped: pulling past the mirror is flat, behind the grab is 0', () => {
    expect(dragProgress(grab, crease, [-3, -3])).toBe(1)
    expect(dragProgress(grab, crease, [4, 4])).toBe(0)
  })
  test('only the component along the crease normal counts', () => {
    expect(dragProgress(grab, crease, [0.5 + 2, 0.5 - 2])).toBeCloseTo(0.5)
  })
  test('a grab on the crease (degenerate) is 0', () => {
    expect(dragProgress([0.5, 0.5], crease, [0, 0])).toBe(0)
  })
})

const camera = (aspect: number) => {
  const c = new THREE.PerspectiveCamera(35, aspect, 0.1, 400)
  c.position.set(0.5, -0.9, 3)
  c.up.set(0, 1, 0)
  c.lookAt(0.5, 0.5, 0)
  c.updateMatrixWorld(true)
  return c
}

describe('snap radius', () => {
  test('12 px is converted to paper units through the current zoom', () => {
    expect(SNAP_RADIUS_PX).toBe(12)
    const rect: RectLike = { left: 0, top: 0, width: 800, height: 600 }
    const near = camera(800 / 600)
    const far = camera(800 / 600)
    far.position.set(0.5, -2.7, 9)
    far.lookAt(0.5, 0.5, 0)
    far.updateMatrixWorld(true)
    const k1 = pxPerUnit(near, rect, [0.5, 0.5])
    const k2 = pxPerUnit(far, rect, [0.5, 0.5])
    expect(k1).toBeGreaterThan(k2 * 2.5)
    expect(snapRadiusPaper(12, k1) * k1).toBeCloseTo(12)
    expect(snapRadiusPaper(12, k2)).toBeGreaterThan(snapRadiusPaper(12, k1) * 2.5)
    // Round trip: a point 12 px away in client space is snapRadiusPaper away on the plane.
    const a = clientToPlane(near, rect, 400, 300)!
    const b = clientToPlane(near, rect, 412, 300)!
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(snapRadiusPaper(12, k1), 1)
  })
})

describe('resize mid-drag (Review Focus 1)', () => {
  test('after a resize the next pick maps to the same paper point', () => {
    const p: Vec2 = [0.8, 0.3]
    const rect1: RectLike = { left: 0, top: 0, width: 800, height: 600 }
    const cam1 = camera(800 / 600)
    const [cx1, cy1] = planeToClient(cam1, rect1, p)
    const before = clientToPlane(cam1, rect1, cx1, cy1)!
    // Resize: new element rect (offset, new size) and aspect; the same paper point lands elsewhere on screen.
    const rect2: RectLike = { left: 40, top: 10, width: 1200, height: 500 }
    const cam2 = camera(1200 / 500)
    const [cx2, cy2] = planeToClient(cam2, rect2, p)
    expect([cx2, cy2]).not.toEqual([cx1, cy1])
    const after = clientToPlane(cam2, rect2, cx2, cy2)!
    expect(after[0]).toBeCloseTo(before[0], 6)
    expect(after[1]).toBeCloseTo(before[1], 6)
    expect(after[0]).toBeCloseTo(p[0], 6)
    expect(after[1]).toBeCloseTo(p[1], 6)
  })

  test('the gesture stays in sync: grab is fixed in paper space, later moves use the new mapping', () => {
    // A mock stage whose screen mapping changes (resize) between events.
    let scale = 100
    let offset = 0
    const stage: GestureStage = {
      canvas: document.createElement('canvas'),
      pick: (x, y) => ({ face: 0, paper: [(x - offset) / scale, 1 - (y - offset) / scale], folded: [(x - offset) / scale, 1 - (y - offset) / scale] }),
      projectToPaperPlane: (x, y) => [(x - offset) / scale, 1 - (y - offset) / scale],
      pxPerUnit: () => scale,
    }
    const store = createStudioStore({ committer: inProcessCommitter })
    const g = createFoldGesture(stage, store)
    const ev = (x: number, y: number) => ({ button: 0, pointerId: 1, clientX: x, clientY: y })
    g.down(ev(100, 0)) // folded (1, 1): the top-right corner
    const grab = store.getState().gesture!.grab
    expect(grab[0]).toBeCloseTo(1)
    expect(grab[1]).toBeCloseTo(1)
    scale = 200 // resize / DPR change mid-drag
    offset = 20
    g.move(ev(20, 220)) // the new mapping puts this at paper (0, 0)
    const s = store.getState().gesture!
    expect(s.grab).toEqual(grab)
    expect(s.target[0]).toBeCloseTo(0)
    expect(s.target[1]).toBeCloseTo(0)
    expect(s.progress).toBeCloseTo(1)
  })
})

describe('createFoldGesture on the blank square', () => {
  const stageFor = (): GestureStage => ({
    canvas: document.createElement('canvas'),
    pick: (x, y) => (x >= 0 && x <= 100 && y >= 0 && y <= 100 ? { face: 0, paper: [x / 100, 1 - y / 100], folded: [x / 100, 1 - y / 100] } : null),
    projectToPaperPlane: (x, y) => [x / 100, 1 - y / 100],
    pxPerUnit: () => 100,
  })
  const ev = (x: number, y: number, button = 0) => ({ button, pointerId: 1, clientX: x, clientY: y })

  test('drag the top-right corner to the bottom-left: snaps, previews, commits one step', async () => {
    const store = createStudioStore({ committer: inProcessCommitter })
    const g = createFoldGesture(stageFor(), store)
    g.down(ev(97, 3)) // near the corner (px 3,3 away = 0.03 paper < 12px = 0.12)
    expect(store.getState().gesture?.grab).toEqual([1, 1])
    expect(store.getState().gesture?.face).toBe(0)
    g.move(ev(50, 50))
    expect(store.getState().preview).not.toBeNull()
    g.move(ev(4, 96))
    expect(store.getState().gesture?.target).toEqual([0, 0])
    await g.up(ev(4, 96))
    expect(store.getState().history.steps.length).toBe(1)
  })

  test('hovering near a landmark shows the marker on it; away from one (or off the paper) clears it', () => {
    const store = createStudioStore({ committer: inProcessCommitter })
    const marks: (readonly [number, number] | null)[] = []
    const stage: GestureStage = { ...stageFor(), setHoverMarker: p => void marks.push(p) }
    const g = createFoldGesture(stage, store)
    g.hover({ clientX: 97, clientY: 3 }) // near the top-right corner
    expect(marks.at(-1)).toEqual([1, 1])
    g.hover({ clientX: 50, clientY: 50 }) // the middle of a blank square: no landmark within 12px
    expect(marks.at(-1)).toBeNull()
    g.hover({ clientX: 500, clientY: 500 }) // off the paper
    expect(marks.at(-1)).toBeNull()
    g.hover({ clientX: 3, clientY: 97 })
    g.leave()
    expect(marks.at(-1)).toBeNull()
  })

  test('the marker is hidden while a drag is active', () => {
    const store = createStudioStore({ committer: inProcessCommitter })
    const marks: (readonly [number, number] | null)[] = []
    const g = createFoldGesture({ ...stageFor(), setHoverMarker: p => void marks.push(p) }, store)
    g.hover({ clientX: 97, clientY: 3 })
    g.down(ev(97, 3))
    expect(marks.at(-1)).toBeNull()
    g.hover({ clientX: 3, clientY: 97 })
    expect(marks.at(-1)).toBeNull()
  })

  // Button filtering moved to the input router (router.test.ts: right-drag is orbit, not fold).
  test('a press off the paper begins nothing and reports false; a press on it reports true', () => {
    const store = createStudioStore({ committer: inProcessCommitter })
    const g = createFoldGesture(stageFor(), store)
    expect(g.down(ev(500, 500))).toBe(false)
    expect(store.getState().gesture).toBeNull()
    expect(g.down(ev(50, 50))).toBe(true)
    expect(g.down(ev(50, 50))).toBe(false) // duplicate press from the same pointer
    expect(store.getState().gesture).not.toBeNull()
  })

  test('cancel() drops a dragged gesture as Esc would, and the next press starts afresh', () => {
    const store = createStudioStore({ committer: inProcessCommitter })
    const g = createFoldGesture(stageFor(), store)
    g.down(ev(97, 3))
    g.move(ev(50, 50))
    expect(store.getState().preview).not.toBeNull()
    g.cancel()
    expect(store.getState().gesture).toBeNull()
    expect(store.getState().preview).toBeNull()
    g.move(ev(40, 40)) // stale move after cancel is ignored
    expect(store.getState().preview).toBeNull()
    expect(g.down(ev(97, 3))).toBe(true)
  })

  test('a click without drag cancels the gesture and commits nothing', async () => {
    const store = createStudioStore({ committer: inProcessCommitter })
    const g = createFoldGesture(stageFor(), store)
    g.down(ev(50, 50))
    await g.up(ev(50, 50))
    expect(store.getState().gesture).toBeNull()
    expect(store.getState().history.steps.length).toBe(0)
  })
})

describe('real camera, resize mid-drag with snapping (Review Focus 1)', () => {
  const cam = (aspect: number, dist: number) => {
    const c = new THREE.PerspectiveCamera(35, aspect, 0.1, 400)
    c.position.set(0.5, 0.5 - 0.45 * dist, dist)
    c.up.set(0, 1, 0)
    c.lookAt(0.5, 0.5, 0)
    c.updateMatrixWorld(true)
    return c
  }

  test('the next pick maps to the same paper point and the snap radius follows the new scale', () => {
    let camera = cam(800 / 600, 3)
    let rect: RectLike = { left: 0, top: 0, width: 800, height: 600 }
    const stage: GestureStage = {
      canvas: document.createElement('canvas'),
      pick: (x, y) => {
        const p = clientToPlane(camera, rect, x, y)
        return p && { face: 0, paper: p, folded: p }
      },
      projectToPaperPlane: (x, y) => clientToPlane(camera, rect, x, y)!,
      pxPerUnit: () => pxPerUnit(camera, rect, [0.5, 0.5]),
    }
    const store = createStudioStore({ committer: inProcessCommitter })
    const g = createFoldGesture(stage, store)
    const ev = (c: Vec2) => ({ button: 0, pointerId: 1, clientX: c[0], clientY: c[1] })

    const radiusBefore = snapRadiusPaper(SNAP_RADIUS_PX, stage.pxPerUnit())
    const camFar = cam(1200 / 500, 9)
    const rectFar: RectLike = { left: 40, top: 10, width: 1200, height: 500 }
    const radiusAfter = snapRadiusPaper(SNAP_RADIUS_PX, pxPerUnit(camFar, rectFar, [0.5, 0.5]))
    expect(radiusAfter).toBeGreaterThan(radiusBefore * 2)
    // A target offset from the (0,0) corner by a distance inside the new radius only.
    const d = (radiusBefore + radiusAfter) / 2
    const q: Vec2 = [d, 0]

    g.down(ev(planeToClient(camera, rect, [1, 1])))
    expect(store.getState().gesture!.grab).toEqual([1, 1])
    g.move(ev(planeToClient(camera, rect, q)))
    const t1 = store.getState().gesture!.target
    expect(t1[0]).toBeCloseTo(d, 6) // outside the old radius: not snapped
    expect(t1[1]).toBeCloseTo(0, 6)

    camera = camFar // resize / zoom / DPR change mid-drag
    rect = rectFar
    const client = planeToClient(camera, rect, q)
    const picked = stage.pick(client[0], client[1])!
    expect(picked.folded[0]).toBeCloseTo(q[0], 6)
    expect(picked.folded[1]).toBeCloseTo(q[1], 6)
    g.move(ev(client))
    expect(store.getState().gesture!.grab).toEqual([1, 1])
    expect(store.getState().gesture!.target).toEqual([0, 0]) // inside the new radius: snapped
  })
})

describe('folded model: the grab is the folded point, not the paper point', () => {
  test('grab = snap(folded) against landmarks of current(history); face passed through', async () => {
    const store = createStudioStore({ committer: inProcessCommitter })
    store.getState().begin([1, 1])
    store.getState().drag([0, 0], 1)
    expect(await store.getState().release()).toBe(true)
    expect(current(store.getState().history)).toBeDefined()
    // The flap's paper point (0.995, 0.995) lies at folded (0.005, 0.005), next to the (0,0) corner.
    const stage: GestureStage = {
      canvas: document.createElement('canvas'),
      pick: () => ({ face: 3, paper: [0.995, 0.995], folded: [0.005, 0.005] }),
      projectToPaperPlane: () => [0.5, 0.5],
      pxPerUnit: () => 100,
    }
    const g = createFoldGesture(stage, store)
    g.down({ button: 0, pointerId: 1, clientX: 0, clientY: 0 })
    const gs = store.getState().gesture!
    expect(gs.grab).toEqual([0, 0])
    expect(gs.face).toBe(3)
  })
})

describe('lost pointer capture', () => {
  const stage = (): GestureStage => ({
    canvas: document.createElement('canvas'),
    pick: () => ({ face: 0, paper: [0.5, 0.5], folded: [0.5, 0.5] }),
    projectToPaperPlane: () => [0.2, 0.2],
    pxPerUnit: () => 100,
  })
  const ev = (id: number) => ({ button: 0, pointerId: id, clientX: 0, clientY: 0 })

  test('lost() cancels the gesture and the canvas responds again', () => {
    const store = createStudioStore({ committer: inProcessCommitter })
    const g = createFoldGesture(stage(), store)
    g.down(ev(1))
    g.move(ev(1))
    expect(store.getState().preview).not.toBeNull()
    g.lost({ pointerId: 1 })
    expect(store.getState().gesture).toBeNull()
    expect(store.getState().preview).toBeNull()
    g.down(ev(1))
    expect(store.getState().gesture).not.toBeNull()
  })

  test('a press from a different pointer resets a stale gesture', () => {
    const store = createStudioStore({ committer: inProcessCommitter })
    const g = createFoldGesture(stage(), store)
    g.down(ev(1))
    g.move(ev(1))
    g.down(ev(2))
    expect(store.getState().gesture).not.toBeNull()
    expect(store.getState().preview).toBeNull() // fresh gesture, not dragged yet
    g.move(ev(2))
    expect(store.getState().preview).not.toBeNull()
  })
})

describe('swing on an existing crease (spec 09)', () => {
  // Identity projection at 100 px per paper unit (y up): client (x, y) is paper (x / 100, 1 − y / 100).
  const at = (p: Vec2) => ({ button: 0, pointerId: 1, clientX: p[0] * 100, clientY: (1 - p[1]) * 100 })
  const setup = (frame: Frame, extra: Partial<GestureStage> = {}, opts: GestureOptions = {}) => {
    const store = createStudioStore({ committer: inProcessCommitter })
    store.getState().restoreHistory(startHistory(frame))
    const toPaper = (x: number, y: number): Vec2 => [x / 100, 1 - y / 100]
    const stage: GestureStage = {
      canvas: document.createElement('canvas'),
      pick: (x, y) => {
        const p = toPaper(x, y)
        const face = layerAt(current(store.getState().history), p)[0]
        return face === undefined ? null : { face, paper: p, folded: p }
      },
      projectToPaperPlane: toPaper,
      pxPerUnit: () => 100,
      ...extra,
    }
    return { store, g: createFoldGesture(stage, store, opts) }
  }
  /** Fold angles of the edges lying on x = 0.5 (crease-pattern coordinates). */
  const anglesOnHalf = (f: Frame) =>
    f.edges_vertices.flatMap(([u, v], e) => {
      const [a, b] = [f.vertices_coords[u]!, f.vertices_coords[v]!]
      return Math.abs(a[0] - 0.5) < 1e-6 && Math.abs(b[0] - 0.5) < 1e-6 ? [{ a: f.edges_foldAngle[e]!, as: f.edges_assignment[e]! }] : []
    })

  test('pulling the flap back opens it', async () => {
    const { store, g } = setup(halfFolded())
    expect(g.down(at([0.1, 0.5]))).toBe(true)
    g.move(at([0.9, 0.5]))
    expect(store.getState().reading).toBe('swing')
    await g.up(at([0.9, 0.5]))
    const f = current(store.getState().history)
    expect(store.getState().history.steps.length).toBe(1)
    expect(f.edges_foldAngle.every(a => Math.abs(a) < 1e-6)).toBe(true)
    const half = anglesOnHalf(f)
    expect(half.length).toBeGreaterThan(0)
    expect(half.every(h => h.as === 'F')).toBe(true)
  })

  test('release near open settles open', async () => {
    const { store, g } = setup(halfFolded())
    g.down(at([0.1, 0.5]))
    // The grab snaps onto the left edge, [0, 0.5]: the hinge is 0.5 away, its mirror 1.
    // progressToAngle(p) = 172 at p = 1 − sqrt(8 / 180), about 0.79 (cursor x ≈ 0.79).
    const grab = store.getState().gesture!.grab
    const p = 1 - Math.sqrt(8 / 180)
    expect(progressToAngle(p)).toBeCloseTo(172)
    const cursor: Vec2 = [grab[0] + 2 * (0.5 - grab[0]) * p, 0.5]
    g.move(at(cursor))
    expect(store.getState().gesture!.progress).toBeCloseTo(p)
    await g.up(at(cursor))
    const f = current(store.getState().history)
    expect(f.edges_foldAngle.every(a => Math.abs(a) < 1e-6)).toBe(true)
  })

  test('forceNew makes a new fold', async () => {
    const before = halfFolded()
    const { store, g } = setup(before)
    g.setForceNew(true)
    g.down(at([0.1, 0.5]))
    g.move(at([0.3, 0.5])) // straight toward the hinge: a swing without the modifier
    expect(store.getState().reading).toBe('new')
    await g.up(at([0.3, 0.5]))
    const f = current(store.getState().history)
    expect(store.getState().history.steps.length).toBe(1)
    expect(f.edges_vertices.length).toBeGreaterThan(before.edges_vertices.length)
    const half = anglesOnHalf(f)
    expect(half.length).toBeGreaterThan(0)
    expect(half.every(h => Math.abs(Math.abs(h.a) - 180) < 1e-6)).toBe(true)
  })

  test('crease snap: a bisector at x = 0.51 locks onto the open crease at x = 0.5', async () => {
    const before = openedHalf()
    const onLine = (f: Frame, x: number) => f.vertices_coords.filter(v => Math.abs(v[0] - x) < 1e-6).length
    const { store, g } = setup(before)
    g.down(at([0.25, 0.5]))
    g.move(at([0.77, 0.5])) // bisector x = 0.51
    expect(store.getState().reading).toBe('new')
    expect(store.getState().gesture!.crease!.origin[0]).toBeCloseTo(0.5)
    await g.up(at([0.77, 0.5]))
    const f = current(store.getState().history)
    expect(store.getState().history.steps.length).toBe(1)
    expect(onLine(f, 0.5)).toBe(onLine(before, 0.5))
    expect(onLine(f, 0.51)).toBe(0)
    expect(anglesOnHalf(f).every(h => Math.abs(Math.abs(h.a) - 180) < 1e-6)).toBe(true)
  })

  test('hover highlights hinge, at most once per frame', () => {
    const calls: { faces: readonly number[] | null; hinges: readonly (readonly [Vec2, Vec2])[] }[] = []
    let queued: (() => void)[] = []
    const flush = () => {
      const q = queued
      queued = []
      q.forEach(cb => cb())
    }
    const { g } = setup(halfFolded(), { setHoverFlap: (faces, hinges) => void calls.push({ faces, hinges }) }, {
      raf: cb => void queued.push(cb),
    })
    g.hover(at([0.1, 0.5]))
    g.hover(at([0.12, 0.5]))
    flush()
    expect(calls.length).toBe(1)
    expect(calls[0]!.faces!.length).toBeGreaterThan(0)
    expect(calls[0]!.hinges.length).toBeGreaterThan(0)
    g.leave()
    expect(calls.at(-1)!.faces).toBeNull()
  })

  test('a press clears the hover flap', () => {
    const calls: (readonly number[] | null)[] = []
    const { g } = setup(halfFolded(), { setHoverFlap: faces => void calls.push(faces) }, { raf: cb => cb() })
    g.hover(at([0.1, 0.5]))
    expect(calls.at(-1)).not.toBeNull()
    g.down(at([0.1, 0.5]))
    expect(calls.at(-1)).toBeNull()
  })

  test('other tools never swing', () => {
    const { store, g } = setup(halfFolded())
    store.getState().setTool('reverse')
    g.down(at([0.1, 0.5]))
    g.move(at([0.9, 0.5]))
    expect(store.getState().reading).toBeNull()
  })
})

describe('layer belt: press and hold (spec 09)', () => {
  // Identity projection at 100 px per paper unit (y up), as in the swing tests.
  const at = (p: Vec2) => ({ button: 0, pointerId: 1, clientX: p[0] * 100, clientY: (1 - p[1]) * 100 })
  const press = at([0.25, 0.5]) // client (25, 50): the two-layer stack of halfFolded(), away from any landmark
  const by = (dx: number, dy: number) => ({ ...press, clientX: press.clientX + dx, clientY: press.clientY + dy })
  const setup = () => {
    const store = createStudioStore({ committer: inProcessCommitter })
    store.getState().restoreHistory(startHistory(halfFolded()))
    const toPaper = (x: number, y: number): Vec2 => [x / 100, 1 - y / 100]
    const stage: GestureStage = {
      canvas: document.createElement('canvas'),
      pick: (x, y) => {
        const p = toPaper(x, y)
        const face = layerAt(current(store.getState().history), p)[0]
        return face === undefined ? null : { face, paper: p, folded: p }
      },
      projectToPaperPlane: toPaper,
      pxPerUnit: () => 100,
    }
    const said: string[] = []
    return { store, said, g: createFoldGesture(stage, store, { announce: t => void said.push(t) }) }
  }
  beforeEach(() => {
    vi.useFakeTimers()
    useUi.getState().closeBelt()
  })
  afterEach(() => {
    vi.useRealTimers()
    useUi.getState().closeBelt()
  })

  test('hold opens the belt', () => {
    const { g } = setup()
    g.down(press)
    vi.advanceTimersByTime(399)
    expect(useUi.getState().belt).toBeNull()
    vi.advanceTimersByTime(1)
    const belt = useUi.getState().belt!
    expect(belt).not.toBeNull()
    expect(belt.stack.faces.length).toBe(2)
    expect([belt.clientX, belt.clientY]).toEqual([press.clientX, press.clientY])
    expect(belt.hovered).toBeNull()
    expect(belt.keyboard).toBe(false)
  })

  test('the belt announces the top flap on open and each new row under the pointer', () => {
    const { g, said } = setup()
    g.down(press)
    vi.advanceTimersByTime(400)
    expect(said).toEqual(['Layer 1 of 2: top flap'])
    g.move(by(0, rowPx(2) / 2))
    g.move(by(1, rowPx(2) / 2)) // same row: no repeat
    expect(said).toEqual(['Layer 1 of 2: top flap', 'Layer 2 of 2: top flap and 1 below'])
  })

  test('drift under slop still opens (Review Focus 2)', () => {
    const { g } = setup()
    g.down(press)
    vi.advanceTimersByTime(150)
    g.move(by(2, 1))
    vi.advanceTimersByTime(150)
    g.move(by(3, -2))
    vi.advanceTimersByTime(100)
    expect(useUi.getState().belt).not.toBeNull()
  })

  test('moving 5px first never opens (Review Focus 2)', async () => {
    const { store, g } = setup()
    g.down(press)
    g.move(by(5, 0))
    g.move(by(0, 0)) // coming back does not re-arm the hold
    vi.advanceTimersByTime(1000)
    expect(useUi.getState().belt).toBeNull()
    expect(store.getState().gesture!.layers).toBe(1) // the fold proceeds with the top layer
    g.move(at([0.4, 0.5]))
    expect(store.getState().preview).not.toBeNull()
  })

  test('drag out takes the hovered layer and those above', () => {
    const { store, g } = setup()
    g.down(press)
    vi.advanceTimersByTime(400)
    g.move(by(0, rowPx(2) / 2)) // row 1: the second layer
    expect(useUi.getState().belt!.hovered).toBe(1)
    expect(store.getState().preview).toBeNull() // inside the belt nothing folds
    const out = by(BELT_RADIUS_PX + 10, rowPx(2) / 2)
    g.move(out)
    expect(useUi.getState().belt).toBeNull()
    expect(store.getState().gesture!.layers).toBe(2)
    expect(store.getState().gesture!.target).toEqual([out.clientX / 100, 1 - out.clientY / 100]) // the same move drags
    g.move(at([0.4, 0.5])) // back over the press point: the belt stays closed, the two layers fold
    expect(useUi.getState().belt).toBeNull()
    expect(store.getState().gesture!.layers).toBe(2)
    expect(store.getState().preview).not.toBeNull()
  })

  test('release inside the belt does nothing (Review Focus 3)', async () => {
    const { store, g } = setup()
    const before = store.getState().history.steps.length
    g.down(press)
    vi.advanceTimersByTime(400)
    g.move(by(0, rowPx(2) / 2))
    await g.up(by(0, rowPx(2) / 2))
    expect(useUi.getState().belt).toBeNull()
    expect(store.getState().history.steps.length).toBe(before)
    expect(store.getState().gesture).toBeNull()
  })

  test('cancel closes the belt; a quick release clears the hold timer', async () => {
    const { store, g } = setup()
    g.down(press)
    vi.advanceTimersByTime(400)
    g.cancel()
    expect(useUi.getState().belt).toBeNull()
    expect(store.getState().gesture).toBeNull()
    g.down(press)
    await g.up(press)
    vi.advanceTimersByTime(1000)
    expect(useUi.getState().belt).toBeNull()
  })

  test('only the Fold tool holds for the belt', () => {
    const { store, g } = setup()
    store.getState().setTool('reverse')
    g.down(press)
    vi.advanceTimersByTime(1000)
    expect(useUi.getState().belt).toBeNull()
  })
})
