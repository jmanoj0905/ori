/*
 * Lesson step checking (spec 06 "On release, the result is checked against
 * the target frame"; ruling R70): `canonical(frame)` and `checkStep`.
 *
 * Frame ids and paper placement are not stable across frames: re-rooting
 * (ops.ts R10) may move all paper coordinates by a rigid motion, a mirror
 * included, and `turnOver` is exactly that mirror case. A mirror of paper
 * coordinates means the representation's "front" is the physical sheet's
 * back: the engine then swaps V ↔ M, reverses face windings and negates
 * faceOrders signs, so the physical state is unchanged. Face, vertex and edge
 * numbering also differ between equivalent frames.
 *
 * 1. Reference placement (corner identity). The blank sheet is
 *    `createPaper(w, h)`: vertices 0, 1, 2, 3 at (0,0), (w,0), (w,h), (0,h).
 *    The engine never renumbers vertices (re-rooting renumbers faces only;
 *    folds append new vertices and only ever remove degree-2 vertices on a
 *    straight boundary/crease run, never a corner), so in every frame that
 *    descends from a blank sheet vertices 0..3 are still the sheet's
 *    physical corners, wherever re-rooting has moved them. `placement`
 *    checks that (each is a corner of the outline built from the 'B' edges,
 *    and together they form a w × h rectangle) and maps paper coordinates
 *    back by T⁻¹: p ↦ ((p − c0)·u, (p − c0)·v) with u = (c1 − c0)/w,
 *    v = (c3 − c0)/h, so corner 0 returns to the origin and corner 1 to
 *    (w, 0). T is a mirror iff cross(u, v) < 0; then undoing it restores the
 *    original front, so V ↔ M are swapped back and faceOrders signs negated
 *    back (each reading records `mirrored`).
 *    Fallback (a frame not descended from a blank sheet, e.g. an imported
 *    FOLD file, where 0..3 aren't the corners): corner identity can't be
 *    recovered from one frame, so every placement mapping the outline's
 *    corners onto the reference rectangle is a candidate reading — exactly
 *    the motions re-rooting could have applied, each with its own V/M
 *    normalisation — and `checkStep` accepts if any candidate matches. On a
 *    rectangle those readings coincide with the rotational symmetries, so
 *    such frames are only checked up to them.
 * 2. Creases: every edge whose assignment is not B (boundary) or F (flat),
 *    in the reference placement. Collinear touching segments with the same
 *    assignment are merged into maximal segments (two equivalent frames may
 *    split one crease line at different vertices), endpoints ordered,
 *    quantised to `tol` and sorted. `flat` records a fully folded crease
 *    (|angle| ≈ 180°) so a partial fold doesn't pass for a flat one.
 * 3. Layers: faces are grouped into facets across F edges (flat edges
 *    subdivide coplanar paper without changing the model), each keyed by its
 *    area-weighted paper centroid in the reference placement. Each
 *    faceOrder [f, g, s] (f lies on the side of g's NORMAL, s = +1, i.e. g's
 *    paper front) is an INTRINSIC statement — independent of where the
 *    folded model lies in the world, which face is the root and which grab
 *    point made the fold — once s is taken relative to the original front
 *    (negated for a mirrored reading). It becomes (F, G, s) between facets,
 *    stored with F < G; swapping the pair maps s to −s·wF·wG (w = facet
 *    winding in the folded form, from the face poses), see `orient`.
 *    Comparing these relations is comparing the stacking of the folded
 *    state without sampling folded space at all.
 * 4. Symmetry (allowMirror): R70 treats `allowMirror` as "allow symmetric
 *    equivalents". The sheet's symmetries (square D4, rectangle D2) act on
 *    the reference placement; a physical mirror image of a fold keeps a
 *    valley a valley (seen from the front) and keeps every intrinsic order,
 *    so a symmetry moves coordinates only — unlike a mirrored re-rooting.
 *    Without allowMirror only the identity is tried.
 *
 * Turning over changes no crease and no intrinsic order, so a turned-over
 * model matches the same model before the turn (the caller decides whether a
 * turn over was the expected step).
 *
 * Comparison: creases are matched one-to-one within 2·tol per coordinate
 * (both sides quantised to tol, so values either side of a rounding boundary
 * still meet); facets are matched by centroid within the same tolerance and
 * the relations compared through that matching. Reason 'creases' if no
 * candidate reading matches the creases, else 'layers'.
 */
import { poses, type Frame, type Vec2 } from '@engine'

