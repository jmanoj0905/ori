/*
 * Swept collision for a flap swinging about a crease axis.
 *
 * `sweep(frame, { faces, axis }, fromDeg, toDeg)` rotates `faces` (on top of
 * their tree poses, exactly as `poses(frame, { faces, axis, angleDeg })`
 * does — right-hand rule about `axis.vector`, see poses.ts) from `fromDeg`
 * toward `toDeg` and reports how far it gets before a moving face would pass
 * through a static one. Moving faces never collide with each other (they turn
 * rigidly together). Layer offsets are not modelled, so stacked layers are
 * exactly coplanar; the policy below handles that.
 *
 * Every face is fan-triangulated in world space at `fromDeg`. A triangle is
 * AXIAL when its plane contains the 3D swing axis (every face of a flat
 * model, since the axis lies in z = 0). Pairs are classified:
 *
 * 1. Axial moving × axial static — exact, no sampling. In cylindrical
 *    coordinates about the axis, each such triangle is a polygon in the
 *    (t along axis, r from axis) half-plane at a fixed angle θ (a triangle
 *    straddling the axis splits into two parts, θ and θ + 180°). The swing
 *    only changes θ of the moving part, so the two collide iff their (t, r)
 *    footprints overlap with positive area and the moving part's θ reaches
 *    the static part's θ strictly before `toDeg`; the contact angle is the
 *    exact `freeDeg`. Reaching it exactly AT `toDeg` is a landing (folding
 *    flat onto a layer), not a collision.
 *    Coplanar at the start (same θ at `fromDeg`, overlapping footprints —
 *    i.e. stacked layers): when the frame is flat and `fromDeg` = 0, the
 *    layer order (faceOrders + windings, the same "is above" graph `layerAt`
 *    uses, including transitive relations) says which of the two is on top.
 *    The pair blocks at `fromDeg` iff the moving part departs (±z) toward the
 *    static face's side — it would have to pass through it. Departing away
 *    from it is free. If the order is unknown (unrelated faces, non-flat
 *    frame, or fromDeg ≠ 0 where the stack's order isn't recorded), the pair
 *    is treated as touching and ignored.
 * 2. Any pair with a non-axial triangle (3D, partially folded geometry) —
 *    sampled in steps of at most 5°, each sample tested with Möller's (1997)
 *    triangle–triangle interval test, made strict: triangles touching only at
 *    a point or along an edge, or coplanar, do not count; the two chords must
 *    overlap with positive length (so faces hinged on a shared crease never
 *    collide along it). Pairs already intersecting at `fromDeg` are exempt
 *    (pre-existing contact is not caused by this motion — this generalises
 *    "didn't share an edge with at the start"). The first blocked step is
 *    refined by bisection (20 halvings) to the last free angle.
 *
 * `freeDeg` is the furthest angle (from `fromDeg` toward `toDeg`) reachable
 * without collision; `blocked` is true iff it is short of `toDeg`.
 */
import { aboveGraph } from './layers'
import { compose, swingRigid, transform, treePoses, type Vec3 } from './poses'
import type { Frame, Line } from './types'

const EPS = 1e-9
const AREA_EPS = 1e-12
const ANG_EPS = 1e-7
const STEP = 5
const BISECT = 20

type Tri = { face: number; p: [Vec3, Vec3, Vec3] }
type P2 = [number, number]
type Part = { face: number; theta: number; poly: P2[]; box: [number, number, number, number] }

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const mod360 = (x: number) => ((x % 360) + 360) % 360

function unitNormal(t: Tri['p']): Vec3 | null {
  const n = cross3(sub3(t[1], t[0]), sub3(t[2], t[0]))
  const l = norm3(n)
  return l < EPS ? null : [n[0] / l, n[1] / l, n[2] / l]
}

