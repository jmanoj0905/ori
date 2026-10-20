import { describe, expect, test } from 'vitest'
import { petalFold, reverseFold, squashFold } from './compound'
import { reflect } from './geometry'
import { layerAt } from './layers'
import { commit, preview, type Gesture } from './ops'
import { foldedCoords, layerOrders, makeSheet } from './rabbit'
import { area, base, doubleTriangle, halfFolded, preliminary, turnedOver } from './testkit'
import type { Frame, Line, Tool, Vec2 } from './types'

const sheet = () => makeSheet({ width: 1, height: 1 })
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps
const near = (p: readonly number[], q: readonly number[], eps = 1e-9) => p.every((x, i) => close(x, q[i], eps))

const gesture = (tool: Tool, over: Partial<Gesture> & Pick<Gesture, 'grab' | 'target'>): Gesture => ({
  tool,
  layers: 1,
  kind: 'valley',
  progress: 1,
  snapAngle: false,
  ...over,
})

function ok<T>(r: ({ ok: true } & T) | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r
}

const isFlat = (f: Frame) => f.edges_foldAngle.every(a => close(a, 0, 1e-6) || close(Math.abs(a), 180, 1e-6))

/** Vertices of `frame` at paper point `p`. */
const verticesAt = (frame: Frame, p: Vec2) =>
  frame.vertices_coords.map((q, v) => (near(q, p) ? v : -1)).filter(v => v >= 0)

/** Folded polygon of face f. */
const foldedPoly = (frame: Frame, f: number, c = foldedCoords(frame)) => frame.faces_vertices[f].map(v => c[v])

/** Same polygon up to rotation/reversal of the vertex list. */
function samePolygon(a: readonly Vec2[], b: readonly Vec2[], eps = 1e-9) {
  if (a.length !== b.length) return false
  const n = a.length
  for (let s = 0; s < n; s++)
    for (const dir of [1, -1])
      if (a.every((p, i) => near(p, b[(s + dir * i + 2 * n) % n], eps))) return true
  return false
}

/** Every polygon reflected across `l` matches some polygon of the set. */
const mirrorSymmetric = (polys: Vec2[][], l: Line) =>
  polys.every(p => polys.some(q => samePolygon(p.map(x => reflect(x, l)), q, 1e-7)))

/** Faces whose paper polygon has a vertex at one of the paper points `ps`. */
const facesTouching = (frame: Frame, ps: Vec2[]) =>
  frame.faces_vertices
    .map((vs, f) => (vs.some(v => ps.some(p => near(frame.vertices_coords[v], p))) ? f : -1))
    .filter(f => f >= 0)

const REVERSE_NO = "This flap can't reverse-fold: it isn't folded in half."
const FLATTEN = 'Flatten the model before this fold.'

