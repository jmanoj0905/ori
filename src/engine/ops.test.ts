import { describe, expect, test } from 'vitest'
import { commit, preview, type Gesture } from './ops'
import { sweep } from './collision'
import { layerAt } from './layers'
import { applyPose, poses } from './poses'
import { foldThrough, foldedCoords, layerOrders, makeSheet, windings } from './rabbit'
import { area, footprintWidth, halfFolded } from './testkit'
import type { Frame, Line, Vec2 } from './types'

const sheet = () => makeSheet({ width: 1, height: 1 })
const vertical = (x: number): Line => ({ origin: [x, 0], vector: [0, 1] })
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps
const near = (p: readonly number[], q: readonly number[], eps = 1e-9) => p.every((x, i) => close(x, q[i], eps))

const fold = (over: Partial<Gesture> & Pick<Gesture, 'grab' | 'target'>): Gesture => ({
  tool: 'fold',
  layers: 1,
  kind: 'valley',
  progress: 1,
  snapAngle: false,
  ...over,
})

function ok<T>(r: { ok: true } & T | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r
}

/** The face whose crease-pattern polygon strictly contains `p`. */
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

/** World (3D) position of the paper point `p`, carried by the face containing it. */
function worldOf(frame: Frame, p: Vec2, ps = poses(frame)) {
  const f = faceAt(frame, p)
  if (f < 0) throw new Error(`no face at ${p}`)
  return applyPose(ps[f].matrix, p)
}

const vertexAt = (frame: Frame, p: Vec2) =>
  frame.vertices_coords.findIndex(q => close(q[0], p[0]) && close(q[1], p[1]))