/** Strict Möller test: do the triangles' interiors cross along a segment of positive length? */
export function trianglesPenetrate(a: Tri['p'], b: Tri['p']): boolean {
  const na = unitNormal(a)
  const nb = unitNormal(b)
  if (!na || !nb) return false
  const chordA = chord(a, nb, dot3(nb, b[0]))
  if (!chordA) return false
  const chordB = chord(b, na, dot3(na, a[0]))
  if (!chordB) return false
  const d = cross3(na, nb)
  const l = norm3(d)
  if (l < EPS) return false // parallel planes (coplanar handled elsewhere)
  const dir: Vec3 = [d[0] / l, d[1] / l, d[2] / l]
  const ia = chordA.map(p => dot3(dir, p)).sort((x, y) => x - y)
  const ib = chordB.map(p => dot3(dir, p)).sort((x, y) => x - y)
  return Math.min(ia[1], ib[1]) - Math.max(ia[0], ib[0]) > EPS
}

/**
 * The segment where triangle `t` crosses the plane n·x = c, or null when it
 * doesn't strictly cross it (all on one side, or only touching at a vertex or
 * an edge, or lying in it).
 */
function chord(t: Tri['p'], n: Vec3, c: number): [Vec3, Vec3] | null {
  const d = t.map(p => {
    const x = dot3(n, p) - c
    return Math.abs(x) < EPS ? 0 : x
  })
  if (!d.some(x => x > 0) || !d.some(x => x < 0)) return null
  const pts: Vec3[] = []
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3
    if (d[i] === 0) pts.push(t[i])
    else if (d[i] * d[j] < 0) {
      const s = d[i] / (d[i] - d[j])
      pts.push([t[i][0] + (t[j][0] - t[i][0]) * s, t[i][1] + (t[j][1] - t[i][1]) * s, t[i][2] + (t[j][2] - t[i][2]) * s])
    }
  }
  return pts.length >= 2 ? [pts[0], pts[1]] : null
}

// ---- 2D convex helpers for the axial (cylindrical) case ----

const area2 = (poly: P2[]) => {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % poly.length]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

/** Keep the part of `poly` where f(p) ≥ 0 (f affine). */
function clipHalf(poly: P2[], f: (p: P2) => number): P2[] {
  const out: P2[] = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const fp = f(p)
    const fq = f(q)
    if (fp >= 0) out.push(p)
    if ((fp >= 0) !== (fq >= 0)) {
      const s = fp / (fp - fq)
      out.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s])
    }
  }
  return out
}

/** Area of the intersection of two convex polygons (Sutherland–Hodgman). */
function overlapArea(a: P2[], b: P2[]): number {
  const clip = area2(b) >= 0 ? b : [...b].reverse()
  let out = a
  for (let i = 0; i < clip.length && out.length >= 3; i++) {
    const [x0, y0] = clip[i]
    const [x1, y1] = clip[(i + 1) % clip.length]
    out = clipHalf(out, ([x, y]) => (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0))
  }
  return out.length >= 3 ? Math.abs(area2(out)) : 0
}

