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
 * Face ids under the folded-space point `p`, top to bottom by faceOrders.
 * The order is a topological sort of "is above" (including relations implied
 * through faces not under `p`); among faces with nothing known to be above
 * them, the lowest face id comes first. So a point on a boundary (vertex or
 * crease) shared by unordered faces resolves deterministically.
 */
export function layerAt(frame: Frame, p: Vec2): number[] {
  const coords = foldedCoords(frame)
  const here = frame.faces_vertices
    .map((vs, f) => (containsPoint(vs.map(v => coords[v]), p) ? f : -1))
    .filter(f => f >= 0)
  if (here.length < 2) return here

  const below = aboveGraph(frame)
  const reach = (from: number): Set<number> => {
    const seen = new Set<number>()
    const stack = [...(below.get(from) ?? [])]
    while (stack.length) {
      const x = stack.pop()!
      if (seen.has(x) || x === from) continue
      seen.add(x)
      stack.push(...(below.get(x) ?? []))
    }
    return seen
  }
  const reachable = new Map(here.map(f => [f, reach(f)]))
  // Kahn: repeatedly take the lowest-id face with no remaining face above it.
  const remaining = new Set(here)
  const out: number[] = []
  while (remaining.size) {
    const free = [...remaining].filter(f => ![...remaining].some(g => g !== f && reachable.get(g)!.has(f)))
    // a cycle (inconsistent orders) falls back to the lowest remaining id
    const next = Math.min(...(free.length ? free : [...remaining]))
    out.push(next)
    remaining.delete(next)
  }
  return out
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
): { faces: number[]; k: number } {
  const stack = layerAt(frame, grab)
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
export function withLayerOrder(frame: Frame): Result<{ frame: Frame }> {
  const orders = layerOrders(frame)
  if (!orders) return { ok: false, reason: 'No valid layer order exists for this fold.' }
  const next = structuredClone(frame) as Frame
  return { ok: true, frame: { ...next, faceOrders: orders } }
}
