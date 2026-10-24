// Self-collision for the soft sheet (spec 08 Approach; Plan 6 Task 3): a
// visual effect, not exact contact mechanics.
//
// Vertex–triangle proximity through a spatial hash: every triangle is hashed
// into the cells its box (grown by the thickness) touches; each free particle
// closer than `thickness` to a triangle of another part of the paper is put
// back on the side it came from (judged from its previous position), at that
// distance. A particle and a triangle of the same flat face, or of
// neighbouring faces within two mesh edges of each other in the paper, are
// one surface, not a collision.
//
// Known weakness (spec 08): thick stacks. A cell holding more than MAX_LAYERS
// faces of the folded model is skipped and reported; the renderer draws such
// regions with the rigid layer order instead.
import type { SoftMesh } from './remesh'

export const MAX_LAYERS = 10
export type CollisionOptions = { thickness?: number; /** Share of the sliding motion a contact removes (0–1). */ friction?: number }
export type CollisionResult = { contacts: number; skippedCells: number }

type Mesh = Pick<SoftMesh, 'tris' | 'uv' | 'triFace'>

const cache = new WeakMap<Mesh, { faces: number[][]; edge: number }>()

/** Per particle: the faces of its triangles; and the mean mesh edge length (paper units). */
function topology(m: Mesh) {
  const hit = cache.get(m)
  if (hit) return hit
  const faces: number[][] = Array.from({ length: m.uv.length / 2 }, () => [])
  let sum = 0
  for (let t = 0; t < m.tris.length; t += 3) {
    const f = m.triFace[t / 3]!
    for (let k = 0; k < 3; k++) {
      const p = m.tris[t + k]!
      if (!faces[p]!.includes(f)) faces[p]!.push(f)
      const q = m.tris[t + ((k + 1) % 3)]!
      sum += Math.hypot(m.uv[2 * p]! - m.uv[2 * q]!, m.uv[2 * p + 1]! - m.uv[2 * q + 1]!)
    }
  }
  const out = { faces, edge: sum / Math.max(1, m.tris.length) }
  cache.set(m, out)
  return out
}

type V3 = [number, number, number]

/** Closest point to p on triangle (a, b, c) (Ericson, Real-Time Collision Detection 5.1.5), with its barycentrics. */
function closest(p: V3, a: V3, b: V3, c: V3): { q: V3; u: number; v: number; w: number } {
  const sub = (x: V3, y: V3): V3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]]
  const dot = (x: V3, y: V3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2]
  const at = (u: number, v: number, w: number) => ({ q: [a[0] * u + b[0] * v + c[0] * w, a[1] * u + b[1] * v + c[1] * w, a[2] * u + b[2] * v + c[2] * w] as V3, u, v, w })
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a)
  const d1 = dot(ab, ap), d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return at(1, 0, 0)
  const bp = sub(p, b)
  const d3 = dot(ab, bp), d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return at(0, 1, 0)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return at(1 - v, v, 0)
  }
  const cp = sub(p, c)
  const d5 = dot(ab, cp), d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return at(0, 0, 1)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return at(1 - w, 0, w)
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return at(0, 1 - w, w)
  }
  const den = 1 / (va + vb + vc)
  const v = vb * den
  const w = vc * den
  return at(1 - v - w, v, w)
}

/**
 * Push free particles (w(p) > 0) out of triangles they come closer than
 * `thickness` to (see header). Moves `x` in place; `prev` holds the positions
 * before this substep.
 */
