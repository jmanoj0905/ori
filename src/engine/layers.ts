/*
 * Layers at a point and flap selection.
 *
 * Folded space is the root-face-0 folded form from `foldedCoords` (rabbit.ts),
 * viewed from +z: "top" is the layer nearest a viewer looking down at the
 * folded 2D coordinates.
 *
 * faceOrders convention (FOLD spec, confirmed against rabbit-ear 0.9.41
 * `faceOrdersToDirectedEdges` in module/graph/orders.js): `[f, g, s]` with
 * s = +1 means f lies on the side of g that g's NORMAL points to; s = −1 the
 * opposite side. g's normal in the folded form is +z when g is
 * counter-clockwise in folded coords (`windings(frame)[g] === true`), −z when
 * it was flipped by an odd number of folds. So in world terms:
 *
 *     f is above g  ⇔  s · (windings[g] ? +1 : −1) > 0
 *
 * Pinned by test: a valley fold of the right half over the left gives
 * faceOrders [[0, 1, +1]] with face 1 flipped (winding false) → face 1, the
 * moved half, is on top; the mountain fold gives [[0, 1, −1]] → it is beneath.
 */
import { layerOrders, foldedCoords, windings } from './rabbit'
import { cross, sub } from './geometry'
import type { Frame, Line, Refusal, Result, Vec2 } from './types'

const EPS = 1e-9

/** Point in a simple polygon (either orientation); boundary counts as inside. */
export function containsPoint(poly: readonly Vec2[], p: Vec2): boolean {
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const ab = sub(b, a)
    const ap = sub(p, a)
    const len2 = ab[0] * ab[0] + ab[1] * ab[1]
    if (len2 <= EPS * EPS) {
      // a zero-length side (e.g. a face seen edge-on in a projection) is just a point
      if (Math.hypot(ap[0], ap[1]) <= EPS) return true
      continue
    }
    if (Math.abs(cross(ab, ap)) <= EPS * Math.max(1, Math.sqrt(len2))) {
      const t = len2 > 0 ? (ap[0] * ab[0] + ap[1] * ab[1]) / len2 : 0
      if (t >= -EPS && t <= 1 + EPS) return true
    }
  }
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const aboveCache = new WeakMap<Frame, Map<number, number[]>>()

/**
 * above[f] = faces directly known to lie below f (world +z ordering).
 * Cached per frame (frames are immutable); treat the map as read-only (its
 * lists are frozen).
 */
export function aboveGraph(frame: Frame): Map<number, number[]> {
  const hit = aboveCache.get(frame)
  if (hit) return hit
  const w = windings(frame)
  // Lists are gathered per face id in a plain array (a drag previews a new
  // frame per pointer move, each with tens of thousands of orders on a deep
  // stack), then handed out as the map. Each list keeps faceOrders order.
  const lists: (number[] | undefined)[] = []
  const other = new Map<number, number[]>() // ids that aren't array indices (malformed orders)
  const add = (top: number, bottom: number) => {
    if (Number.isInteger(top) && top >= 0) {
      const list = lists[top]
      if (list) list.push(bottom)
      else lists[top] = [bottom]
    } else {
      const list = other.get(top)
      if (list) list.push(bottom)
      else other.set(top, [bottom])
    }
  }
  for (const [f, g, s] of frame.faceOrders) {
    if (s * (w[g] ? 1 : -1) > 0) add(f, g)
    else add(g, f)
  }
  const below = new Map<number, number[]>()
  lists.forEach((list, top) => list && below.set(top, Object.freeze(list) as number[]))
  for (const [top, list] of other) below.set(top, Object.freeze(list) as number[])
  aboveCache.set(frame, below)
  return below
}