describe('reverse fold', () => {
  // doubleTriangle: triangle C=[.5,.5], P=[1,0], Q=[1,1]; spine C–P joins the two
  // halves (2 layers each); open along P–Q. Crease y = 0.25 cuts the P tip off.
  const inside = gesture('reverse', { grab: [0.95, 0.1], target: [0.95, 0.4], layers: 4 })

  test('inside reverse on a triangle folded in half: more faces, valid layers, area conserved', () => {
    const before = doubleTriangle()
    const { frame, step } = ok(reverseFold(before, inside))
    expect(frame.faces_vertices.length).toBe(before.faces_vertices.length + 4)
    expect(area(frame)).toBeCloseTo(1, 9)
    expect(layerOrders(frame)).not.toBeNull()
    expect(frame.faceOrders.length).toBeGreaterThan(0)
    expect(step.kind).toBe('reverse')
    expect(step.label).toBe('Inside reverse fold · 4 layers')
    // the tip (paper corners [1,0] and [0,1] sit at P) is reflected across y = 0.25
    const c = foldedCoords(frame)
    for (const p of [[1, 0], [0, 1]] as Vec2[]) for (const v of verticesAt(frame, p)) expect(near(c[v], [1, 0.5])).toBe(true)
    // the stationary part did not move
    for (const v of verticesAt(frame, [0.5, 0.5])) expect(near(c[v], [0.5, 0.5])).toBe(true)
    for (const v of verticesAt(frame, [1, 1])) expect(near(c[v], [1, 1])).toBe(true)
  })

  test('inside: the reversed tip goes between the two halves', () => {
    const { frame } = ok(reverseFold(doubleTriangle(), inside))
    const stack = layerAt(frame, [0.95, 0.3])
    expect(stack).toHaveLength(8)
    const tip = new Set(facesTouching(frame, [[1, 0], [0, 1]]))
    expect(stack.map(f => tip.has(f))).toEqual([false, false, true, true, true, true, false, false])
  })

  test('outside: the drag points away from the open side and the tip wraps around the outside', () => {
    const g = gesture('reverse', { grab: [0.95, 0.1], target: [0.65, 0.1], layers: 4 })
    const { frame, step } = ok(reverseFold(doubleTriangle(), g))
    expect(step.label).toBe('Outside reverse fold · 4 layers')
    expect(area(frame)).toBeCloseTo(1, 9)
    expect(layerOrders(frame)).not.toBeNull()
    const stack = layerAt(frame, [0.7, 0.5])
    expect(stack).toHaveLength(8)
    const tip = new Set(facesTouching(frame, [[1, 0], [0, 1]]))
    expect(stack.map(f => tip.has(f))).toEqual([true, true, false, false, false, false, true, true])
  })

  test('inside reverse on a waterbomb-base flap', () => {
    // RE waterbomb folds to the triangle [0,0], [1,0], apex [.5,.5]; the front-left
    // flap is two layers joined along the ridge [0,0]–apex.
    const before = base('waterbomb')
    const g = gesture('reverse', { grab: [0.1, 0.02], target: [0.3, 0.02], layers: 2 })
    const { frame, step } = ok(reverseFold(before, g))
    expect(step.label).toBe('Inside reverse fold · 2 layers')
    expect(frame.faces_vertices.length).toBe(before.faces_vertices.length + 2)
    expect(area(frame)).toBeCloseTo(1, 9)
    expect(layerOrders(frame)).not.toBeNull()
    // the corner lands at [0.4, 0], between the flap's two layers
    const c = foldedCoords(frame)
    const corners = frame.vertices_coords.map((_, v) => v).filter(v => near(c[v], [0.4, 0]))
    expect(corners.length).toBeGreaterThan(0)
    const stack = layerAt(frame, [0.3, 0.02])
    const tip = new Set(frame.faces_vertices.map((vs, f) => (vs.some(v => corners.includes(v)) ? f : -1)).filter(f => f >= 0))
    expect(tip.has(stack[0])).toBe(false)
    expect(stack.slice(1, 3).every(f => tip.has(f))).toBe(true)
  })

  test('a single-layer flap is refused with the spec message', () => {
    const g = gesture('reverse', { grab: [0.9, 0.1], target: [0.6, 0.4] })
    expect(reverseFold(sheet(), g)).toEqual({ ok: false, reason: REVERSE_NO })
    expect(commit(sheet(), g)).toEqual({ ok: false, reason: REVERSE_NO })
    expect(preview(sheet(), g)).toEqual({ ok: false, reason: REVERSE_NO })
  })

  test('a crease that misses the spine is refused: the cut-off part is not folded in half', () => {
    const g = gesture('reverse', { grab: [0.1, 0.5], target: [0.3, 0.5], layers: 2 })
    expect(reverseFold(halfFolded(), g)).toEqual({ ok: false, reason: REVERSE_NO })
  })

  test('preview and commit route to the reverse fold', () => {
    const { preview: pv } = ok(preview(doubleTriangle(), inside))
    expect(pv.layers).toBe(4)
    expect(pv.moving.length).toBe(4)
    expect(pv.crease.length).toBeGreaterThan(0)
    expect(pv.poses).toHaveLength(pv.frame.faces_vertices.length)
    const { step } = ok(commit(doubleTriangle(), inside))
    expect(step.label).toBe('Inside reverse fold · 4 layers')
  })
})