describe('preview', () => {
  test('corner [1,1] onto [0,0]: anti-diagonal crease, one moving face, 180° at progress 1', () => {
    const { preview: pv } = ok(preview(sheet(), fold({ grab: [1, 1], target: [0, 0] })))
    expect(pv.crease).toHaveLength(1)
    const [a, b] = pv.crease[0]
    const ends = [a, b].sort((p, q) => p[0] - q[0])
    expect(near(ends[0], [0, 1])).toBe(true)
    expect(near(ends[1], [1, 0])).toBe(true)
    expect(pv.moving).toHaveLength(1)
    expect(pv.angleDeg).toBe(180)
    expect(pv.layers).toBe(1)
    expect(pv.blocked).toBe(false)
    // the moving face is the half holding the grabbed corner, and at 180° it lands on the target
    const ps = pv.poses
    expect(ps).toHaveLength(pv.frame.faces_vertices.length)
    const corner = vertexAt(pv.frame, [1, 1])
    const mover = pv.moving[0]
    expect(pv.frame.faces_vertices[mover]).toContain(corner)
    expect(near(applyPose(ps[mover].matrix, [1, 1]), [0, 0, 0])).toBe(true)
  })

  test('the stationary side stays put in the preview poses', () => {
    const { preview: pv } = ok(preview(sheet(), fold({ grab: [0, 0], target: [1, 1], progress: 0.5 })))
    const still = pv.frame.faces_vertices.findIndex((vs, f) => !pv.moving.includes(f) && vs.includes(vertexAt(pv.frame, [1, 1])))
    expect(still).toBeGreaterThanOrEqual(0)
    expect(near(applyPose(pv.poses[still].matrix, [1, 1]), [1, 1, 0])).toBe(true)
  })

  test('a valley lifts the flap toward +z, a mountain drops it toward −z', () => {
    for (const [kind, sign] of [['valley', 1], ['mountain', -1]] as const) {
      const { preview: pv } = ok(preview(sheet(), fold({ grab: [1, 1], target: [0, 0], kind, progress: 0.4 })))
      const mover = pv.moving[0]
      const z = applyPose(pv.poses[mover].matrix, [1, 1])[2]
      expect(Math.sign(z)).toBe(sign)
      expect(Math.abs(z)).toBeGreaterThan(0.1)
    }
  })

  test('the edited frame keeps the world: a standing wall stays standing in the preview', () => {
    const wall = foldThrough(sheet(), vertical(0.5), [0], 'valley', 90)!
    const before = worldOf(wall, [0.75, 0.5])
    expect(near(before, [0.5, 0.5, 0.25])).toBe(true)
    const { preview: pv } = ok(preview(wall, fold({ grab: [0.1, 0.5], target: [0.5, 0.5], progress: 0 })))
    expect(near(worldOf(pv.frame, [0.75, 0.5], pv.poses), before)).toBe(true)
    expect(near(worldOf(pv.frame, [0.1, 0.5], pv.poses), [0.1, 0.5, 0])).toBe(true)
  })

  test('progress-only moves reuse the edited frame', () => {
    const f = sheet()
    const a = ok(preview(f, fold({ grab: [1, 1], target: [0, 0], progress: 0.2 }))).preview
    const b = ok(preview(f, fold({ grab: [1, 1], target: [0, 0], progress: 0.7 }))).preview
    expect(b.frame).toBe(a.frame)
    expect(b.angleDeg).toBeGreaterThan(a.angleDeg)
  })

  test('the angle follows progressToAngle', () => {
    const { preview: pv } = ok(preview(sheet(), fold({ grab: [1, 1], target: [0, 0], progress: 0.5 })))
    expect(pv.angleDeg).toBeCloseTo(135, 9)
  })

  test('a crease off the paper is refused', () => {
    const miss = { ok: false, reason: 'That crease misses the paper.' }
    // grab off the paper
    expect(preview(sheet(), fold({ grab: [2, 2], target: [3, 3] }))).toEqual(miss)
    // crease beyond the paper: everything is on the grab side, nothing stays put
    expect(preview(sheet(), fold({ grab: [0.9, 0.5], target: [3, 0.5] }))).toEqual(miss)
    // crease along the paper's own edge moves all of it
    expect(preview(sheet(), fold({ grab: [0.9, 0.5], target: [1.1, 0.5] }))).toEqual(miss)
    expect(commit(sheet(), fold({ grab: [0.9, 0.5], target: [3, 0.5] }))).toEqual(miss)
  })

  test('a zero-length drag is refused quietly (Review Focus 2)', () => {
    const r = { ok: false, reason: 'Drag further to fold.' }
    expect(preview(sheet(), fold({ grab: [0.5, 0.5], target: [0.5, 0.5] }))).toEqual(r)
    expect(preview(sheet(), fold({ grab: [0.5, 0.5], target: [0.5 + 1e-6, 0.5] }))).toEqual(r)
    expect(commit(sheet(), fold({ grab: [0.5, 0.5], target: [0.5, 0.5] }))).toEqual(r)
  })

  test('k larger than the stack is clamped and reported (Review Focus 3)', () => {
    const { preview: pv } = ok(preview(halfFolded(), fold({ grab: [0.25, 0.5], target: [0.1, 0.5], layers: 9 })))
    expect(pv.layers).toBe(2)
  })

  test('a flap swung down through the layer beneath is blocked at once', () => {
    // top layer only, mountain: it would have to pass through the bottom layer
    const g = fold({ grab: [0.1, 0.5], target: [0.4, 0.5], kind: 'mountain' })
    const { preview: pv } = ok(preview(halfFolded(), g))
    expect(pv.blocked).toBe(true)
    expect(pv.angleDeg).toBe(0)
  })

  test('a blocked sweep clamps the angle to freeDeg', () => {
    // right half stands as a 90° wall at x = 0.5; a 0.3-wide strip at the left swung over hits it
    const wall = foldThrough(sheet(), vertical(0.5), [0], 'valley', 90)!
    const g = fold({ grab: [0.1, 0.5], target: [0.5, 0.5] })
    const { preview: pv } = ok(preview(wall, g))
    expect(pv.blocked).toBe(true)
    const axis: Line = { origin: [0.3, 0.5], vector: [0, 1] } // the strip is on its left
    const { freeDeg, blocked } = sweep(pv.frame, { faces: pv.moving, axis }, 0, 180)
    expect(blocked).toBe(true)
    expect(pv.angleDeg).toBeCloseTo(freeDeg, 6)
    expect(pv.angleDeg).toBeCloseTo((Math.acos(-2 / 3) * 180) / Math.PI, 3)
    expect(pv.angleDeg).toBeLessThan(180)
  })

  test('snapAngle snaps the crease direction to 22.5° steps about the drag midpoint', () => {
    const g = fold({ grab: [1, 1], target: [0.03, 0], snapAngle: true })
    const { preview: pv } = ok(preview(sheet(), g))
    const [a, b] = pv.crease[0]
    const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
    const steps = deg / 22.5
    expect(close(steps, Math.round(steps), 1e-9)).toBe(true)
    // the snapped crease passes through the midpoint of the drag
    const mid: Vec2 = [0.515, 0.5]
    const cr = (b[0] - a[0]) * (mid[1] - a[1]) - (b[1] - a[1]) * (mid[0] - a[0])
    expect(close(cr, 0, 1e-9)).toBe(true)
  })

  test('compound tools route to compound.ts: a single sheet cannot be squashed', () => {
    const r = preview(sheet(), fold({ grab: [1, 1], target: [0, 0], tool: 'squash' }))
    expect(r).toEqual({ ok: false, reason: "This flap can't squash-fold: it isn't folded in half." })
  })
})