/**
 * Per-face layer rank: `ranks[f]` is face f's place in one global stacking
 * order of the whole model, 0 = bottom … n−1 = top (world +z, as `layerAt`).
 * For a renderer offsetting each layer by ε × rank along its normal.
 *
 * The order is a topological sort of "is above" (`aboveGraph`, faceOrders
 * plus windings, so the rendered stack never needs the windings convention):
 * repeatedly the lowest-id face with nothing left directly above it is the
 * next one down. Whenever faceOrders decide two faces' order (directly or
 * through others), the face above has the higher rank; inconsistent orders
 * (a cycle) fall back to the lowest remaining id. Faces the orders don't
 * relate (side by side, or a partial frame's carried orders) still get
 * distinct ranks. `layerAt` sorts by these ranks, so the two always agree.
 * Cached per frame (frames are immutable); the array is frozen (read-only).
 * O((F + orders) log F): Kahn's algorithm with a min-heap of ready ids.
 */
export function layerRanks(frame: Frame): number[] {
  const hit = rankCache.get(frame)
  if (hit) return hit
  const n = frame.faces_vertices.length
  const below = aboveGraph(frame)
  const aboveCount = new Array<number>(n).fill(0)
  const edges: (number[] | undefined)[] = new Array(n)
  // Dedupe each face's list in first-seen order with a stamp array (no Set per
  // face: on a deep stack there are tens of thousands of orders per frame).
  const seen = new Int32Array(n)
  let stamp = 0
  for (const [top, bottoms] of below) {
    stamp++
    const uniq: number[] = []
    for (const b of bottoms) {
      if (b === top || !(b >= 0 && b < n) || seen[b] === stamp) continue
      seen[b] = stamp
      uniq.push(b)
    }
    if (Number.isInteger(top) && top >= 0 && top < n) edges[top] = uniq // only ever read for ids 0..n−1
    for (const b of uniq) aboveCount[b]++
  }
  const done = new Array<boolean>(n).fill(false)
  const ranks = new Array<number>(n)
  const ready = new MinHeap()
  for (let f = 0; f < n; f++) if (aboveCount[f] === 0) ready.push(f)
  let low = 0 // every id below `low` is done
  for (let placed = 0; placed < n; placed++) {
    let next = -1
    while (ready.size && next < 0) {
      const f = ready.pop()
      if (!done[f]) next = f
    }
    if (next < 0) {
      // a cycle: the lowest remaining id
      while (done[low]) low++
      next = low
    }
    done[next] = true
    ranks[next] = n - 1 - placed
    const bs = edges[next]
    if (bs) for (const b of bs) if (--aboveCount[b] === 0 && !done[b]) ready.push(b)
  }
  Object.freeze(ranks)
  rankCache.set(frame, ranks)
  return ranks
}

const rankCache = new WeakMap<Frame, number[]>()

/** A binary min-heap of integers. */
class MinHeap {
  private a: number[] = []
  get size() {
    return this.a.length
  }
  push(x: number) {
    const a = this.a
    let i = a.push(x) - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p] <= x) break
      a[i] = a[p]
      i = p
    }
    a[i] = x
  }
  pop(): number {
    const a = this.a
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= a.length) break
        const c = l + 1 < a.length && a[l + 1] < a[l] ? l + 1 : l
        if (a[c] >= last) break
        a[i] = a[c]
        i = c
      }
      a[i] = last
    }
    return top
  }
}

/** [minX, minY, maxX, maxY, margin]: margin bounds containsPoint's boundary tolerance outside the box. */
type Box = readonly [number, number, number, number, number]
const polyCache = new WeakMap<Frame, { polys: Vec2[][]; boxes: Box[] }>()

/** Each face's folded polygon and its bounding box, cached per frame. */
export function foldedPolygons(frame: Frame): { polys: Vec2[][]; boxes: Box[] } {
  const hit = polyCache.get(frame)
  if (hit) return hit
  const coords = foldedCoords(frame)
  const polys = frame.faces_vertices.map(vs => vs.map(v => coords[v]))
  const boxes = polys.map(poly => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    let m = EPS
    poly.forEach(([x, y], i) => {
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
      // containsPoint accepts points within EPS·max(1, len)/len of a side (plus EPS·len along it)
      const q = poly[(i + 1) % poly.length]
      const len = Math.hypot(q[0] - x, q[1] - y)
      if (len > EPS) m = Math.max(m, (EPS * Math.max(1, len)) / len + EPS * len)
    })
    return [x0, y0, x1, y1, 2 * m] as Box
  })
  const out = { polys, boxes }
  polyCache.set(frame, out)
  return out
}

