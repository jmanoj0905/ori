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
 * Caching (drag performance): everything that does not depend on `toDeg` —
 * triangulation, axial classification, per-direction start-stack verdict and
 * earliest axial contact angle, the sampled pair list with its start-contact
 * exemptions — is computed once per (frame object, swing faces, axis,
 * fromDeg) and kept in a WeakMap keyed by the (immutable) frame. A drag, in
 * which only toDeg changes, then costs a comparison for flat models, plus the
 * per-call sampling for 3D pairs.
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
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of poly) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
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
  // the point farthest from the axis (the first of equals, as a reduce would pick)
  let far = tq[0]!
  let r = norm3(far.q)
  for (let i = 1; i < tq.length; i++) {
    const d = norm3(tq[i]!.q)
    if (d > r) {
      far = tq[i]!
      r = d
    }
  }
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

const relationCache = new WeakMap<Frame, (f: number, g: number) => boolean | null>()

/**
 * "f is above g" (world +z) by the layer order, transitively; null if unrelated. Cached per frame.
 *
 * Both answers are read from closures of `g` alone: f is above g iff f is
 * reachable upward from g (f ∈ over(g)), below it iff reachable downward
 * (f ∈ under(g)); "above" wins when both hold (only possible on a cycle of
 * inconsistent orders). The sweep always asks with g = a moving face, so only
 * the few moving faces' closures are ever built, not one per static face.
 * under(g) is built first: when it holds f and g is on no cycle, f cannot also
 * be above g, so the answer is "below" without the upward closure (which needs
 * the whole reversed graph). On a deep stack that was most of a drag's preview.
 */
type Closure = { mark: Uint8Array; cyclic: boolean }

function layerRelation(frame: Frame) {
  const hit = relationCache.get(frame)
  if (hit) return hit
  const n = frame.faces_vertices.length
  let below: Map<number, number[]> | null = null
  let aboveOf: number[][] | null = null
  const downMemo = new Map<number, Closure>()
  const upMemo = new Map<number, Closure>()
  const inRange = (x: number) => x >= 0 && x < n
  /** Every face other than `f` reachable from `f` (marked); `cyclic`: `f` reaches itself. */
  const closure = (f: number, next: (x: number) => readonly number[] | undefined): Closure => {
    const mark = new Uint8Array(n)
    let cyclic = false
    const stack = [...(next(f) ?? [])]
    while (stack.length) {
      const x = stack.pop()!
      if (x === f) {
        cyclic = true
        continue
      }
      if (!inRange(x) || mark[x]) continue
      mark[x] = 1
      const ys = next(x)
      if (ys) for (const y of ys) stack.push(y)
    }
    return { mark, cyclic }
  }
  const under = (g: number) => {
    let c = downMemo.get(g)
    if (!c) {
      const b = (below ??= aboveGraph(frame))
      downMemo.set(g, (c = closure(g, x => b.get(x))))
    }
    return c
  }
  const over = (g: number) => {
    let c = upMemo.get(g)
    if (!c) {
      if (!aboveOf) {
        below ??= aboveGraph(frame)
        const up: number[][] = Array.from({ length: n }, () => [])
        for (const [top, bottoms] of below) for (const b of bottoms) if (inRange(b)) up[b]!.push(top)
        aboveOf = up
      }
      const a = aboveOf
      upMemo.set(g, (c = closure(g, x => (inRange(x) ? a[x] : undefined))))
    }
    return c
  }
  const rel = (f: number, g: number): boolean | null => {
    const down = under(g)
    const isBelow = inRange(f) && down.mark[f] === 1
    if (isBelow && !down.cyclic) return false
    const isAbove = inRange(f) && over(g).mark[f] === 1
    return isAbove ? true : isBelow ? false : null
  }
  relationCache.set(frame, rel)
  return rel
}