const boxOf = (poly: P2[]): Part['box'] => {
  const xs = poly.map(p => p[0])
  const ys = poly.map(p => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
const boxesMeet = (a: Part['box'], b: Part['box']) =>
  a[0] < b[2] - EPS && b[0] < a[2] - EPS && a[1] < b[3] - EPS && b[1] < a[3] - EPS

type AxisFrame = { o: Vec3; a: Vec3; u: Vec3 }

function axisFrame(axis: Line): AxisFrame {
  const l = Math.hypot(axis.vector[0], axis.vector[1])
  const a: Vec3 = [axis.vector[0] / l, axis.vector[1] / l, 0]
  // u = z × a (left of the axis); θ = 0 along u, θ = 90° along +z, so a
  // right-hand rotation about a by φ adds φ to θ.
  return { o: [axis.origin[0], axis.origin[1], 0], a, u: [-a[1], a[0], 0] }
}

/** Cylindrical parts of an axial triangle, or null if its plane misses the axis. */
function axialParts(tri: Tri, ax: AxisFrame): Part[] | null {
  const n = unitNormal(tri.p)
  if (!n) return []
  const off = dot3(n, sub3(ax.o, tri.p[0]))
  if (Math.abs(off) > EPS || Math.abs(dot3(n, ax.a)) > EPS) return null
  const tq = tri.p.map(p => {
    const rel = sub3(p, ax.o)
    const t = dot3(rel, ax.a)
    const q: Vec3 = [rel[0] - ax.a[0] * t, rel[1] - ax.a[1] * t, rel[2] - ax.a[2] * t]
    return { t, q }
  })
  const far = tq.reduce((m, x) => (norm3(x.q) > norm3(m.q) ? x : m))
  const r = norm3(far.q)
  if (r < EPS) return []
  const e: Vec3 = [far.q[0] / r, far.q[1] / r, far.q[2] / r]
  const theta = (Math.atan2(e[2], dot3(e, ax.u)) * 180) / Math.PI
  const poly: P2[] = tq.map(({ t, q }) => [t, dot3(q, e)])
  const parts: Part[] = []
  for (const [side, th] of [[1, theta], [-1, theta + 180]] as const) {
    const half = clipHalf(poly, p => side * p[1]).map(([t, w]) => [t, side * w] as P2)
    if (half.length >= 3 && Math.abs(area2(half)) > AREA_EPS)
      parts.push({ face: tri.face, theta: mod360(th), poly: half, box: boxOf(half) })
  }
  return parts
}

function triangles(frame: Frame, face: number, m: ReturnType<typeof treePoses>[number]): Tri[] {
  const vs = frame.faces_vertices[face]
  const pts = vs.map(v => transform(m, [frame.vertices_coords[v][0], frame.vertices_coords[v][1], 0]))
  const out: Tri[] = []
  for (let i = 1; i + 1 < pts.length; i++) out.push({ face, p: [pts[0], pts[i], pts[i + 1]] })
  return out
}

type Box3 = [number, number, number, number, number, number]
function box3(t: Tri['p']): Box3 {
  return [
    Math.min(t[0][0], t[1][0], t[2][0]), Math.min(t[0][1], t[1][1], t[2][1]), Math.min(t[0][2], t[1][2], t[2][2]),
    Math.max(t[0][0], t[1][0], t[2][0]), Math.max(t[0][1], t[1][1], t[2][1]), Math.max(t[0][2], t[1][2], t[2][2]),
  ]
}
const boxes3Meet = (a: Box3, b: Box3) =>
  a[0] <= b[3] + EPS && b[0] <= a[3] + EPS && a[1] <= b[4] + EPS && b[1] <= a[4] + EPS && a[2] <= b[5] + EPS && b[2] <= a[5] + EPS

const isFlat = (frame: Frame) =>
  frame.edges_foldAngle.every(a => Math.abs(a) < 1e-6 || Math.abs(Math.abs(a) - 180) < 1e-6)

/** "f is above g" (world +z) by the layer order, transitively; null if unrelated. */
function layerRelation(frame: Frame) {
  let below: Map<number, number[]> | null = null
  const memo = new Map<number, Set<number>>()
  const under = (f: number) => {
    let s = memo.get(f)
    if (s) return s
    below ??= aboveGraph(frame)
    s = new Set<number>()
    const stack = [...(below.get(f) ?? [])]
    while (stack.length) {
      const x = stack.pop()!
      if (s.has(x) || x === f) continue
      s.add(x)
      stack.push(...(below.get(x) ?? []))
    }
    memo.set(f, s)
    return s
  }
  return (f: number, g: number): boolean | null => (under(f).has(g) ? true : under(g).has(f) ? false : null)
}

export function sweep(
  frame: Frame,
  swing: { faces: number[]; axis: Line },
  fromDeg: number,
  toDeg: number,
): { freeDeg: number; blocked: boolean } {
  const span = Math.abs(toDeg - fromDeg)
  if (span < ANG_EPS) return { freeDeg: toDeg, blocked: false }
  const dir = Math.sign(toDeg - fromDeg)
  const moving = new Set(swing.faces)
  const tree = treePoses(frame)
  const start = swingRigid(swing.axis, fromDeg)
  const ax = axisFrame(swing.axis)

  const movTris: Tri[] = []
  const statTris: Tri[] = []
  tree.forEach((m, f) => {
    if (moving.has(f)) movTris.push(...triangles(frame, f, compose(start, m)))
    else statTris.push(...triangles(frame, f, m))
  })
  const classify = (ts: Tri[]) => {
    const axial: Part[] = []
    const other: Tri[] = []
    for (const t of ts) {
      const parts = axialParts(t, ax)
      if (parts) axial.push(...parts)
      else other.push(t)
    }
    return { axial, other }
  }
  const mov = classify(movTris)
  const stat = classify(statTris)

  // progress (degrees travelled from fromDeg) at which the first collision occurs
  let hit = Infinity

  // 1. axial × axial: exact
  const orderKnown = isFlat(frame) && Math.abs(fromDeg) < ANG_EPS
  const above = orderKnown ? layerRelation(frame) : null
  for (const pm of mov.axial)
    for (const ps of stat.axial) {
      if (!boxesMeet(pm.box, ps.box) || overlapArea(pm.poly, ps.poly) <= AREA_EPS) continue
      const delta = dir > 0 ? mod360(ps.theta - pm.theta) : mod360(pm.theta - ps.theta)
      if (delta < ANG_EPS || delta > 360 - ANG_EPS) {
        if (!above) continue
        // in the z = 0 plane (θ ≈ 0 or 180), increasing θ moves +z at θ = 0, −z at θ = 180
        const thetaZero = pm.theta < 90 || pm.theta > 270
        const zdir = dir * (thetaZero ? 1 : -1)
        const staticAbove = above(ps.face, pm.face)
        if (staticAbove === null) continue
        if ((zdir > 0) === staticAbove) hit = 0
      } else if (delta < span - ANG_EPS) hit = Math.min(hit, delta)
    }

  // 2. pairs involving a non-axial triangle: sampled Möller tests
  const pairs: [number, Tri][] = []
  const statBoxes = statTris.map(t => box3(t.p))
  const nonAxialStat = new Set(stat.other)
  const nonAxialMov = new Set(mov.other)
  movTris.forEach((m, mi) => {
    statTris.forEach(s => {
      if (!nonAxialMov.has(m) && !nonAxialStat.has(s)) return
      if (trianglesPenetrate(m.p, s.p)) return // pre-existing contact: exempt
      pairs.push([mi, s])
    })
  })
  if (pairs.length && hit > 0) {
    // a per-sample AABB test prunes far-apart pairs before the Möller test
    const local = movTris.map(t => t.p)
    const statIdx = new Map(statTris.map((t, i) => [t, i]))
    const blockedAt = (progress: number) => {
      const r = swingRigid(swing.axis, dir * progress)
      const cache = new Map<number, Tri['p']>()
      for (const [mi, s] of pairs) {
        let p = cache.get(mi)
        if (!p) {
          p = local[mi].map(q => transform(r, q)) as Tri['p']
          cache.set(mi, p)
        }
        if (!boxes3Meet(box3(p), statBoxes[statIdx.get(s)!])) continue
        if (trianglesPenetrate(p, s.p)) return true
      }
      return false
    }
    const limit = Math.min(span, hit)
    const n = Math.max(1, Math.ceil(limit / STEP))
    let prev = 0
    for (let k = 1; k <= n; k++) {
      const a = (limit * k) / n
      if (blockedAt(a)) {
        let lo = prev
        let hi = a
        for (let i = 0; i < BISECT; i++) {
          const mid = (lo + hi) / 2
          if (blockedAt(mid)) hi = mid
          else lo = mid
        }
        hit = Math.min(hit, lo)
        break
      }
      prev = a
    }
  }

  if (hit === Infinity || hit >= span) return { freeDeg: toDeg, blocked: false }
  return { freeDeg: fromDeg + dir * hit, blocked: true }
}