/** Faces whose folded polygon contains `p` (boundary included), ascending. */
export function facesAt(frame: Frame, p: Vec2): number[] {
  const { polys, boxes } = foldedPolygons(frame)
  const out: number[] = []
  // the box (grown by the face's boundary tolerance) only skips faces containsPoint would reject
  for (let f = 0; f < polys.length; f++) {
    const b = boxes[f]
    const m = b[4]
    if (p[0] < b[0] - m || p[1] < b[1] - m || p[0] > b[2] + m || p[1] > b[3] + m) continue
    if (containsPoint(polys[f], p)) out.push(f)
  }
  return out
}

/**
 * Face ids under the folded-space point `p`, top to bottom: sorted by
 * `layerRanks` (so by faceOrders, including relations implied through faces
 * not under `p`; ties among unrelated faces resolve by the global order,
 * lowest id first where nothing else decides). A point on a boundary (vertex
 * or crease) shared by unordered faces therefore resolves deterministically.
 * The ranks are computed once per frame (cached), so a warm call is a
 * box-pruned point-in-polygon scan plus a sort of the faces at `p`.
 */
export function layerAt(frame: Frame, p: Vec2): number[] {
  const here = facesAt(frame, p)
  if (here.length < 2) return here
  const ranks = layerRanks(frame)
  return here.sort((a, b) => ranks[b] - ranks[a])
}

/**
 * The stack at `p` from the hit face `face` down (spec §5.1: the grab input
 * includes the hit face), or the whole of `layerAt(frame, p)` when `face` is
 * absent or isn't one of the faces there (ignored, not refused).
 */
export function stackFrom(frame: Frame, p: Vec2, face?: number): number[] {
  const stack = layerAt(frame, p)
  const i = face === undefined ? -1 : stack.indexOf(face)
  return i > 0 ? stack.slice(i) : stack
}

export type StackProfile = {
  /** `stackFrom(frame, p, face)`: top → bottom */
  faces: number[]
  /** Pairs of indices into `faces` joined by a shared non-boundary edge; `at` is that edge's folded midpoint. */
  joins: { upper: number; lower: number; at: Vec2 }[]
}

/**
 * The paper stack at `p` plus how its layers connect: two layers are joined
 * when their faces share a non-boundary edge (a fold or crease line), which
 * is where the side view draws the paper turning back on itself.
 */
export function stackProfile(frame: Frame, p: Vec2, face?: number): StackProfile {
  const faces = stackFrom(frame, p, face)
  const at = new Map(faces.map((f, i) => [f, i]))
  const { key, assignment, edgeFaces } = sideIndex(frame)
  const coords = foldedCoords(frame)
  const seen = new Set<string>()
  const joins: StackProfile['joins'] = []
  faces.forEach((f, i) => {
    const vs = frame.faces_vertices[f]
    vs.forEach((u, k) => {
      const v = vs[(k + 1) % vs.length]
      const kf = key(u, v)
      if (seen.has(kf)) return
      const fs = edgeFaces.get(kf) ?? []
      const a = assignment.get(kf)
      if (fs.length !== 2 || a === 'B' || a === 'b') return
      const j = at.get(fs[0] === f ? fs[1] : fs[0])
      if (j === undefined) return
      seen.add(kf)
      joins.push({
        upper: Math.min(i, j),
        lower: Math.max(i, j),
        at: [(coords[u][0] + coords[v][0]) / 2, (coords[u][1] + coords[v][1]) / 2],
      })
    })
  })
  joins.sort((a, b) => a.upper - b.upper || a.lower - b.lower)
  return { faces, joins }
}

const sideOf = (p: Vec2, l: Line) => cross(l.vector, sub(p, l.origin))