/** Distance from the origin to a 2D triangle (0 if it contains the origin). */
function originDistance(a: P2, b: P2, c: P2): number {
  const side = (p: P2, q: P2) => p[0] * q[1] - p[1] * q[0] // sign of origin relative to p→q
  const s1 = side(a, b)
  const s2 = side(b, c)
  const s3 = side(c, a)
  if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) {
    // inside, or a degenerate triangle: fall through to segments only when degenerate
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (Math.abs(area) > EPS * EPS) return 0
  }
  const seg = (p: P2, q: P2) => {
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(p[0] * dx + p[1] * dy) / l2)) : 0
    return Math.hypot(p[0] + dx * t, p[1] + dy * t)
  }
  return Math.min(seg(a, b), seg(b, c), seg(c, a))
}

/** Cylindrical bounds of a triangle about the axis: t-range and radial range. */
function cylBounds(t: Tri['p'], ax: AxisFrame) {
  const proj = t.map(p => {
    const rel = sub3(p, ax.o)
    return { t: dot3(rel, ax.a), q: [dot3(rel, ax.u), rel[2]] as P2 }
  })
  const ts = proj.map(x => x.t)
  return {
    tmin: Math.min(...ts),
    tmax: Math.max(...ts),
    rmax: Math.max(...proj.map(x => Math.hypot(x.q[0], x.q[1]))),
    rmin: originDistance(proj[0].q, proj[1].q, proj[2].q),
  }
}

/**
 * Everything about a sweep that depends only on (frame, swing faces, axis,
 * fromDeg) — not on toDeg — so a drag (where only toDeg changes) reuses it.
 */
type Analysis = {
  ax: AxisFrame
  movAxial: Part[]
  statAxial: Part[]
  above: ((f: number, g: number) => boolean | null) | null
  /** per direction (+1 / −1): blocked at the start, and the earliest axial contact angle */
  dirs: Map<string, { startBlocked: boolean; minDelta: number }>
  /** sampled-class data, built lazily */
  sampled?: { local: Tri['p'][]; statP: Tri['p'][]; statBoxes: Box3[]; pairs: [number, number][] }
  movTris: Tri[]
  statTris: Tri[]
  movOther: Set<Tri>
  statOther: Set<Tri>
}

const analysisCache = new WeakMap<Frame, Map<string, Analysis>>()
const CACHE_PER_FRAME = 16

function analyse(frame: Frame, swing: { faces: number[]; axis: Line }, fromDeg: number): Analysis {
  const key = `${[...swing.faces].sort((a, b) => a - b).join(',')}|${swing.axis.origin[0]},${swing.axis.origin[1]},${swing.axis.vector[0]},${swing.axis.vector[1]}|${fromDeg}`
  let byKey = analysisCache.get(frame)
  if (!byKey) analysisCache.set(frame, (byKey = new Map()))
  const hit = byKey.get(key)
  if (hit) return hit

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
    const other = new Set<Tri>()
    for (const t of ts) {
      const parts = axialParts(t, ax)
      if (parts) axial.push(...parts)
      else other.add(t)
    }
    return { axial, other }
  }
  const mov = classify(movTris)
  const stat = classify(statTris)
  const orderKnown = isFlat(frame) && Math.abs(fromDeg) < ANG_EPS
  const a: Analysis = {
    ax,
    movAxial: mov.axial,
    statAxial: stat.axial,
    above: orderKnown ? layerRelation(frame) : null,
    dirs: new Map(),
    movTris,
    statTris,
    movOther: mov.other,
    statOther: stat.other,
  }
  if (byKey.size >= CACHE_PER_FRAME) byKey.delete(byKey.keys().next().value!)
  byKey.set(key, a)
  return a
}

/** Static axial parts sorted by θ, for `axialFor` (built once per analysis). */
type ByTheta = {
  parts: Part[]
  thetas: number[]
  /** next[i]: the first index after i with a different θ; prev[i]: the last before i */
  next: Int32Array
  prev: Int32Array
}
const byThetaCache = new WeakMap<Analysis, ByTheta>()

function staticByTheta(an: Analysis): ByTheta {
  const hit = byThetaCache.get(an)
  if (hit) return hit
  const parts = [...an.statAxial].sort((a, b) => a.theta - b.theta)
  const thetas = parts.map(p => p.theta)
  const n = parts.length
  const next = new Int32Array(n)
  const prev = new Int32Array(n)
  for (let i = n - 1; i >= 0; i--) next[i] = i + 1 < n && thetas[i + 1] === thetas[i] ? next[i + 1] : i + 1
  for (let i = 0; i < n; i++) prev[i] = i > 0 && thetas[i - 1] === thetas[i] ? prev[i - 1] : i - 1
  const out = { parts, thetas, next, prev }
  byThetaCache.set(an, out)
  return out
}

