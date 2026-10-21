/*
 * Snap landmarks and point snapping (spec §5.3).
 *
 * Everything is in folded (world) space: the root-face-0 folded form from
 * `foldedCoords`, the space gestures use. For a frame with a non-flat fold that
 * form is a projection onto z = 0, so landmarks on raised flaps are where they
 * appear from above.
 *
 * Landmark kinds:
 *   - corner: a folded vertex on the paper boundary where the folded outline
 *     turns: its boundary edges are not straight through (a paper corner, or a
 *     boundary point folded back on itself, like the ends of a fold line).
 *     Interior paper is never a corner: a crease crossing that folds onto a
 *     corner of the model's outline (the paper centre of a square folded in
 *     quarters) is an intersection.
 *   - intersection: a crease–crease or crease–boundary crossing (creases being
 *     the non-boundary edges, V/M/F/U at any angle), including a crease's end
 *     on the boundary or on another crease.
 *   - midpoint: the midpoint of an edge (boundary or crease) in folded space.
 *   - edge: "points on edges and creases", the snap fallback. Not a point but a
 *     folded edge segment `seg`; snapping projects onto it. These are emitted
 *     only with `landmarks(frame, { edges: true })`, one per distinct folded
 *     segment, with `p` the segment's midpoint, so a fresh square's discrete
 *     landmarks are exactly its 4 corners and 4 midpoints.
 * Duplicates (within 1e-6) are removed, the higher-priority kind kept
 * (corner > intersection > midpoint). Results are cached per frame.
 *
 * `snapPoint(p, ls, radius)` takes the landmark within `radius` of highest
 * priority (corner > intersection > midpoint > edge), the nearest among equals,
 * and returns its point (for an edge, the nearest point on its segment);
 * `snapped` is that landmark (an edge's `p` is the projected point). With
 * nothing in range it returns the raw point and no `snapped`.
 * Landmarks are cached per frame and shared, so they are frozen (with their
 * points and segments); `landmarks()` returns a fresh array of them, and
 * `snapPoint`'s `p` is a fresh copy the caller may keep or change.
 */
import { cross, dot, sub } from './geometry'
import { foldedCoords } from './rabbit'
import type { Frame, Vec2 } from './types'

export type LandmarkKind = 'corner' | 'midpoint' | 'intersection' | 'edge'

export type Landmark = {
  p: Vec2
  kind: LandmarkKind
  /** For kind 'edge' only: the folded segment that snapping projects onto. */
  seg?: readonly [Vec2, Vec2]
}

const DEDUPE = 1e-6
const EPS = 1e-9
const RANK: Record<LandmarkKind, number> = { corner: 0, intersection: 1, midpoint: 2, edge: 3 }

const isBoundary = (a: string) => a === 'B' || a === 'b'
const near = (a: Vec2, b: Vec2, eps = DEDUPE) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps
const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

const cache = new WeakMap<Frame, { points: Landmark[]; edges: Landmark[] }>()

export function landmarks(frame: Frame, opts: { edges?: boolean } = {}): Landmark[] {
  let hit = cache.get(frame)
  if (!hit) {
    hit = compute(frame)
    cache.set(frame, hit)
  }
  return opts.edges ? [...hit.points, ...hit.edges] : [...hit.points]
}