/**
 * The faces that move when the user grabs the top `k` layers at `grab` and
 * folds along `moveSide`; the moving side is the side of that line holding
 * `grab`.
 *
 * Rule:
 *   1. Seeds: the top k faces of `layerAt(frame, grab)`, k clamped to
 *      [1, layer count] (k = 0 and no faces when nothing is under `grab`).
 *      With a hit face `face` under `grab`, the k count from that face down
 *      (`stackFrom`), clamped to the layers from it to the bottom.
 *   2. Flood fill from the seeds across shared edges that are not boundary
 *      edges (assignment B, or only one face) and that reach strictly into
 *      the moving side (at least one folded endpoint off the crease line on
 *      the moving side). Such an edge is a hinge between a moving layer and
 *      its neighbour on the side that moves, so the neighbour comes along
 *      even if it straddles the crease (foldThrough splits it; only its
 *      moving-side part turns). Edges on the crease line, or wholly on the
 *      stationary side, are never crossed. E.g. on a half fold creased at
 *      x = 0.25: grabbing at x = 0.4 (hinge at 0.5 on the moving side) moves
 *      both layers; grabbing at x = 0.1 moves only the top one.
 *   If `grab` lies on the crease line itself, the moving side is undefined
 *   and only the seeds are returned.
 * `faces` is sorted ascending; `k` is the clamped count.
 */
export function selectFlap(
  frame: Frame,
  grab: Vec2,
  k: number,
  moveSide: Line,
  face?: number,
): { faces: number[]; k: number } {
  const stack = stackFrom(frame, grab, face)
  if (stack.length === 0) return { faces: [], k: 0 }
  const kk = Math.min(stack.length, Math.max(1, Math.floor(Number.isFinite(k) ? k : 1)))
  const chosen = new Set(stack.slice(0, kk))

  const coords = foldedCoords(frame)
  const vlen = Math.hypot(moveSide.vector[0], moveSide.vector[1]) || 1
  const side = (v: number) => sideOf(coords[v], moveSide) / vlen
  const g = sideOf(grab, moveSide) / vlen
  const grabSide = Math.abs(g) > EPS ? Math.sign(g) : 0
  if (grabSide !== 0) {
    const reachesMovingSide = (u: number, v: number) => side(u) * grabSide > EPS || side(v) * grabSide > EPS

    const { key, assignment, edgeFaces } = sideIndex(frame)
    const queue = [...chosen]
    for (let qi = 0; qi < queue.length; qi++) {
      const f = queue[qi]
      const vs = frame.faces_vertices[f]
      vs.forEach((u, i) => {
        const v = vs[(i + 1) % vs.length]
        const kf = key(u, v)
        const a = assignment.get(kf)
        const fs = edgeFaces.get(kf) ?? []
        if (fs.length !== 2 || a === 'B' || a === 'b' || !reachesMovingSide(u, v)) return
        for (const h of fs) {
          if (h === f || chosen.has(h)) continue
          chosen.add(h)
          queue.push(h)
        }
      })
    }
  }
  return { faces: [...chosen].sort((a, b) => a - b), k: kk }
}

type SideIndex = {
  key: (u: number, v: number) => string
  /** edge key → assignment */
  assignment: Map<string, string>
  /** edge key → incident faces (by consecutive vertices) */
  edgeFaces: Map<string, number[]>
}
const sideCache = new WeakMap<Frame, SideIndex>()
const sideKey = (u: number, v: number) => (u < v ? `${u} ${v}` : `${v} ${u}`)

/** selectFlap's edge lookups, cached per frame. */
function sideIndex(frame: Frame): SideIndex {
  const hit = sideCache.get(frame)
  if (hit) return hit
  const assignment = new Map<string, string>()
  frame.edges_vertices.forEach(([u, v], e) => assignment.set(sideKey(u, v), frame.edges_assignment[e]))
  const edgeFaces = new Map<string, number[]>()
  frame.faces_vertices.forEach((vs, f) =>
    vs.forEach((u, i) => {
      const kf = sideKey(u, vs[(i + 1) % vs.length])
      const list = edgeFaces.get(kf)
      if (list) list.push(f)
      else edgeFaces.set(kf, [f])
    }),
  )
  const out = { key: sideKey, assignment, edgeFaces }
  sideCache.set(frame, out)
  return out
}

/** Re-solve the layer order; refuse if the fold has no valid one. */
export const NO_ORDER = 'No valid layer order exists for this fold.'

