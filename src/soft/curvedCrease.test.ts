import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, createPaper, patternFrame, poses } from '@engine'
import { addCrease, emptyCP } from '../designer/cp'
import { CURVE_SEGMENTS, bezier, curveRulings, curvedFold, gaussianCurvature, shapeCurvature } from './curvedCrease'
import { remesh } from './remesh'
import { SoftSolver } from './xpbd'
import { dihedral } from './dihedral'

describe('curved creases', () => {
  test('a quadratic Bézier from start through the control pull to the end, as a polyline', () => {
    const pts = bezier([0, 0.2], [0.5, 0.8], [1, 0.2])
    expect(pts).toHaveLength(CURVE_SEGMENTS + 1)
    expect(pts[0]).toEqual([0, 0.2])
    expect(pts.at(-1)).toEqual([1, 0.2])
    expect(pts[CURVE_SEGMENTS / 2]![1]).toBeCloseTo(0.5, 12) // the apex: halfway to the control point
  })

  test('folding along a curved crease gives a developable surface (|K| < 1e-2 away from the crease)', () => {
    const curve = bezier([0, 0.25], [0.5, 0.75], [1, 0.25])
    let cp = emptyCP({ width: 1, height: 1 })
    for (let i = 0; i + 1 < curve.length; i++) cp = addCrease(cp, curve[i]!, curve[i + 1]!, 'V')
    const r = patternFrame(cp)
    if (!r.ok) throw new Error(r.reason)
    const f = r.frame
    const mesh = remesh(f, poses(f), 0.05, { rulings: curveRulings(curve) })
    const folded = curvedFold(mesh.uv, curve, 30, true)
    if (!folded) throw new Error('no fold')
    // the solver takes the fold as its rest shape and holds it
    const s = new SoftSolver({ ...mesh, positions: folded }, { bendCompliance: 1e-3, creaseCompliance: 1e-3, iterations: 16, wet: false, gravity: [0, 0, 0] })
    s.dry()
    for (let k = 0; k < 200; k++) s.step(1 / 60)
    const p = s.positions()

    // it really is folded along the curve: a valley, tens of degrees all along
    const crease = mesh.creaseHinges.map(hg => (dihedral(p, hg.a, hg.b, hg.c, hg.d) * 180) / Math.PI)
    expect(Math.min(...crease)).toBeGreaterThan(30)
    // the paper is not stretched
    expect(s.maxStretch()).toBeLessThan(1e-4)

    // Gaussian curvature away from the crease (and the paper's edge): the shape's, by a local fit, and the mesh's angle defect
    const h = 0.05
    const onCrease = mesh.edgeSamples.flatMap((c, e) => (f.edges_assignment[e] === 'B' ? [] : c))
    const dist = (i: number) => Math.min(...onCrease.map(j => Math.hypot(mesh.uv[2 * j]! - mesh.uv[2 * i]!, mesh.uv[2 * j + 1]! - mesh.uv[2 * i + 1]!)))
    const boundary = new Set(mesh.boundary)
    const defect = gaussianCurvature(p, mesh.tris, mesh.uv.length / 2)
    const R = 0.12
    let shapeWorst = 0
    let defectWorst = 0
    let checked = 0
    for (let i = 0; i < mesh.uv.length / 2; i++) {
      const [x, y] = [mesh.uv[2 * i]!, mesh.uv[2 * i + 1]!]
      if (!boundary.has(i) && dist(i) > 2 * h) defectWorst = Math.max(defectWorst, Math.abs(defect[i]!))
      if (dist(i) < R + 0.02 || Math.min(x, 1 - x, y, 1 - y) < R) continue
      const K = shapeCurvature(p, mesh.uv, mesh.tris, i, R)
      if (Number.isNaN(K)) continue
      checked++
      shapeWorst = Math.max(shapeWorst, Math.abs(K))
    }
    expect(checked).toBeGreaterThan(100)
    expect(shapeWorst).toBeLessThan(1e-2)
    expect(defectWorst).toBeLessThan(1e-2)
  }, 60_000)

  test('the Gaussian curvature estimator: a unit sphere ~1, a cylinder ~0', () => {
    const f = createPaper(PAPER_SIZES.square)
    const m = remesh(f, poses(f), 0.05)
    const sphere = new Float32Array(m.positions.length)
    const cyl = new Float32Array(m.positions.length)
    let mid = 0
    for (let i = 0; i < m.uv.length / 2; i++) {
      const [u, v] = [m.uv[2 * i]! - 0.5, m.uv[2 * i + 1]! - 0.5]
      sphere.set([u, v, Math.sqrt(1 - u * u - v * v)], 3 * i)
      cyl.set([0.4 * Math.sin(u / 0.4), v, 0.4 * (1 - Math.cos(u / 0.4))], 3 * i)
      if (Math.hypot(u, v) < Math.hypot(m.uv[2 * mid]! - 0.5, m.uv[2 * mid + 1]! - 0.5)) mid = i
    }
    expect(shapeCurvature(sphere, m.uv, m.tris, mid, 0.15)).toBeCloseTo(1, 1)
    expect(Math.abs(shapeCurvature(cyl, m.uv, m.tris, mid, 0.15))).toBeLessThan(1e-2)
  })

  test('a fold too steep for the curve, or a crease that doubles back, is refused', () => {
    const curve = bezier([0, 0.25], [0.5, 0.75], [1, 0.25])
    expect(curvedFold(new Float32Array([0.5, 0.5]), curve, 80, true)).toBeNull()
    expect(curvedFold(new Float32Array([0.5, 0.5]), [[0, 0], [0.5, 0.2], [0.3, 0.4], [1, 0]], 20, true)).toBeNull()
  })

  test('the remesher keeps a curved crease (a concave face) as mesh edges', () => {
    const curve = bezier([0, 0.25], [0.5, 0.95], [1, 0.25])
    let cp = emptyCP({ width: 1, height: 1 })
    for (let i = 0; i + 1 < curve.length; i++) cp = addCrease(cp, curve[i]!, curve[i + 1]!, 'M')
    const r = patternFrame(cp)
    if (!r.ok) throw new Error(r.reason)
    const mesh = remesh(r.frame, poses(r.frame), 0.05)
    const edges = new Set<string>()
    for (let t = 0; t < mesh.tris.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = mesh.tris[t + k]!
        const b = mesh.tris[t + ((k + 1) % 3)]!
        edges.add(a < b ? `${a} ${b}` : `${b} ${a}`)
      }
    for (const chain of mesh.edgeSamples)
      for (let i = 0; i + 1 < chain.length; i++) {
        const [a, b] = [chain[i]!, chain[i + 1]!]
        expect(edges.has(a < b ? `${a} ${b}` : `${b} ${a}`)).toBe(true)
      }
    let area = 0
    for (let t = 0; t < mesh.tris.length; t += 3) {
      const [a, b, c] = [mesh.tris[t]!, mesh.tris[t + 1]!, mesh.tris[t + 2]!]
      area += ((mesh.uv[2 * b]! - mesh.uv[2 * a]!) * (mesh.uv[2 * c + 1]! - mesh.uv[2 * a + 1]!) - (mesh.uv[2 * c]! - mesh.uv[2 * a]!) * (mesh.uv[2 * b + 1]! - mesh.uv[2 * a + 1]!)) / 2
    }
    expect(area).toBeCloseTo(1, 5)
  })
})