export type CanonicalCrease = { a: Vec2; b: Vec2; assignment: string; flat: boolean }
export type CanonicalFacet = { centroid: Vec2; winding: 1 | -1 }
/** [i, j, s] between facets i < j: s = +1 when facet i lies on facet j's front side. 0 = conflicting orders. */
export type CanonicalOrder = readonly [number, number, number]

export type CanonicalFrame = {
  size: { width: number; height: number }
  /** The reading undid a mirrored placement (V/M and order signs were normalised back). */
  mirrored: boolean
  /** Corner identity came from vertices 0..3 (false: the outline-only fallback). */
  cornersKnown: boolean
  creases: CanonicalCrease[]
  facets: CanonicalFacet[]
  layers: CanonicalOrder[]
}

export type CheckResult = { match: boolean; reason?: 'creases' | 'layers' }

export const DEFAULT_TOL = 1e-4

// ---- placement ----

/** Paper → reference placement: p ↦ ((p − o)·u, (p − o)·v). */
type Placement = { o: Vec2; u: Vec2; v: Vec2; width: number; height: number; mirrored: boolean; cornersKnown: boolean }

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
const len = (a: Vec2) => Math.hypot(a[0], a[1])
const near = (a: Vec2, b: Vec2, eps: number) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps
const isB = (a: string) => a.toUpperCase() === 'B'
const isF = (a: string) => a.toUpperCase() === 'F'

const apply = (p: Placement, q: Vec2): Vec2 => {
  const d = sub(q, p.o)
  return [dot(d, p.u), dot(d, p.v)]
}

/** The outline's corners: vertices with two boundary edges that aren't collinear. */
function outlineCorners(f: Frame): Map<number, number[]> {
  const ns = new Map<number, number[]>()
  f.edges_vertices.forEach(([a, b], e) => {
    if (!isB(f.edges_assignment[e] ?? '')) return
    ns.set(a, [...(ns.get(a) ?? []), b])
    ns.set(b, [...(ns.get(b) ?? []), a])
  })
  const P = f.vertices_coords
  const out = new Map<number, number[]>()
  for (const [v, n] of ns) {
    if (n.length !== 2) continue
    const da = sub(P[n[0]], P[v])
    const db = sub(P[n[1]], P[v])
    // a real corner turns by 90°; drift on a straight boundary run turns by ~nothing
    if (Math.abs(cross(da, db)) > 1e-3 * len(da) * len(db)) out.set(v, n)
  }
  return out
}

const fromCorners = (c0: Vec2, c1: Vec2, c3: Vec2, cornersKnown: boolean): Placement => {
  const width = len(sub(c1, c0))
  const height = len(sub(c3, c0))
  const u: Vec2 = [(c1[0] - c0[0]) / width, (c1[1] - c0[1]) / width]
  const v: Vec2 = [(c3[0] - c0[0]) / height, (c3[1] - c0[1]) / height]
  return { o: c0, u, v, width, height, mirrored: cross(u, v) < 0, cornersKnown }
}

/** Is c0 → c1 → c2 → c3 a rectangle (either orientation)? */
function rectangle(c: Vec2[], eps: number): boolean {
  const [c0, c1, c2, c3] = c
  const a = sub(c1, c0)
  const b = sub(c3, c0)
  return len(a) > eps && len(b) > eps && Math.abs(dot(a, b)) <= eps * len(a) * len(b) && near([c1[0] + b[0], c1[1] + b[1]], c2, eps)
}

/**
 * Candidate readings of `f` in the reference placement: one when vertices
 * 0..3 are the sheet's corners (the engine case), else every placement of
 * the outline's four corners (see the header, 1).
 */
function placements(f: Frame): Placement[] {
  const P = f.vertices_coords
  const corners = outlineCorners(f)
  const eps = 1e-5 // well above coordinate drift, far below any real fold
  if (P.length >= 4 && [0, 1, 2, 3].every(v => corners.has(v))) {
    const c = [0, 1, 2, 3].map(i => P[i])
    if (rectangle(c, eps)) return [fromCorners(c[0], c[1], c[3], true)]
  }
  // fallback: walk the outline's 4 corners in boundary order
  const ids = [...corners.keys()]
  if (ids.length !== 4) throw new Error('canonical: the sheet outline is not a rectangle')
  const cs = ids.map(i => P[i])
  const centre: Vec2 = [cs.reduce((s, p) => s + p[0], 0) / 4, cs.reduce((s, p) => s + p[1], 0) / 4]
  const ring = [...cs].sort((p, q) => Math.atan2(p[1] - centre[1], p[0] - centre[0]) - Math.atan2(q[1] - centre[1], q[0] - centre[0]))
  if (!rectangle(ring, eps)) throw new Error('canonical: the sheet outline is not a rectangle')
  const out: Placement[] = []
  for (let i = 0; i < 4; i++)
    for (const dir of [1, -1]) {
      const c0 = ring[i]
      const c1 = ring[(i + dir + 4) % 4]
      const c3 = ring[(i - dir + 4) % 4]
      out.push(fromCorners(c0, c1, c3, false))
    }
  return out
}