describe('squash fold', () => {
  test('the top flap of a triangle folded in half squashes into a symmetric square', () => {
    // flap = top two layers, hinged along C–P, folded edge C–Q. Squashed, it is the
    // square C, [.5,0], P, [1,.5], symmetric about the line x + y = 1.
    const before = doubleTriangle()
    const g = gesture('squash', { grab: [0.9, 0.5], target: [0.6, 0.1] })
    const { frame, step } = ok(squashFold(before, g))
    expect(step.kind).toBe('squash')
    expect(step.label).toBe('Squash fold')
    expect(frame.faces_vertices.length).toBe(before.faces_vertices.length + 2)
    expect(area(frame)).toBeCloseTo(1, 9)
    expect(layerOrders(frame)).not.toBeNull()
    expect(isFlat(frame)).toBe(true)
    const c = foldedCoords(frame)
    const hinge: Line = { origin: [1, 0], vector: [-1, 1] }
    // the flap's faces (paper x + y < 1: the moved half) are mirror images across the hinge line
    const flap = frame.faces_vertices
      .map((vs, f) => (vs.every(v => frame.vertices_coords[v][0] + frame.vertices_coords[v][1] <= 1 + 1e-9) ? f : -1))
      .filter(f => f >= 0)
    expect(flap).toHaveLength(4)
    const polys = flap.map(f => foldedPoly(frame, f, c))
    expect(mirrorSymmetric(polys, hinge)).toBe(true)
    // the two new faces (the halves that held the folded edge, paper corner [0,0]) mirror each other
    const ridge = facesTouching(frame, [[0, 0]])
    expect(ridge).toHaveLength(2)
    const [a, b] = ridge.map(f => foldedPoly(frame, f, c))
    expect(samePolygon(a.map(p => reflect(p, hinge)), b, 1e-7)).toBe(true)
    // the folded edge (paper [0,0]) is pressed onto the hinge: corner [0,0] lands on P
    for (const v of verticesAt(frame, [0, 0])) expect(near(c[v], [1, 0])).toBe(true)
    // the square's other corners
    const pts = flap.flatMap(f => foldedPoly(frame, f, c))
    for (const q of [[0.5, 0.5], [0.5, 0], [1, 0], [1, 0.5]] as Vec2[]) expect(pts.some(p => near(p, q))).toBe(true)
    // the unsquashed half did not move
    for (const v of verticesAt(frame, [1, 1])) expect(near(c[v], [1, 1])).toBe(true)
  })

  test('a preliminary-base flap squashes symmetrically about the axis', () => {
    // front-lower flap = front panel's lower half (face 0) + face 1, folded edge
    // C–[.5,0], hinged on the axis y = x. The squash presses the edge onto the axis.
    const before = preliminary()
    const g = gesture('squash', { grab: [0.3, 0.1], target: [0.1, 0.3] })
    const { frame } = ok(squashFold(before, g))
    expect(frame.faces_vertices.length).toBe(before.faces_vertices.length + 2)
    expect(area(frame)).toBeCloseTo(1, 9)
    expect(layerOrders(frame)).not.toBeNull()
    const c = foldedCoords(frame)
    const axis: Line = { origin: [0, 0], vector: [1, 1] }
    // the two new faces hold the folded edge's ends: paper [.5,0] (both layers' corner of it)
    const ridge = facesTouching(frame, [[0.5, 0]])
    const news = ridge.filter(f => !frame.faces_vertices[f].some(v => near(frame.vertices_coords[v], [1, 0])))
    expect(news).toHaveLength(2)
    const [a, b] = news.map(f => foldedPoly(frame, f, c))
    expect(samePolygon(a.map(p => reflect(p, axis)), b, 1e-7)).toBe(true)
    // the folded edge's outer end lands on the axis
    for (const v of verticesAt(frame, [0.5, 0])) expect(close(c[v][0], c[v][1], 1e-9)).toBe(true)
  })

  test('a single layer cannot be squashed', () => {
    const r = squashFold(sheet(), gesture('squash', { grab: [0.5, 0.5], target: [0.2, 0.2] }))
    expect(r.ok).toBe(false)
  })
})