export function collide(x: Float64Array, prev: Float64Array, mesh: Mesh, w: (p: number) => number, opts: CollisionOptions = {}): CollisionResult {
  const thickness = opts.thickness ?? 0.004
  const friction = opts.friction ?? 0.8
  const { faces, edge } = topology(mesh)
  const cell = Math.max(2 * thickness, edge)
  const key = (i: number, j: number, k: number) => `${i},${j},${k}`
  const P = (arr: Float64Array, i: number): V3 => [arr[3 * i]!, arr[3 * i + 1]!, arr[3 * i + 2]!]

  const grid = new Map<string, number[]>()
  const nt = mesh.tris.length / 3
  for (let t = 0; t < nt; t++) {
    const ps = [P(x, mesh.tris[3 * t]!), P(x, mesh.tris[3 * t + 1]!), P(x, mesh.tris[3 * t + 2]!)]
    const lo = [0, 1, 2].map(k => Math.floor((Math.min(ps[0]![k]!, ps[1]![k]!, ps[2]![k]!) - thickness) / cell))
    const hi = [0, 1, 2].map(k => Math.floor((Math.max(ps[0]![k]!, ps[1]![k]!, ps[2]![k]!) + thickness) / cell))
    for (let i = lo[0]!; i <= hi[0]!; i++)
      for (let j = lo[1]!; j <= hi[1]!; j++)
        for (let k = lo[2]!; k <= hi[2]!; k++) {
          const c = key(i, j, k)
          const l = grid.get(c)
          if (l) l.push(t)
          else grid.set(c, [t])
        }
  }
  // too many layers in a cell: skip it (rigid rendering takes over there)
  const skip = new Set<string>()
  for (const [c, ts] of grid) if (new Set(ts.map(t => mesh.triFace[t]!)).size > MAX_LAYERS) skip.add(c)

  let contacts = 0
  const n = mesh.uv.length / 2
  const near = 2 * edge
  for (let p = 0; p < n; p++) {
    if (w(p) === 0) continue
    const xp = P(x, p)
    const c = key(Math.floor(xp[0] / cell), Math.floor(xp[1] / cell), Math.floor(xp[2] / cell))
    if (skip.has(c)) continue
    for (const t of grid.get(c) ?? []) {
      const [ia, ib, ic] = [mesh.tris[3 * t]!, mesh.tris[3 * t + 1]!, mesh.tris[3 * t + 2]!]
      if (ia === p || ib === p || ic === p) continue
      const f = mesh.triFace[t]!
      if (faces[p]!.includes(f)) continue // the same flat face
      const a = P(x, ia), b = P(x, ib), cc = P(x, ic)
      const hit = closest(xp, a, b, cc)
      const d = [xp[0] - hit.q[0], xp[1] - hit.q[1], xp[2] - hit.q[2]]
      const dist = Math.hypot(d[0]!, d[1]!, d[2]!)
      if (dist >= thickness) continue
      // neighbouring faces near their shared crease are one surface
      const u = (k: 0 | 1) => mesh.uv[2 * ia + k]! * hit.u + mesh.uv[2 * ib + k]! * hit.v + mesh.uv[2 * ic + k]! * hit.w
      if (Math.hypot(mesh.uv[2 * p]! - u(0), mesh.uv[2 * p + 1]! - u(1)) < near) continue
      // the triangle's normal, and the side the particle came from
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const e2 = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]]
      const nrm = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!]
      const nl = Math.hypot(nrm[0]!, nrm[1]!, nrm[2]!)
      if (nl < 1e-12) continue
      const pp = P(prev, p)
      let side = ((pp[0] - a[0]) * nrm[0]! + (pp[1] - a[1]) * nrm[1]! + (pp[2] - a[2]) * nrm[2]!) / nl
      if (Math.abs(side) < 1e-12) side = (d[0]! * nrm[0]! + d[1]! * nrm[1]! + d[2]! * nrm[2]!) / nl || 1
      const s = Math.sign(side)
      for (let k = 0; k < 3; k++) x[3 * p + k] = hit.q[k]! + (s * thickness * nrm[k]!) / nl
      // friction: take back most of this substep's sliding along the triangle
      const mv = [x[3 * p]! - pp[0], x[3 * p + 1]! - pp[1], x[3 * p + 2]! - pp[2]]
      const along = (mv[0]! * nrm[0]! + mv[1]! * nrm[1]! + mv[2]! * nrm[2]!) / (nl * nl)
      for (let k = 0; k < 3; k++) x[3 * p + k] -= friction * (mv[k]! - along * nrm[k]!)
      xp[0] = x[3 * p]!
      xp[1] = x[3 * p + 1]!
      xp[2] = x[3 * p + 2]!
      contacts++
    }
  }
  return { contacts, skippedCells: skip.size }
}