// ---- a reading: creases, facets, orders in one placement (unquantised) ----

type Seg = { a: Vec2; b: Vec2; assignment: string; flat: boolean }
type Reading = { place: Placement; segs: Seg[]; facets: CanonicalFacet[]; orders: Map<string, number> }

const SWAP: Record<string, string> = { V: 'M', M: 'V' }

/** Merge collinear, touching segments of one assignment into maximal segments. */
function mergeSegments(segs: Seg[], tol: number): Seg[] {
  type Item = Seg & { dir: Vec2; off: number; t0: number; t1: number }
  const items: Item[] = segs.map(s => {
    let d = sub(s.b, s.a)
    const l = len(d)
    d = [d[0] / l, d[1] / l]
    if (d[0] < -1e-12 || (Math.abs(d[0]) <= 1e-12 && d[1] < 0)) d = [-d[0], -d[1]]
    const ta = dot(s.a, d)
    const tb = dot(s.b, d)
    return { ...s, dir: d, off: cross(d, s.a), t0: Math.min(ta, tb), t1: Math.max(ta, tb) }
  })
  // longest first: each group's line is taken from its longest (best-conditioned) piece
  items.sort((x, y) => y.t1 - y.t0 - (x.t1 - x.t0))
  const used = new Array<boolean>(items.length).fill(false)
  const out: Seg[] = []
  for (let i = 0; i < items.length; i++) {
    if (used[i]) continue
    used[i] = true
    const s = items[i]
    const group = [s]
    for (let j = i + 1; j < items.length; j++) {
      const t = items[j]
      if (used[j] || t.assignment !== s.assignment || t.flat !== s.flat) continue
      // on s's line: both endpoints within tol of it (a direction test would reject short drifting pieces)
      if (Math.abs(cross(s.dir, t.a) - s.off) > tol || Math.abs(cross(s.dir, t.b) - s.off) > tol) continue
      used[j] = true
      group.push(t)
    }
    // parameters along s's line
    const span = (t: Item) => {
      const a = dot(t.a, s.dir)
      const b = dot(t.b, s.dir)
      return { t0: Math.min(a, b), t1: Math.max(a, b) }
    }
    const spans = group.map(span).sort((x, y) => x.t0 - y.t0)
    let lo = spans[0].t0
    let hi = spans[0].t1
    const emit = () => {
      // points on the line: off · n + t · d with n = (−d.y, d.x) (cross(d, p) = off)
      const n: Vec2 = [-s.dir[1], s.dir[0]]
      const at = (t: number): Vec2 => [s.off * n[0] + t * s.dir[0], s.off * n[1] + t * s.dir[1]]
      out.push({ a: at(lo), b: at(hi), assignment: s.assignment, flat: s.flat })
    }
    for (const t of spans.slice(1)) {
      if (t.t0 <= hi + tol) hi = Math.max(hi, t.t1)
      else {
        emit()
        lo = t.t0
        hi = t.t1
      }
    }
    emit()
  }
  return out
}

function polygonCentroid(pts: Vec2[]): { area: number; c: Vec2 } {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const k = p[0] * q[1] - q[0] * p[1]
    a += k
    cx += (p[0] + q[0]) * k
    cy += (p[1] + q[1]) * k
  }
  if (Math.abs(a) < 1e-15) {
    const m: Vec2 = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
    return { area: 0, c: m }
  }
  return { area: Math.abs(a) / 2, c: [cx / (3 * a), cy / (3 * a)] }
}

const pairKey = (i: number, j: number) => `${i}|${j}`

/** (F, G, s) stored with F < G; swapping maps s to −s·wF·wG. */
function orient(F: number, G: number, s: number, w: readonly number[]): [number, number, number] {
  return F < G ? [F, G, s] : [G, F, -s * w[F] * w[G]]
}