describe('commit', () => {
  test('area is conserved and every frame carries a valid faceOrders', () => {
    let f = sheet()
    const gestures: Gesture[] = [
      fold({ grab: [1, 0.5], target: [0, 0.5] }), // book fold
      fold({ grab: [0.25, 1], target: [0.25, 0], layers: 2 }), // in half again
      fold({ grab: [0.1, 0.1], target: [0.3, 0.3], layers: 1 }), // a corner, top layer
      fold({ grab: [0.475, 0.475], target: [0.375, 0.375], layers: 4, progress: 0.5 }), // a partial fold
    ]
    for (const g of gestures) {
      const r = ok(commit(f, g))
      f = r.frame
      expect(area(f)).toBeCloseTo(1, 9)
      expect(Array.isArray(f.faceOrders)).toBe(true)
    }
    // the last one is partial: it keeps a partial angle (R2)
    expect(f.edges_foldAngle.some(a => Math.abs(a) > 1e-6 && Math.abs(Math.abs(a) - 180) > 1e-6)).toBe(true)
  })

  test('flat commits have a solved layer order', () => {
    const { frame } = ok(commit(halfFolded(), fold({ grab: [0.25, 1], target: [0.25, 0], layers: 2 })))
    expect(layerOrders(frame)).not.toBeNull()
    expect(frame.faceOrders.length).toBeGreaterThan(0)
    expect(layerAt(frame, [0.25, 0.25])).toHaveLength(4)
  })

  test('a point-to-point fold lands the grabbed point exactly on its target', () => {
    const { frame } = ok(commit(sheet(), fold({ grab: [1, 0], target: [0.2, 0.7] })))
    const c = foldedCoords(frame)[vertexAt(frame, [1, 0])]
    expect(near(c, [0.2, 0.7])).toBe(true)
  })

  test('collision does not veto a flat commit: the layer order is the authority', () => {
    // the preview of this mountain is blocked at 0°, but tucking the flap under itself is a valid flat state
    const g = fold({ grab: [0.1, 0.5], target: [0.4, 0.5], kind: 'mountain' })
    const { frame } = ok(commit(halfFolded(), g))
    expect(layerOrders(frame)).not.toBeNull()
    expect(layerAt(frame, [0.3, 0.5])).toHaveLength(3)
  })

  test('a partial commit is clamped where the preview was blocked', () => {
    const wall = foldThrough(sheet(), vertical(0.5), [0], 'valley', 90)!
    const { frame, step } = ok(commit(wall, fold({ grab: [0.1, 0.5], target: [0.5, 0.5], progress: 0.9 })))
    const blockedAt = (Math.acos(-2 / 3) * 180) / Math.PI
    expect(frame.edges_foldAngle.some(a => close(Math.abs(a), blockedAt, 1e-3))).toBe(true)
    expect(step.label).toBe(`Valley fold · top flap · ${Math.round(blockedAt)}°`)
  })

  test('a flat fold on a model with a partial fold keeps the partial angle and the carried orders', () => {
    const wall = foldThrough(sheet(), vertical(0.5), [0], 'valley', 90)!
    const { frame } = ok(commit(wall, fold({ grab: [0.05, 0.5], target: [0.15, 0.5] })))
    expect(frame.edges_foldAngle.filter(a => close(Math.abs(a), 90, 1e-9))).toHaveLength(1)
    expect(frame.edges_foldAngle.filter(a => close(Math.abs(a), 180, 1e-9))).toHaveLength(1)
    expect(Array.isArray(frame.faceOrders)).toBe(true)
    // the wall still stands where it stood
    expect(near(worldOf(frame, [0.75, 0.5]), [0.5, 0.5, 0.25])).toBe(true)
  })

  test('a partial commit blocked at 0° is refused', () => {
    const g = fold({ grab: [0.1, 0.5], target: [0.4, 0.5], kind: 'mountain', progress: 0.5 })
    const r = commit(halfFolded(), g)
    expect(r.ok).toBe(false)
  })

  test('a partial commit keeps the partial angle and skips the layer solve (R2)', () => {
    const before = halfFolded()
    const { frame } = ok(commit(before, fold({ grab: [0.1, 0.5], target: [0.4, 0.5], progress: 1 - Math.SQRT1_2 })))
    const partial = frame.edges_foldAngle.filter(a => close(Math.abs(a), 90, 1e-6))
    expect(partial).toHaveLength(1)
    expect(frame.faceOrders).toBeDefined()
  })

  test('labels', () => {
    const a = ok(commit(sheet(), fold({ grab: [1, 1], target: [0, 0] })))
    expect(a.step.label).toBe('Valley fold · top flap · 180°')
    expect(a.step.kind).toBe('fold')
    const b = ok(
      commit(halfFolded(), fold({ grab: [0.1, 0.5], target: [0.3, 0.5], layers: 2, kind: 'mountain', progress: 1 - Math.SQRT1_2 })),
    )
    expect(b.step.label).toBe('Mountain fold · 2 layers · 90°')
    expect(typeof b.step.at).toBe('number')
  })

  test('the label reports the clamped k', () => {
    const r = ok(commit(halfFolded(), fold({ grab: [0.25, 0.5], target: [0.1, 0.5], layers: 9 })))
    expect(r.step.label).toBe('Valley fold · 2 layers · 180°')
  })

  describe('the world stays put: only the flap moves (R10)', () => {
    test('corner [0,0] onto [1,1], where face 0 holds the grabbed corner', () => {
      const { frame } = ok(commit(sheet(), fold({ grab: [0, 0], target: [1, 1] })))
      const c = foldedCoords(frame)
      expect(near(c[vertexAt(frame, [1, 1])], [1, 1])).toBe(true)
      expect(near(c[vertexAt(frame, [1, 0])], [1, 0])).toBe(true)
      expect(near(c[vertexAt(frame, [0, 1])], [0, 1])).toBe(true)
      expect(near(c[vertexAt(frame, [0, 0])], [1, 1])).toBe(true) // lands on the target
      // valley: the flap is on top
      const top = layerAt(frame, [0.8, 0.8])[0]
      expect(frame.faces_vertices[top]).toContain(vertexAt(frame, [0, 0]))
    })

    test('the same corner fold at a partial angle: the stationary half is unmoved in 3D', () => {
      const { frame } = ok(commit(sheet(), fold({ grab: [0, 0], target: [1, 1], progress: 0.5 })))
      expect(near(worldOf(frame, [0.9, 0.9]), [0.9, 0.9, 0])).toBe(true)
      expect(near(worldOf(frame, [0.8, 0.5]), [0.8, 0.5, 0])).toBe(true)
      expect(worldOf(frame, [0.1, 0.1])[2]).toBeGreaterThan(0.1) // valley lifts the flap
    })

    test('two steps where the never-moved region lies wholly on the grab side: no world jump', () => {
      // 1: fold the right 70% over onto the left: strip [0,0.3] stays, flap lands on x ∈ [-0.4, 0.3]
      const one = ok(commit(sheet(), fold({ grab: [0.9, 0.5], target: [-0.3, 0.5] }))).frame
      const c1 = foldedCoords(one)
      expect(near(c1[vertexAt(one, [0, 0])], [0, 0])).toBe(true)
      expect(near(c1[vertexAt(one, [1, 0])], [-0.4, 0])).toBe(true)
      // 2: grab both layers at x = 0.2 and fold onto x = -0.4 (crease at x = -0.1). Everything that
      // never moved (the strip) is on the grab side; only part of the flipped flap stays put.
      const before = foldedCoords(one)
      const stays = [vertexAt(one, [1, 0]), vertexAt(one, [1, 1])].map(v => before[v])
      const two = ok(commit(one, fold({ grab: [0.2, 0.5], target: [-0.4, 0.5], layers: 2 }))).frame
      const c2 = foldedCoords(two)
      const has = (p: readonly number[]) => c2.some(q => near(q, p))
      for (const p of stays) expect(has(p)).toBe(true) // the stationary corners are where they were
      expect(has([-0.2, 0])).toBe(true) // the strip's corners reflected across x = -0.1
      expect(has([-0.2, 1])).toBe(true)
      expect(has([0, 0])).toBe(false)
      const xs = c2.map(p => p[0])
      expect(Math.min(...xs)).toBeCloseTo(-0.5, 9)
      expect(Math.max(...xs)).toBeCloseTo(-0.1, 9)
      expect(footprintWidth(c2)).toBeCloseTo(0.4, 9)
      // paper stays a rigid image of the sheet, with a valid layer order
      expect(area(two)).toBeCloseTo(1, 9)
      expect(layerOrders(two)).not.toBeNull()
      expect(layerAt(two, [-0.3, 0.5])).toHaveLength(3)
      // the moved layers (valley) are above the stationary one
      const stack = layerAt(two, [-0.3, 0.5])
      const bottom = stack[stack.length - 1]
      expect(two.faces_vertices[bottom].map(v => c2[v]).some(p => near(p, [-0.4, 0]))).toBe(true)
      // a further valley preview still lifts toward +z (V/M consistent after re-rooting)
      const { preview: pv } = ok(preview(two, fold({ grab: [-0.45, 0.5], target: [-0.2, 0.5], progress: 0.4 })))
      const zs = pv.moving.flatMap(f =>
        pv.frame.faces_vertices[f].map(v => applyPose(pv.poses[f].matrix, pv.frame.vertices_coords[v])[2]),
      )
      expect(Math.max(...zs)).toBeGreaterThan(0.01)
      expect(Math.min(...zs)).toBeGreaterThan(-1e-9)
      // windings are consistent with layerAt's convention (faces flipped an odd number of times)
      expect(windings(two)).toHaveLength(two.faces_vertices.length)
    })
  })
})