describe('petal fold', () => {
  const g = gesture('petal', { grab: [0.05, 0.05], target: [0.6, 0.6] })

  test('the front flap of a preliminary base petal-folds: valid layers, the tip moves past the top', () => {
    const before = preliminary()
    const { frame, step } = ok(petalFold(before, g))
    expect(step.kind).toBe('petal')
    expect(step.label).toBe('Petal fold')
    expect(area(frame)).toBeCloseTo(1, 9)
    expect(layerOrders(frame)).not.toBeNull()
    expect(isFlat(frame)).toBe(true)
    expect(frame.faces_vertices.length).toBeGreaterThan(before.faces_vertices.length)
    // the front panel's point (paper [0,0]) goes from W = [0,0] past the closed top C = [.5,.5]
    const c = foldedCoords(frame)
    const tip = verticesAt(frame, [0, 0]).map(v => c[v])
    expect(tip.length).toBeGreaterThan(0)
    for (const p of tip) {
      expect(near(p, [Math.SQRT1_2, Math.SQRT1_2])).toBe(true)
      expect(p[0] + p[1]).toBeGreaterThan(0.5 + 0.5)
    }
    // the sides fold in under the petal: on top in the petal is its main panel,
    // not a side triangle (those hold the midpoints [.5,0] and [0,.5])
    const top = layerAt(frame, [0.55, 0.55])[0]
    expect(frame.faces_vertices[top].some(v => near(frame.vertices_coords[v], [0.5, 0]) || near(frame.vertices_coords[v], [0, 0.5]))).toBe(false)
    // the closed top stays where it was
    for (const v of verticesAt(frame, [0.5, 0.5])) expect(near(c[v], [0.5, 0.5])).toBe(true)
    // the other corners (the legs) stay at the bottom
    for (const p of [[1, 0], [0, 1], [1, 1]] as Vec2[]) for (const v of verticesAt(frame, p)) expect(near(c[v], [0, 0])).toBe(true)
  })

  test('its creases all lie on the bird base crease pattern', () => {
    const { frame } = ok(petalFold(preliminary(), g))
    const bird = base('bird')
    const lines = bird.edges_vertices.map(([u, v]) => [bird.vertices_coords[u], bird.vertices_coords[v]] as const)
    const onLine = (p: Vec2, [a, b]: readonly [Vec2, Vec2]) =>
      Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 1e-7
    const onSegment = (p: Vec2, [a, b]: readonly [Vec2, Vec2]) => {
      const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
      const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)
      return Math.abs(cr) < 1e-7 && t > -1e-7 && t < 1 + 1e-7
    }
    frame.edges_vertices.forEach(([u, v], e) => {
      if (!/^[VM]$/.test(frame.edges_assignment[e])) return
      const p = frame.vertices_coords[u]
      const q = frame.vertices_coords[v]
      // every point of the crease is on a bird crease running the same way
      const along = lines.filter(s => onLine(p, s) && onLine(q, s))
      for (let i = 0; i <= 8; i++) {
        const x: Vec2 = [p[0] + ((q[0] - p[0]) * i) / 8, p[1] + ((q[1] - p[1]) * i) / 8]
        expect(along.some(s => onSegment(x, s)), `edge ${e} at ${x}`).toBe(true)
      }
    })
  })

  test('a single sheet cannot be petal-folded', () => {
    expect(petalFold(sheet(), g).ok).toBe(false)
  })
})

