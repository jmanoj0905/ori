import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, commit, createPaper, patternFrame, poses, type Frame, type Gesture } from '@engine'
import { remesh, type SoftMesh } from './remesh'
import { dihedral } from './dihedral'

const g = (grab: [number, number], target: [number, number], angleDeg?: number): Gesture => ({
  tool: 'fold', grab, target, layers: 1, kind: 'valley', progress: 1, snapAngle: false, ...(angleDeg === undefined ? {} : { angleDeg }),
})
function ok(r: { ok: true; frame: Frame } | { ok: false; reason: string }): Frame {
  if (!r.ok) throw new Error(r.reason)
  return r.frame
}
/** A half fold standing at 90°, then its top-right corner folded in (a flat fold on one flap). */
const halfAt90 = () => ok(commit(createPaper(PAPER_SIZES.square), g([0.9, 0.5], [0.1, 0.5], 90)))
const flatTwice = () => {
  const one = ok(commit(createPaper(PAPER_SIZES.square), g([0.95, 0.5], [0.05, 0.5])))
  return ok(commit(one, { ...g([0.25, 0.95], [0.25, 0.05]), layers: 2 }))
}
const a4Diagonal = () => ok(commit(createPaper(PAPER_SIZES.a4), g([0.9, 1.3], [0.2, 0.2], 60)))
const waterbombCp = (): Frame => {
  const r = patternFrame({
    vertices_coords: [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5], [0.5, 0.5]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0], [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8]],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'V', 'F', 'V', 'M', 'V', 'F', 'V', 'M'],
    edges_foldAngle: new Array(16).fill(0), faces_vertices: [], faceOrders: [],
  })
  if (!r.ok) throw new Error(r.reason)
  return r.frame
}

const FIXTURES: [string, () => Frame, number][] = [
  ['a half fold at 90°', halfAt90, 1],
  ['two flat folds', flatTwice, 1],
  ['an A4 diagonal fold at 60°', a4Diagonal, Math.SQRT2],
  ['the pre-creased waterbomb', waterbombCp, 1],
]

const triArea = (p: ArrayLike<number>, a: number, b: number, c: number, dim: 2 | 3) => {
  const v = (i: number) => Array.from({ length: dim }, (_, k) => p[dim * i + k]!)
  const [A, B, C] = [v(a), v(b), v(c)]
  const u = [B[0]! - A[0]!, B[1]! - A[1]!, dim === 3 ? B[2]! - A[2]! : 0]
  const w = [C[0]! - A[0]!, C[1]! - A[1]!, dim === 3 ? C[2]! - A[2]! : 0]
  const x = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!]
  return Math.hypot(x[0]!, x[1]!, x[2]!) / 2
}
const area = (m: SoftMesh, dim: 2 | 3) => {
  let s = 0
  for (let t = 0; t < m.tris.length; t += 3) s += triArea(dim === 3 ? m.positions : m.uv, m.tris[t]!, m.tris[t + 1]!, m.tris[t + 2]!, dim)
  return s
}

/** Does the open segment p–q cross the interior of triangle (a, b, c) (2D)? */
function crossesInterior(p: number[], q: number[], a: number[], b: number[], c: number[]): boolean {
  const side = (o: number[], x: number[], y: number[]) => (x[0]! - o[0]!) * (y[1]! - o[1]!) - (x[1]! - o[1]!) * (y[0]! - o[0]!)
  const eps = 1e-6 // float32 coordinates
  // sample along the segment's interior: any sample strictly inside the triangle is a crossing
  for (let k = 1; k < 20; k++) {
    const s = [p[0]! + ((q[0]! - p[0]!) * k) / 20, p[1]! + ((q[1]! - p[1]!) * k) / 20]
    const d1 = side(a, b, s)
    const d2 = side(b, c, s)
    const d3 = side(c, a, s)
    if ((d1 > eps && d2 > eps && d3 > eps) || (d1 < -eps && d2 < -eps && d3 < -eps)) return true
  }
  return false
}

