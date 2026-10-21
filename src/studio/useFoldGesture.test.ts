// @vitest-environment jsdom
import * as THREE from 'three'
import { describe, expect, test } from 'vitest'
import type { Vec2 } from '@engine'
import { clientToPlane, planeToClient, pxPerUnit, snapRadiusPaper, type RectLike } from '../render/pickMath'
import { inProcessCommitter } from './committer'
import { createStudioStore } from './store'
import { createFoldGesture, dragProgress, SNAP_RADIUS_PX, type GestureStage } from './useFoldGesture'

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

  test('ignores non-left buttons and presses off the paper', () => {
    const store = createStudioStore({ committer: inProcessCommitter })
    const g = createFoldGesture(stageFor(), store)
    g.down(ev(50, 50, 2))
    g.down(ev(500, 500))
    expect(store.getState().gesture).toBeNull()
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