function compute(frame: Frame): { points: Landmark[]; edges: Landmark[] } {
  const coords = foldedCoords(frame)
  const segs = frame.edges_vertices
    .map(([u, v], e) => ({ a: coords[u], b: coords[v], boundary: isBoundary(frame.edges_assignment[e]) }))
    .filter(s => !near(s.a, s.b, EPS))

  const points: Landmark[] = []
  const add = (p: Vec2, kind: LandmarkKind) => {
    const i = points.findIndex(l => near(l.p, p))
    if (i < 0) points.push({ p, kind })
    else if (RANK[kind] < RANK[points[i].kind]) points[i] = { p: points[i].p, kind }
  }

  // corners: boundary vertices where the folded outline is not straight through
  const boundaryAt = frame.vertices_coords.map(() => [] as number[])
  frame.edges_vertices.forEach(([u, v], e) => {
    if (!isBoundary(frame.edges_assignment[e])) return
    boundaryAt[u].push(v)
    boundaryAt[v].push(u)
  })
  boundaryAt.forEach((ns, v) => {
    if (ns.length === 0) return
    if (ns.length !== 2) return add(coords[v], 'corner')
    const d0 = sub(coords[v], coords[ns[0]])
    const d1 = sub(coords[ns[1]], coords[v])
    const l = Math.hypot(...d0) * Math.hypot(...d1)
    if (l < EPS) return add(coords[v], 'corner')
    const straight = Math.abs(cross(d0, d1)) <= 1e-9 * l && dot(d0, d1) > 0
    if (!straight) add(coords[v], 'corner')
  })

  // intersections: crease–crease and crease–boundary crossings
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].boundary && segs[j].boundary) continue
      const x = crossing(segs[i].a, segs[i].b, segs[j].a, segs[j].b)
      if (x) add(x, 'intersection')
    }

  // midpoints of every folded edge
  for (const s of segs) add(mid(s.a, s.b), 'midpoint')

  // edges: one per distinct folded segment
  const edges: Landmark[] = []
  for (const s of segs) {
    const same = edges.some(l => {
      const [a, b] = l.seg!
      return (near(a, s.a) && near(b, s.b)) || (near(a, s.b) && near(b, s.a))
    })
    if (!same) edges.push({ p: mid(s.a, s.b), kind: 'edge', seg: [s.a, s.b] })
  }
  return { points: points.map(freeze), edges: edges.map(freeze) }
}

/** Cached landmarks are shared by every caller: freeze them, points and segments included. */
function freeze(l: Landmark): Landmark {
  Object.freeze(l.p)
  if (l.seg) {
    Object.freeze(l.seg[0])
    Object.freeze(l.seg[1])
    Object.freeze(l.seg)
  }
  return Object.freeze(l)
}

/** The crossing point of segments ab and cd (endpoints included); null if parallel or apart. */
function crossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = sub(b, a)
  const s = sub(d, c)
  const denom = cross(r, s)
  const scaleRS = Math.hypot(...r) * Math.hypot(...s)
  if (Math.abs(denom) <= 1e-12 * scaleRS) return null // parallel or collinear: shared ends come from other crossings
  const w = sub(c, a)
  const t = cross(w, s) / denom
  const u = cross(w, r) / denom
  const tolT = DEDUPE / Math.hypot(...r)
  const tolU = DEDUPE / Math.hypot(...s)
  if (t < -tolT || t > 1 + tolT || u < -tolU || u > 1 + tolU) return null
  return [a[0] + r[0] * t, a[1] + r[1] * t]
}

/** The nearest point to `p` on segment ab. */
function project(p: Vec2, [a, b]: readonly [Vec2, Vec2]): Vec2 {
  const ab = sub(b, a)
  const len2 = dot(ab, ab)
  if (len2 <= EPS * EPS) return a
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2))
  return [a[0] + ab[0] * t, a[1] + ab[1] * t]
}

export function snapPoint(p: Vec2, ls: readonly Landmark[], radius: number): { p: Vec2; snapped?: Landmark } {
  let best: { q: Vec2; d: number; l: Landmark } | null = null
  for (const l of ls) {
    const q = l.kind === 'edge' && l.seg ? project(p, l.seg) : l.p
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (!(d <= radius)) continue
    if (!best || RANK[l.kind] < RANK[best.l.kind] || (RANK[l.kind] === RANK[best.l.kind] && d < best.d)) best = { q, d, l }
  }
  if (!best) return { p }
  const q: Vec2 = [best.q[0], best.q[1]]
  const snapped: Landmark = best.l.kind === 'edge' ? freeze({ ...best.l, p: [q[0], q[1]] }) : best.l
  return { p: q, snapped }
}