export function withLayerOrder(frame: Frame): Result<{ frame: Frame }> {
  const over = layerBudget(frame)
  if (over) return over
  const orders = layerOrders(frame)
  if (!orders) return { ok: false, reason: NO_ORDER }
  const next = structuredClone(frame) as Frame
  return { ok: true, frame: { ...next, faceOrders: orders } }
}

// ---- the layer budget (R52) ----

/**
 * Refused before the layer solve. The solver's cost grows steeply with the
 * face pairs it must newly order (overlapping pairs without an order among
 * the frame's faceOrders, which it takes as constraints) and, less steeply,
 * with all overlapping pairs. Measured (Node 24; Chromium is about 2× faster):
 *   halving a square, all layers:
 *     fold 7: 128 layers, 8 128 pairs, 4 032 new: 1.8 s
 *     fold 8: 256 layers, 32 640 pairs, 16 256 new: 16.1 s
 *   the perf gate's 320-face model (6 halvings, then 4 corners folded in):
 *     corner 4: 128 layers, 26 464 pairs, 4 032 new: 6.2 s
 */
export const TOO_MANY_LAYERS = 'Too many layers to fold here.'

export type LayerBudget = { maxLayers: number; maxNewOrders: number; maxOrders: number }

/** The limits: halving fold 7 and the perf model pass; halving fold 8 (and deeper) is refused. */
export const LAYER_BUDGET: Readonly<LayerBudget> = Object.freeze({ maxLayers: 128, maxNewOrders: 6_000, maxOrders: 30_000 })

const AXIS_EPS = 1e-9

/** True when an edge normal of `a` separates the two convex polygons (touching counts as apart). */
function separates(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const p = a[i]
    const q = a[(i + 1) % a.length]
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (len < AXIS_EPS) continue
    const nx = (p[1] - q[1]) / len
    const ny = (q[0] - p[0]) / len
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
    for (const v of a) {
      const d = v[0] * nx + v[1] * ny
      if (d < a0) a0 = d
      if (d > a1) a1 = d
    }
    for (const v of b) {
      const d = v[0] * nx + v[1] * ny
      if (d < b0) b0 = d
      if (d > b1) b1 = d
    }
    if (a1 <= b0 + AXIS_EPS || b1 <= a0 + AXIS_EPS) return true
  }
  return false
}

/**
 * Whether the layer solve of flat `frame` fits the budget: a cheap, pure
 * pre-check (box-pruned pair scan, O(faces²) at worst), refused with
 * TOO_MANY_LAYERS when the folded faces overlap in more than `maxOrders`
 * pairs, more than `maxNewOrders` of them have no order yet in
 * `frame.faceOrders`, or more than `maxLayers` faces stack at one point
 * (counted at each face's centre). Faces are convex (cut from a convex sheet
 * by straight creases), so overlap is a separating-axis test; faces that only
 * touch along an edge do not overlap.
 */
export function layerBudget(frame: Frame, limits: LayerBudget = LAYER_BUDGET): Refusal | null {
  const { polys, boxes } = foldedPolygons(frame)
  const n = polys.length
  const refused: Refusal = { ok: false, reason: TOO_MANY_LAYERS }
  const known = new Set<number>()
  for (const [a, b] of frame.faceOrders) known.add(a < b ? a * n + b : b * n + a)
  let pairs = 0
  let fresh = 0
  for (let f = 0; f < n; f++) {
    const bf = boxes[f]
    for (let g = f + 1; g < n; g++) {
      const bg = boxes[g]
      if (bf[2] <= bg[0] + AXIS_EPS || bg[2] <= bf[0] + AXIS_EPS || bf[3] <= bg[1] + AXIS_EPS || bg[3] <= bf[1] + AXIS_EPS) continue
      if (separates(polys[f], polys[g]) || separates(polys[g], polys[f])) continue
      if (++pairs > limits.maxOrders) return refused
      if (!known.has(f * n + g) && ++fresh > limits.maxNewOrders) return refused
    }
  }
  // Stack depth at each face's centre (convex, so the vertex mean is inside it).
  for (let f = 0; f < n; f++) {
    const poly = polys[f]
    const c: Vec2 = [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length]
    if (facesAt(frame, c).length > limits.maxLayers) return refused
  }
  return null
}