describe('remesh', () => {
  test.each(FIXTURES)('%s: the triangles cover exactly the paper, flat and folded', (_, make, paperArea) => {
    const f = make()
    const m = remesh(f, poses(f), 0.08)
    // positions are float32: ~1e-7 relative
    expect(area(m, 2)).toBeCloseTo(paperArea, 6)
    expect(area(m, 3)).toBeCloseTo(paperArea, 6) // rigid poses keep every triangle's area
    expect(m.positions.every(Number.isFinite)).toBe(true)
  })

  test.each(FIXTURES)('%s: every crease is made of mesh edges and crosses no triangle', (_, make) => {
    const f = make()
    const m = remesh(f, poses(f), 0.08)
    const uv = (i: number) => [m.uv[2 * i]!, m.uv[2 * i + 1]!]
    const edges = new Set<string>()
    for (let t = 0; t < m.tris.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = m.tris[t + k]!
        const b = m.tris[t + ((k + 1) % 3)]!
        edges.add(a < b ? `${a} ${b}` : `${b} ${a}`)
      }
    f.edges_vertices.forEach(([u, v], e) => {
      const chain = m.edgeSamples[e]!
      expect(m.uv[2 * chain[0]!]).toBeCloseTo(f.vertices_coords[u]![0], 6)
      expect(m.uv[2 * chain.at(-1)! + 1]).toBeCloseTo(f.vertices_coords[v]![1], 6)
      for (let i = 0; i + 1 < chain.length; i++) {
        const [a, b] = [chain[i]!, chain[i + 1]!]
        expect(edges.has(a < b ? `${a} ${b}` : `${b} ${a}`)).toBe(true)
      }
      for (let t = 0; t < m.tris.length; t += 3)
        expect(crossesInterior(uv(chain[0]!), uv(chain.at(-1)!), uv(m.tris[t]!), uv(m.tris[t + 1]!), uv(m.tris[t + 2]!))).toBe(false)
    })
  })

  test.each(FIXTURES)('%s: hinge rest angles equal the frame’s edges_foldAngle, and the mesh is posed at them', (_, make) => {
    const f = make()
    const m = remesh(f, poses(f), 0.08)
    expect(m.creaseHinges.length).toBeGreaterThan(0)
    const creaseEdge = new Map<string, number>()
    f.edges_vertices.forEach((_, e) => {
      const chain = m.edgeSamples[e]!
      for (let i = 0; i + 1 < chain.length; i++) creaseEdge.set([chain[i]!, chain[i + 1]!].sort((x, y) => x - y).join(' '), e)
    })
    for (const h of m.creaseHinges) {
      const e = creaseEdge.get([h.a, h.b].sort((x, y) => x - y).join(' '))!
      expect(h.restAngle).toBe(f.edges_foldAngle[e])
      const now = (dihedral(m.positions, h.a, h.b, h.c, h.d) * 180) / Math.PI
      if (Math.abs(h.restAngle) < 179) expect(now).toBeCloseTo(h.restAngle, 3)
      else expect(Math.abs(now)).toBeGreaterThan(179) // folded flat: ±180 are one pose
    }
    // the faces themselves are flat: every bending hinge is at 0
    for (const h of m.bendHinges) expect(Math.abs(dihedral(m.positions, h.a, h.b, h.c, h.d))).toBeLessThan(1e-4)
  })

  test('the mesh is refined to the target edge, and the boundary is listed', () => {
    const f = halfAt90()
    const coarse = remesh(f, poses(f), 0.25)
    const fine = remesh(f, poses(f), 0.05)
    expect(fine.uv.length / 2).toBeGreaterThan(4 * (coarse.uv.length / 2))
    let longest = 0
    for (let t = 0; t < fine.tris.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = fine.tris[t + k]!
        const b = fine.tris[t + ((k + 1) % 3)]!
        longest = Math.max(longest, Math.hypot(fine.uv[2 * a]! - fine.uv[2 * b]!, fine.uv[2 * a + 1]! - fine.uv[2 * b + 1]!))
      }
    expect(longest).toBeLessThan(0.05 * 2)
    for (const i of fine.boundary) {
      const [x, y] = [fine.uv[2 * i]!, fine.uv[2 * i + 1]!]
      expect(Math.min(x, 1 - x, y, 1 - y)).toBeLessThan(1e-9)
    }
  })
})