describe('the crane path: squash ×2 makes a preliminary base, petal ×2 a bird base', () => {
  test('end to end through commit', () => {
    let f = doubleTriangle()
    f = ok(commit(f, gesture('squash', { grab: [0.9, 0.5], target: [0.6, 0.1] }))).frame
    f = turnedOver(f) // the triangle is now at x ∈ [-1, -0.5]: C = [-.5,.5], P = [-1,0], Q = [-1,1]
    f = ok(commit(f, gesture('squash', { grab: [-0.9, 0.7], target: [-0.6, 0.1] }))).frame
    // a preliminary base: the square C, [-.5,0], P, [-1,.5], four layers
    expect(layerOrders(f)).not.toBeNull()
    expect(layerAt(f, [-0.8, 0.1])).toHaveLength(4) // either side of the axis (the diagonal y = x + 1)
    expect(layerAt(f, [-0.9, 0.3])).toHaveLength(4)
    const c = foldedCoords(f)
    const corners = ([[0, 0], [1, 0], [0, 1], [1, 1]] as Vec2[]).flatMap(p => verticesAt(f, p)).map(v => c[v])
    for (const p of corners) expect(near(p, [-1, 0])).toBe(true)
    // petal the front, turn over, petal the back
    f = ok(commit(f, gesture('petal', { grab: [-0.95, 0.05], target: [-0.4, 0.6] }))).frame
    expect(layerOrders(f)).not.toBeNull()
    f = turnedOver(f)
    f = ok(commit(f, gesture('petal', { grab: [0.95, 0.05], target: [0.4, 0.6] }))).frame
    expect(layerOrders(f)).not.toBeNull()
    expect(area(f)).toBeCloseTo(1, 9)
    // two corners up at the petal tips, two down at the legs
    const c2 = foldedCoords(f)
    const tips = ([[0, 0], [1, 0], [0, 1], [1, 1]] as Vec2[]).map(p => verticesAt(f, p).map(v => c2[v]))
    const up = tips.filter(ps => ps.every(p => near(p, [1 - Math.SQRT1_2, Math.SQRT1_2], 1e-7)))
    const down = tips.filter(ps => ps.every(p => near(p, [1, 0], 1e-7)))
    expect(up).toHaveLength(2)
    expect(down).toHaveLength(2)
  })
})

describe('the partial-fold rule (Review Focus 5)', () => {
  // halfFolded, then the top layer's strip x < 0.15 swung up 90° (valley)
  const p90 = 1 - Math.SQRT1_2
  const swing = gesture('fold', { grab: [0.05, 0.5], target: [0.25, 0.5], progress: p90 })
  const partial = () => ok(commit(halfFolded(), swing)).frame

  test('the fixture has a 90° fold', () => {
    expect(partial().edges_foldAngle.some(a => close(Math.abs(a), 90, 1e-6))).toBe(true)
  })

  test('a fold through several flaps is refused', () => {
    const g = gesture('fold', { grab: [0.4, 0.9], target: [0.4, 0.6], layers: 2 })
    expect(preview(partial(), g)).toEqual({ ok: false, reason: FLATTEN })
    expect(commit(partial(), g)).toEqual({ ok: false, reason: FLATTEN })
  })

  test('compound folds are refused', () => {
    for (const tool of ['reverse', 'squash', 'petal'] as const) {
      const g = gesture(tool, { grab: [0.4, 0.9], target: [0.4, 0.6], layers: 2 })
      expect(commit(partial(), g)).toEqual({ ok: false, reason: FLATTEN })
      expect(preview(partial(), g)).toEqual({ ok: false, reason: FLATTEN })
    }
  })

  test('a single-flap hinge fold on the swung flap is allowed: it finishes the fold', () => {
    const { preview: pv } = ok(preview(partial(), { ...swing, progress: 1 }))
    expect(pv.angleDeg).toBeCloseTo(90, 6) // the rest of the way
    const { frame, step } = ok(commit(partial(), { ...swing, progress: 1 }))
    expect(isFlat(frame)).toBe(true)
    expect(layerOrders(frame)).not.toBeNull()
    expect(layerAt(frame, [0.2, 0.5])).toHaveLength(3)
    expect(step.label).toBe('Valley fold · top flap · 90°')
  })

  test('a fold through several flaps of a flat model is still allowed', () => {
    expect(ok(commit(halfFolded(), gesture('fold', { grab: [0.4, 0.9], target: [0.4, 0.6], layers: 2 }))).frame).toBeTruthy()
  })
})

describe('folding along an existing hinge (unfold)', () => {
  test('lifting the top flap of a half fold back over its hinge unfolds it', () => {
    const g = gesture('fold', { grab: [0.1, 0.5], target: [0.9, 0.5] })
    const { preview: pv } = ok(preview(halfFolded(), g))
    expect(pv.moving).toEqual([1])
    const { frame } = ok(commit(halfFolded(), g))
    expect(frame.edges_foldAngle.every(a => a === 0)).toBe(true)
    const c = foldedCoords(frame)
    expect(Math.max(...c.map(p => p[0]))).toBeCloseTo(1, 9)
    expect(layerAt(frame, [0.75, 0.5])).toHaveLength(1)
  })
})