function addOrder(orders: Map<string, number>, [i, j, s]: [number, number, number]) {
  const k = pairKey(i, j)
  const old = orders.get(k)
  orders.set(k, old === undefined || old === s ? s : 0)
}

function reading(f: Frame, place: Placement, tol: number): Reading {
  const P = f.vertices_coords.map(q => apply(place, q))
  const flip = place.mirrored

  // creases
  const raw: Seg[] = []
  f.edges_vertices.forEach(([u, v], e) => {
    const asg = (f.edges_assignment[e] ?? '').toUpperCase()
    if (asg === 'B' || asg === 'F') return
    if (len(sub(P[u], P[v])) <= tol) return
    raw.push({
      a: P[u],
      b: P[v],
      assignment: flip ? (SWAP[asg] ?? asg) : asg,
      flat: Math.abs(Math.abs(f.edges_foldAngle[e] ?? 0) - 180) < 1e-3,
    })
  })
  const segs = mergeSegments(raw, tol)

  // facets: faces joined across F edges (union-find)
  const n = f.faces_vertices.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const flatEdges = new Set<string>()
  f.edges_vertices.forEach(([u, v], e) => {
    if (isF(f.edges_assignment[e] ?? '')) flatEdges.add(u < v ? `${u},${v}` : `${v},${u}`)
  })
  const byEdge = new Map<string, number>()
  f.faces_vertices.forEach((vs, face) => {
    vs.forEach((u, i) => {
      const v = vs[(i + 1) % vs.length]
      const k = u < v ? `${u},${v}` : `${v},${u}`
      if (!flatEdges.has(k)) return
      const other = byEdge.get(k)
      if (other === undefined) byEdge.set(k, face)
      else parent[find(face)] = find(other)
    })
  })
  const ps = poses(f)
  const faceWinding = ps.map(p => (p.matrix[0] * p.matrix[5] - p.matrix[1] * p.matrix[4] >= 0 ? 1 : -1))
  const roots = [...new Set(parent.map((_, i) => find(i)))].sort((a, b) => a - b)
  const facetOf = new Array<number>(n)
  for (let i = 0; i < n; i++) facetOf[i] = roots.indexOf(find(i))
  const acc = roots.map(() => ({ a: 0, x: 0, y: 0, w: 0 as number }))
  f.faces_vertices.forEach((vs, face) => {
    const { area, c } = polygonCentroid(vs.map(v => P[v]))
    const t = acc[facetOf[face]]
    const wt = area > 0 ? area : 1e-12
    t.a += wt
    t.x += c[0] * wt
    t.y += c[1] * wt
    t.w = faceWinding[face]
  })
  const facets: CanonicalFacet[] = acc.map(t => ({ centroid: [t.x / t.a, t.y / t.a], winding: t.w >= 0 ? 1 : -1 }))
  const w = facets.map(x => x.winding)

  // intrinsic orders between facets, s relative to the ORIGINAL front
  const orders = new Map<string, number>()
  for (const [a, b, s] of f.faceOrders) {
    const F = facetOf[a]
    const G = facetOf[b]
    if (F === undefined || G === undefined || F === G) continue
    addOrder(orders, orient(F, G, flip ? -s : s, w))
  }
  return { place, segs, facets, orders }
}

// ---- symmetries of the reference rectangle ----

type Sym = (p: Vec2) => Vec2

function symmetries(width: number, height: number, tol: number): Sym[] {
  const W = width
  const H = height
  const d2: Sym[] = [p => p, p => [W - p[0], p[1]], p => [p[0], H - p[1]], p => [W - p[0], H - p[1]]]
  if (Math.abs(W - H) > tol) return d2
  return [...d2, p => [p[1], p[0]], p => [W - p[1], p[0]], p => [p[1], W - p[0]], p => [W - p[1], W - p[0]]]
}

// ---- quantised output ----

const q = (x: number, tol: number) => {
  const r = Math.round(x / tol) * tol
  const d = Math.round(-Math.log10(tol)) + 2
  const out = Number(r.toFixed(Math.max(0, Math.min(20, d))))
  return out === 0 ? 0 : out
}
const qp = (p: Vec2, tol: number): Vec2 => [q(p[0], tol), q(p[1], tol)]
const lexi = (a: Vec2, b: Vec2) => a[0] - b[0] || a[1] - b[1]