/** First index whose θ is ≥ x (sorted ascending). */
function lowerBound(xs: number[], x: number): number {
  let lo = 0
  let hi = xs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (xs[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Half-width of the θ band around a moving part whose pairs are all tested (≫ ANG_EPS). */
const BAND = 1e-6

/**
 * Axial × axial analysis for one direction (exact; see class 1 above).
 *
 * The verdict is, over all (moving, static) part pairs: `startBlocked` iff
 * some pair stacked at the start (Δθ ≈ 0) departs into the static face and
 * overlaps it; else `minDelta`, the least Δθ (in the swing direction) of an
 * overlapping pair. Rather than test every pair, the static parts are sorted
 * by θ. For each moving part, the parts within BAND of its θ (every stacked
 * pair, and any near one) are tested one by one; the rest are scanned in two
 * runs over which the computed Δθ is non-decreasing (θ beyond pm's up to the
 * wrap, then from the wrap back toward pm's θ), each stopping at the first
 * Δθ above the best contact so far and skipping runs of equal θ at it: every
 * pair left out would fail the `delta >= minDelta` test anyway. The per-pair
 * arithmetic and tests are unchanged, so is the verdict.
 */
function axialFor(an: Analysis, dir: number, limit: number) {
  const key = `${dir}|${limit}`
  const cached = an.dirs.get(key)
  if (cached) return cached
  let startBlocked = false
  // Contacts at or beyond `limit` (less ANG_EPS) can't decide a sweep of at most
  // `limit` degrees (sweep only uses minDelta < span − ANG_EPS), so the search
  // starts there: a flap that lands flat (Δθ = 180) on a stack is not tested
  // against every layer it lands on. If nothing nearer is found minDelta stays
  // at that bound, which the caller reads as no contact, exactly as Infinity.
  let minDelta = limit - ANG_EPS
  const { parts, thetas, next, prev } = staticByTheta(an)
  const n = parts.length
  const inBand = new Uint8Array(n)
  const banded: number[] = []
  outer: for (const pm of an.movAxial) {
    // in the z = 0 plane (θ ≈ 0 or 180), increasing θ moves +z at θ = 0, −z at θ = 180
    const zUp = dir * (pm.theta < 90 || pm.theta > 270 ? 1 : -1) > 0
    const deltaOf = (ps: Part) => (dir > 0 ? mod360(ps.theta - pm.theta) : mod360(pm.theta - ps.theta))
    /** the original per-pair step; true = blocked at the start */
    const pair = (ps: Part, delta: number): boolean => {
      if (delta < ANG_EPS || delta > 360 - ANG_EPS) {
        // stacked at the start: only a pair that departs into the static face matters
        if (!an.above) return false
        // boxes first: a cheap, pure test, so most side-by-side pairs never query the layer order
        if (!boxesMeet(pm.box, ps.box)) return false
        const staticAbove = an.above(ps.face, pm.face)
        if (staticAbove === null || zUp !== staticAbove) return false
        return overlapArea(pm.poly, ps.poly) > AREA_EPS
      }
      // only a pair that would be the earliest contact so far needs its overlap tested
      if (delta >= minDelta) return false
      if (!boxesMeet(pm.box, ps.box) || overlapArea(pm.poly, ps.poly) <= AREA_EPS) return false
      minDelta = delta
      return false
    }
    // 1. the band around pm's θ (wrapping at 0/360)
    for (const off of [0, 360, -360]) {
      const lo = pm.theta + off - BAND
      const hi = pm.theta + off + BAND
      if (hi < 0 || lo >= 360) continue
      for (let i = lowerBound(thetas, lo); i < n && thetas[i] <= hi; i++) {
        if (inBand[i]) continue
        inBand[i] = 1
        banded.push(i)
        if (pair(parts[i], deltaOf(parts[i]))) {
          startBlocked = true
          break outer
        }
      }
    }
    // 2. two monotone runs (see above); `step` walks toward larger Δθ
    const up = lowerBound(thetas, pm.theta + BAND) // first θ past the band
    const down = lowerBound(thetas, pm.theta - BAND) - 1 // last θ before it
    const runs: [number, number, 1 | -1][] =
      dir > 0
        ? [[up, n, 1], [0, down + 1, 1]] // θ ascending to 360, then from 0
        : [[down, -1, -1], [n - 1, up - 1, -1]] // θ descending to 0, then from 360
    for (const [from, to, step] of runs) {
      for (let i = from; step > 0 ? i < to : i > to; ) {
        if (inBand[i]) {
          i += step
          continue
        }
        const delta = deltaOf(parts[i])
        if (delta > minDelta) break
        if (delta === minDelta) {
          // every part with this θ has this Δθ: none can improve on it
          i = step > 0 ? next[i] : prev[i]
          continue
        }
        if (pair(parts[i], delta)) {
          startBlocked = true
          break outer
        }
        i += step
      }
    }
    for (const i of banded) inBand[i] = 0
    banded.length = 0
  }
  const r = { startBlocked, minDelta }
  an.dirs.set(key, r)
  return r
}

/** Sampled-class pairs (any non-axial triangle), with the start-contact exemption applied. */
function sampledFor(an: Analysis) {
  if (an.sampled) return an.sampled
  const pairs: [number, number][] = []
  const statP = an.statTris.map(t => t.p)
  const statBoxes = statP.map(box3)
  if (an.movOther.size || an.statOther.size) {
    const statCyl = statP.map(p => cylBounds(p, an.ax))
    an.movTris.forEach((m, mi) => {
      const mAxial = !an.movOther.has(m)
      const mc = cylBounds(m.p, an.ax)
      const mb = box3(m.p)
      an.statTris.forEach((s, si) => {
        if (mAxial && !an.statOther.has(s)) return
        // sound prune: a moving point keeps its t and its distance from the axis
        const sc = statCyl[si]
        if (sc.tmax < mc.tmin - EPS || mc.tmax < sc.tmin - EPS || sc.rmin > mc.rmax + EPS) return
        // pre-existing contact is exempt; disjoint boxes can't be in contact (skip the Möller test)
        if (boxes3Meet(mb, statBoxes[si]) && trianglesPenetrate(m.p, s.p)) return
        pairs.push([mi, si])
      })
    })
  }
  an.sampled = { local: an.movTris.map(t => t.p), statP, statBoxes, pairs }
  return an.sampled
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
  const an = analyse(frame, swing, fromDeg)

  // progress (degrees travelled from fromDeg) at which the first collision occurs
  let hit = Infinity

  // 1. axial × axial: exact
  // Every real sweep spans at most 180° (a fold from flat): one cached analysis per
  // direction covers all of a drag's angles. Larger spans search without a bound.
  const axial = axialFor(an, dir, span <= 180 ? 180 : Infinity)
  if (axial.startBlocked) hit = 0
  else if (axial.minDelta < span - ANG_EPS) hit = axial.minDelta

  // 2. pairs involving a non-axial triangle: sampled Möller tests
  if (hit > 0) {
    const { local, statP, statBoxes, pairs } = sampledFor(an)
    if (pairs.length) {
      const blockedAt = (progress: number) => {
        const r = swingRigid(swing.axis, dir * progress)
        const moved = new Map<number, { p: Tri['p']; box: Box3 }>()
        for (const [mi, si] of pairs) {
          let m = moved.get(mi)
          if (!m) {
            const p = local[mi].map(q => transform(r, q)) as Tri['p']
            m = { p, box: box3(p) }
            moved.set(mi, m)
          }
          if (!boxes3Meet(m.box, statBoxes[si])) continue
          if (trianglesPenetrate(m.p, statP[si])) return true
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
  }

  if (hit === Infinity || hit >= span) return { freeDeg: toDeg, blocked: false }
  return { freeDeg: fromDeg + dir * hit, blocked: true }
}
