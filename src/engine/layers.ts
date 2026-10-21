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
import type { Frame, Line, Result, Vec2 } from './types'

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

/** above[f] = faces directly known to lie below f (world +z ordering). */
export function aboveGraph(frame: Frame): Map<number, number[]> {
  const w = windings(frame)
  const below = new Map<number, number[]>()
  const add = (top: number, bottom: number) => {
    const list = below.get(top) ?? []
    list.push(bottom)
    below.set(top, list)
  }
  for (const [f, g, s] of frame.faceOrders) {
    if (s * (w[g] ? 1 : -1) > 0) add(f, g)
    else add(g, f)
  }
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
 * Cached per frame (frames are immutable); treat the array as read-only.
 */
export function layerRanks(frame: Frame): number[] {
  const hit = rankCache.get(frame)
  if (hit) return hit
  const n = frame.faces_vertices.length
  const below = aboveGraph(frame)
  const aboveCount = new Array<number>(n).fill(0)
  const edges = new Map<number, number[]>()
  for (const [top, bottoms] of below) {
    const uniq = [...new Set(bottoms)].filter(b => b !== top && b >= 0 && b < n)
    edges.set(top, uniq)
    for (const b of uniq) aboveCount[b]++
  }
  const done = new Array<boolean>(n).fill(false)
  const ranks = new Array<number>(n)
  for (let placed = 0; placed < n; placed++) {
    let next = -1
    for (let f = 0; f < n && next < 0; f++) if (!done[f] && aboveCount[f] === 0) next = f
    if (next < 0) next = done.indexOf(false) // a cycle: the lowest remaining id
    done[next] = true
    ranks[next] = n - 1 - placed
    for (const b of edges.get(next) ?? []) aboveCount[b]--
  }
  rankCache.set(frame, ranks)
  return ranks
}

const rankCache = new WeakMap<Frame, number[]>()

/**
 * Face ids under the folded-space point `p`, top to bottom: sorted by
 * `layerRanks` (so by faceOrders, including relations implied through faces
 * not under `p`; ties among unrelated faces resolve by the global order,
 * lowest id first where nothing else decides). A point on a boundary (vertex
 * or crease) shared by unordered faces therefore resolves deterministically.
 */
export function layerAt(frame: Frame, p: Vec2): number[] {
  const coords = foldedCoords(frame)
  const here = frame.faces_vertices
    .map((vs, f) => (containsPoint(vs.map(v => coords[v]), p) ? f : -1))
    .filter(f => f >= 0)
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

    // edge key → assignment, and edge key → incident faces
    const key = (u: number, v: number) => (u < v ? `${u} ${v}` : `${v} ${u}`)
    const assignment = new Map<string, string>()
    frame.edges_vertices.forEach(([u, v], e) => assignment.set(key(u, v), frame.edges_assignment[e]))
    const edgeFaces = new Map<string, number[]>()
    frame.faces_vertices.forEach((vs, f) =>
      vs.forEach((u, i) => {
        const kf = key(u, vs[(i + 1) % vs.length])
        edgeFaces.set(kf, [...(edgeFaces.get(kf) ?? []), f])
      }),
    )

    const queue = [...chosen]
    while (queue.length) {
      const f = queue.shift()!
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

/** Re-solve the layer order; refuse if the fold has no valid one. */
export const NO_ORDER = 'No valid layer order exists for this fold.'

export function withLayerOrder(frame: Frame): Result<{ frame: Frame }> {
  const orders = layerOrders(frame)
  if (!orders) return { ok: false, reason: NO_ORDER }
  const next = structuredClone(frame) as Frame
  return { ok: true, frame: { ...next, faceOrders: orders } }
}