function quantised(r: Reading, tol: number, g: Sym = p => p): CanonicalFrame {
  const creases = r.segs
    .map(s => {
      const a = qp(g(s.a), tol)
      const b = qp(g(s.b), tol)
      return lexi(a, b) <= 0 ? { a, b, assignment: s.assignment, flat: s.flat } : { a: b, b: a, assignment: s.assignment, flat: s.flat }
    })
    .sort((x, y) => lexi(x.a, y.a) || lexi(x.b, y.b) || x.assignment.localeCompare(y.assignment) || Number(x.flat) - Number(y.flat))
  const moved = r.facets.map(f => ({ centroid: qp(g(f.centroid), tol), winding: f.winding }))
  const order = moved.map((_, i) => i).sort((i, j) => lexi(moved[i].centroid, moved[j].centroid))
  const rank = new Array<number>(order.length)
  order.forEach((old, i) => (rank[old] = i))
  const facets = order.map(i => moved[i])
  const w = facets.map(f => f.winding)
  const layers: CanonicalOrder[] = []
  for (const [k, s] of r.orders) {
    const [i, j] = k.split('|').map(Number)
    layers.push(orient(rank[i], rank[j], s, w))
  }
  layers.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  return { size: { width: r.place.width, height: r.place.height }, mirrored: r.place.mirrored, cornersKnown: r.place.cornersKnown, creases, facets, layers }
}

/**
 * The frame in the reference placement: sorted, quantised creases (with
 * assignment relative to the paper's front) and the intrinsic layer orders
 * between geometry-keyed facets. For a frame whose corners can't be
 * identified this is the first candidate reading.
 */
export function canonical(f: Frame, tol = DEFAULT_TOL): CanonicalFrame {
  return quantised(reading(f, placements(f)[0], tol), tol)
}

// ---- comparison ----

const close = (a: Vec2, b: Vec2, tol: number) => near(a, b, 2 * tol + 1e-12)

function creasesMatch(a: CanonicalCrease[], b: CanonicalCrease[], tol: number): boolean {
  if (a.length !== b.length) return false
  const used = new Array<boolean>(b.length).fill(false)
  return a.every(x => {
    const j = b.findIndex(
      (y, j) => !used[j] && y.assignment === x.assignment && y.flat === x.flat && close(x.a, y.a, tol) && close(x.b, y.b, tol),
    )
    if (j < 0) return false
    used[j] = true
    return true
  })
}

function layersMatch(a: CanonicalFrame, b: CanonicalFrame, tol: number): boolean {
  if (a.facets.length !== b.facets.length || a.layers.length !== b.layers.length) return false
  const map = new Array<number>(a.facets.length)
  const used = new Array<boolean>(b.facets.length).fill(false)
  for (let i = 0; i < a.facets.length; i++) {
    const j = b.facets.findIndex((y, j) => !used[j] && close(a.facets[i].centroid, y.centroid, tol))
    if (j < 0) return false
    used[j] = true
    map[i] = j
  }
  const want = new Map(b.layers.map(([i, j, s]) => [pairKey(i, j), s]))
  const w = a.facets.map(f => f.winding)
  return a.layers.every(([i, j, s]) => {
    // re-orient in a's windings, then express against b's facet ids
    const [x, y, t] = map[i] < map[j] ? [map[i], map[j], s] : [map[j], map[i], -s * w[i] * w[j]]
    return want.get(pairKey(x, y)) === t
  })
}

/**
 * Does `actual` (the learner's committed frame) match the lesson's `target`?
 * With `allowMirror` the sheet's symmetric equivalents (D4 square, D2
 * rectangle) are accepted too. `reason` says what differed first: the crease
 * pattern, or (with the creases right) the layer order.
 */
export function checkStep(actual: Frame, target: Frame, opts: { allowMirror: boolean }, tol = DEFAULT_TOL): CheckResult {
  const t = canonical(target, tol)
  let creasesOk = false
  for (const place of placements(actual)) {
    const r = reading(actual, place, tol)
    const syms = opts.allowMirror ? symmetries(place.width, place.height, tol) : [(p: Vec2) => p]
    for (const g of syms) {
      const a = quantised(r, tol, g)
      if (Math.abs(a.size.width - t.size.width) > tol || Math.abs(a.size.height - t.size.height) > tol) continue
      if (!creasesMatch(a.creases, t.creases, tol)) continue
      creasesOk = true
      if (layersMatch(a, t, tol)) return { match: true }
    }
  }
  return { match: false, reason: creasesOk ? 'layers' : 'creases' }
}
