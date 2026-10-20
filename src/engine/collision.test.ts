import { describe, expect, test } from 'vitest'
import { sweep } from './collision'
import { applyPose, poses } from './poses'
import { layerAt } from './layers'
import { foldThrough, layerOrders, makeSheet } from './rabbit'
import { accordion, halfFolded } from './testkit'
import type { Frame, Line, Vec2 } from './types'

const vertical = (x: number): Line => ({ origin: [x, 0], vector: [0, 1] })
const sheet = () => makeSheet({ width: 1, height: 1 })

function faceAt(frame: Frame, p: Vec2): number {
  return frame.faces_vertices.findIndex(vs => {
    const pts = vs.map(v => frame.vertices_coords[v])
    let sign = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
      if (Math.abs(c) < 1e-12) return false
      if (sign === 0) sign = Math.sign(c)
      else if (Math.sign(c) !== sign) return false
    }
    return true
  })
}

/** Right half valley-folded up to a vertical wall at x = 0.5. */
const wall = () => foldThrough(sheet(), vertical(0.5), [0], 'valley', 90)!

describe('sweep', () => {
  test('no obstruction: the top layer of a half fold swings back open', () => {
    // face 1 lies over x ∈ [0, 0.5], left of the axis: positive lifts it (+z), away from face 0
    expect(sweep(halfFolded(), { faces: [1], axis: vertical(0.5) }, 0, 180)).toEqual({ freeDeg: 180, blocked: false })
  })

  test('no obstruction: the bottom layer swings down, away from the top one', () => {
    expect(sweep(halfFolded(), { faces: [0], axis: vertical(0.5) }, 0, -180)).toEqual({ freeDeg: -180, blocked: false })
  })

  test('no obstruction: a flat sheet with nothing else', () => {
    expect(sweep(sheet(), { faces: [0], axis: vertical(0.5) }, 0, 90)).toEqual({ freeDeg: 90, blocked: false })
  })

  test('the lower layer swung up through the stacked upper one is blocked at once', () => {
    const r = sweep(halfFolded(), { faces: [0], axis: vertical(0.5) }, 0, 180)
    expect(r.blocked).toBe(true)
    expect(r.freeDeg).toBeLessThan(180)
    expect(r.freeDeg).toBe(0)
  })

  test('the upper layer swung down through the lower one is blocked at once', () => {
    const r = sweep(halfFolded(), { faces: [1], axis: vertical(0.5) }, 0, -90)
    expect(r).toEqual({ freeDeg: 0, blocked: true })
  })

  test('a 90° wall folded on past flat is stopped exactly where it lands', () => {
    const f = wall()
    const w = faceAt(f, [0.75, 0.5])
    // the wall stands at 90°; continuing the valley (negative about +y) lands it on face 0 at −90
    expect(sweep(f, { faces: [w], axis: vertical(0.5) }, 0, -90)).toEqual({ freeDeg: -90, blocked: false })
    const r = sweep(f, { faces: [w], axis: vertical(0.5) }, 0, -150)
    expect(r.blocked).toBe(true)
    expect(Math.abs(r.freeDeg - -90)).toBeLessThan(1e-6)
    // opening it back out the other way is free
    expect(sweep(f, { faces: [w], axis: vertical(0.5) }, 0, 90)).toEqual({ freeDeg: 90, blocked: false })
  })

  test('from === to is free', () => {
    expect(sweep(halfFolded(), { faces: [0], axis: vertical(0.5) }, 30, 30)).toEqual({ freeDeg: 30, blocked: false })
  })

  describe('3D (sampled, Möller) case: a raised shelf swung down onto the flat half', () => {
    // Left half up 90° at x = 0.5, then its outer strip (x < 0.1) valley 90° again. The second fold
    // re-roots: face 0 is now the flat right half (x ∈ [0.5, 1], z = 0), the rest of the left half
    // is a wall at x = 0.5 (z ∈ [0, 0.4]) and the strip a shelf at z = 0.4 over x ∈ [0.5, 0.6].
    const shelfFrame = () => {
      const a = wall()
      return foldThrough(a, vertical(0.1), [faceAt(a, [0.3, 0.5])], 'valley', 90)!
    }
    const shelfOf = (f: Frame) => faceAt(f, [0.05, 0.5])
    const axis = vertical(0.5)

    test('fixture: the shelf is horizontal at z = 0.4 over x ∈ [0.5, 0.6]', () => {
      const f = shelfFrame()
      const m = poses(f)[shelfOf(f)].matrix
      const corner = applyPose(m, [0, 0])
      ;[0.6, 0, 0.4].forEach((c, i) => expect(Math.abs(corner[i] - c)).toBeLessThan(1e-9))
      expect(Math.abs(applyPose(m, [0.1, 1])[2] - 0.4)).toBeLessThan(1e-9)
    })

    test('the shelf (not coplanar with the axis) is stopped where its far edge meets the flat half', () => {
      const f = shelfFrame()
      const r = sweep(f, { faces: [shelfOf(f)], axis }, 0, 180)
      expect(r.blocked).toBe(true)
      // far edge at r = √(0.1² + 0.4²), θ = atan2(0.4, −0.1): it reaches the z = 0 half-plane at 180° − θ
      const expected = 180 - (Math.atan2(0.4, -0.1) * 180) / Math.PI
      expect(Math.abs(r.freeDeg - expected)).toBeLessThan(1e-3)
      expect(sweep(f, { faces: [shelfOf(f)], axis }, 0, r.freeDeg - 0.5).blocked).toBe(false)
      expect(sweep(f, { faces: [shelfOf(f)], axis }, 0, r.freeDeg + 1).blocked).toBe(true)
    })

    test('swinging it the other way, over the wall top and out past the paper, is free', () => {
      const f = shelfFrame()
      expect(sweep(f, { faces: [shelfOf(f)], axis }, 0, -180)).toEqual({ freeDeg: -180, blocked: false })
    })
  })

  describe('caching across drag frames', () => {
    const shelf = () => {
      const a = wall()
      return foldThrough(a, vertical(0.1), [faceAt(a, [0.3, 0.5])], 'valley', 90)!
    }
    const cases: [string, () => Frame, (f: Frame) => number[], Line][] = [
      ['half fold, lower layer', halfFolded, () => [0], vertical(0.5)],
      ['half fold, upper layer', halfFolded, () => [1], vertical(0.5)],
      ['wall', wall, f => [faceAt(f, [0.75, 0.5])], vertical(0.5)],
      ['shelf (sampled)', shelf, f => [faceAt(f, [0.05, 0.5])], vertical(0.5)],
    ]
    test.each(cases)('a drag (many toDeg on one frame) matches fresh, uncached sweeps: %s', (_, make, facesOf, axis) => {
      const f = make()
      const faces = facesOf(f)
      for (const to of [30, 90, -45, 180, -150, 75.9, 76.1, -180, 120, 0.5])
        expect(sweep(f, { faces, axis }, 0, to)).toEqual(sweep(structuredClone(f), { faces, axis }, 0, to))
    })
  })

  describe('performance on a fully stacked model', () => {
    test('fixture: the accordion stack agrees with the layer solver', () => {
      const f = accordion(8)
      const solved = { ...f, faceOrders: layerOrders(f)! }
      expect(layerAt(f, [0.06, 0.5])).toEqual([7, 6, 5, 4, 3, 2, 1, 0])
      expect(layerAt(solved, [0.06, 0.5])).toEqual(layerAt(f, [0.06, 0.5]))
    })

    test('256 faces: correct verdicts, and a warm drag sweep is well under a 16 ms frame', () => {
      const n = 256
      const f = accordion(n)
      // the top half (faces 128…255, above the rest) swings about the crease at folded x = 0
      const faces = f.faces_vertices.map((_, k) => k).filter(k => k >= n / 2)
      const axis = vertical(0)
      // it lies right of the axis: positive drives it down into the lower half, negative lifts it off
      expect(sweep(f, { faces, axis }, 0, 180)).toEqual({ freeDeg: 0, blocked: true })
      expect(sweep(f, { faces, axis }, 0, -180)).toEqual({ freeDeg: -180, blocked: false })
      for (const sign of [1, -1]) {
        const times: number[] = []
        for (let k = 1; k <= 9; k++) {
          const t = performance.now()
          sweep(f, { faces, axis }, 0, sign * 20 * k)
          times.push(performance.now() - t)
        }
        times.sort((a, b) => a - b)
        expect(times[4]).toBeLessThan(8)
      }
    })
  })
})
