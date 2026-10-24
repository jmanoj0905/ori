// The designer's crease pattern (spec 07; Plan 5 Task 1): a FOLD graph with no
// folding history, edited by pure operations that return a new CP.
//
//   - The sheet's outline is the boundary ('B' edges); creases are 'M', 'V'
//     or 'U' (unassigned; 'F' from an import is kept as is and treated as
//     unassigned). edges_foldAngle follows the assignment (V +180, M −180,
//     else 0), the FOLD convention for a crease pattern.
//   - The graph stays planar: a new crease is clipped to the sheet, and split
//     where it crosses or touches existing edges (which are split there too).
//   - Near-coincident geometry is merged (Review Focus 1): points closer than
//     EPS (1e-6, paper units) are one vertex, a crease endpoint within EPS of
//     an edge lands on it, and a crease within EPS of an existing one
//     re-assigns that one instead of adding a twin. No edge is ever shorter
//     than EPS.
//   - faces_vertices is left empty: faces are built when the pattern is
//     folded or shown in 3D (the engine's patternFrame), not on every edit.
import type { Frame, PaperSize, Vec2 } from '@engine'

export type CP = Frame
export type Assignment = 'M' | 'V' | 'U'

/** Merge distance for vertices, edges and creases (paper units). */
export const EPS = 1e-6

export type GridPreset = { kind: 'square'; divisions: number } | { kind: 'angle'; degrees: number }

/** Spec 07 grid presets; "custom" is a square grid of any number of divisions. */
export const GRID_PRESETS = {
  '8x8': { kind: 'square', divisions: 8 },
  '16x16': { kind: 'square', divisions: 16 },
  '22.5': { kind: 'angle', degrees: 22.5 },
} as const satisfies Record<string, GridPreset>

export const angleOf = (a: string): number => (a === 'V' ? 180 : a === 'M' ? -180 : 0)

/** A blank sheet: its four corners and boundary edges. */
export function emptyCP(size: PaperSize): CP {
  const { width: w, height: h } = size
  return {
    vertices_coords: [[0, 0], [w, 0], [w, h], [0, h]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]],
    edges_assignment: ['B', 'B', 'B', 'B'],
    edges_foldAngle: [0, 0, 0, 0],
    faces_vertices: [],
    faceOrders: [],
  }
}

/** The edges that are creases (everything but the boundary). */
export const creaseEdges = (cp: CP): number[] =>
  cp.edges_assignment.flatMap((a, e) => (a === 'B' ? [] : [e]))

/** The sheet's size: the bounds of its vertices (the outline is a rectangle at the origin). */
export function sizeOf(cp: CP): PaperSize {
  let w = 0
  let h = 0
  for (const [x, y] of cp.vertices_coords) {
    w = Math.max(w, x)
    h = Math.max(h, y)
  }
  return { width: w, height: h }
}

// ---- geometry ----

type P = [number, number]
const dist = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!)

/** Parameter of p's projection on a→b (0 at a, 1 at b). */
function param(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const dx = b[0]! - a[0]!
  const dy = b[1]! - a[1]!
  const l2 = dx * dx + dy * dy
  return l2 === 0 ? 0 : ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dy) / l2
}
const lerp = (a: readonly number[], b: readonly number[], t: number): P => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t]

/** The closest point of segment a–b to p. */
function closest(p: readonly number[], a: readonly number[], b: readonly number[]): P {
  return lerp(a, b, Math.min(1, Math.max(0, param(p, a, b))))
}

/** Proper crossing of segments a–b and c–d (not at shared ends): the point, or null. */
function crossing(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): P | null {
  const rx = b[0]! - a[0]!
  const ry = b[1]! - a[1]!
  const sx = d[0]! - c[0]!
  const sy = d[1]! - c[1]!
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-18) return null
  const qx = c[0]! - a[0]!
  const qy = c[1]! - a[1]!
  const t = (qx * sy - qy * sx) / den
  const u = (qx * ry - qy * rx) / den
  const lt = EPS / Math.hypot(rx, ry)
  const lu = EPS / Math.hypot(sx, sy)
  if (t < -lt || t > 1 + lt || u < -lu || u > 1 + lu) return null
  return lerp(a, b, t)
}

/** Clip a–b to the rectangle [0, w] × [0, h] (Liang–Barsky); null when it misses. */
function clipToSheet(a: Vec2, b: Vec2, size: PaperSize): [P, P] | null {
  let t0 = 0
  let t1 = 1
  const d = [b[0] - a[0], b[1] - a[1]]
  const checks: [number, number][] = [
    [-d[0]!, a[0] - 0], [d[0]!, size.width - a[0]],
    [-d[1]!, a[1] - 0], [d[1]!, size.height - a[1]],
  ]
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-18) {
      if (q < -EPS) return null
    } else {
      const r = q / p
      if (p < 0) t0 = Math.max(t0, r)
      else t1 = Math.min(t1, r)
    }
  }
  if (t0 > t1) return null
  const clamp = (p: P): P => [Math.min(size.width, Math.max(0, p[0])), Math.min(size.height, Math.max(0, p[1]))]
  return [clamp(lerp(a, b, t0)), clamp(lerp(a, b, t1))]
}

// ---- a mutable working copy ----

class Graph {
  v: P[]
  e: [number, number][]
  a: string[]
  constructor(cp: CP) {
    this.v = cp.vertices_coords.map(p => [p[0], p[1]])
    this.e = cp.edges_vertices.map(([u, w]) => [u, w])
    this.a = [...cp.edges_assignment]
  }

  /** The vertex within EPS of p, or -1. */
  find(p: readonly number[]): number {
    let best = -1
    let bd = EPS
    for (let i = 0; i < this.v.length; i++) {
      const d = dist(this.v[i]!, p)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }

  vertex(p: readonly number[]): number {
    const i = this.find(p)
    if (i >= 0) return i
    this.v.push([p[0]!, p[1]!])
    return this.v.length - 1
  }

  edgeIndex(u: number, w: number): number {
    return this.e.findIndex(([x, y]) => (x === u && y === w) || (x === w && y === u))
  }

  /** Snap p to a vertex within EPS, else onto an edge within EPS, else keep it. */
  snap(p: P): P {
    const i = this.find(p)
    if (i >= 0) return this.v[i]!
    for (const [u, w] of this.e) {
      const c = closest(p, this.v[u]!, this.v[w]!)
      if (dist(c, p) < EPS) return c
    }
    return p
  }

  toCP(): CP {
    return {
      vertices_coords: this.v.map(p => [p[0], p[1]] as Vec2),
      edges_vertices: this.e.map(([u, w]) => [u, w]),
      edges_assignment: [...this.a],
      edges_foldAngle: this.a.map(angleOf),
      faces_vertices: [],
      faceOrders: [],
    }
  }
}

/**
 * Add a crease from a to b (clipped to the sheet). It is split where it
 * crosses or touches other edges, and those are split too; points within EPS
 * merge, and the parts that coincide with an existing crease re-assign it
 * (the boundary keeps 'B'). Returns `cp` itself when nothing is added.
 */
export function addCrease(cp: CP, a: Vec2, b: Vec2, assignment: Assignment): CP {
  const clipped = clipToSheet(a, b, sizeOf(cp))
  if (!clipped) return cp
  const g = new Graph(cp)
  const s = g.snap(clipped[0])
  const t = g.snap(clipped[1])
  if (dist(s, t) < EPS) return cp

  // points along s → t: its ends, existing vertices on it, and crossings
  const along: { t: number; p: P; vertex?: number }[] = [{ t: 0, p: s }, { t: 1, p: t }]
  const splits = new Map<number, P[]>()
  const splitAt = (e: number, p: P) => splits.set(e, [...(splits.get(e) ?? []), p])
  g.v.forEach((p, i) => {
    if (dist(closest(p, s, t), p) < EPS) along.push({ t: param(p, s, t), p, vertex: i })
  })
  g.e.forEach(([u, w], e) => {
    const p = g.v[u]!
    const q = g.v[w]!
    // an end of the new crease touching this edge's interior splits it there
    for (const end of [s, t]) if (dist(closest(end, p, q), end) < EPS && dist(end, p) >= EPS && dist(end, q) >= EPS) splitAt(e, end)
    const onLine = (x: P) => dist(closest(x, s, t), x) < EPS
    if (onLine(p) || onLine(q)) return // collinear overlap or a shared end: covered by the vertices on the crease
    const x = crossing(s, t, p, q)
    if (!x) return
    along.push({ t: param(x, s, t), p: x })
    if (dist(x, p) >= EPS && dist(x, q) >= EPS) splitAt(e, x)
  })

  // cluster the points (closer than EPS: one vertex, an existing one first)
  along.sort((x, y) => x.t - y.t)
  const ids: number[] = []
  const clusters: (typeof along)[] = []
  for (const pt of along) {
    const last = clusters.at(-1)
    if (last && dist(last[0]!.p, pt.p) < EPS) last.push(pt)
    else clusters.push([pt])
  }
  for (const c of clusters) {
    const existing = c.find(x => x.vertex !== undefined)
    ids.push(existing ? existing.vertex! : g.vertex(c[0]!.p))
  }

  // split the crossed / touched edges (their new pieces keep their assignment)
  const extra: [number, number, string][] = []
  for (const [e, pts] of splits) {
    const [u, w] = g.e[e]!
    const p = g.v[u]!
    const q = g.v[w]!
    const chain = [u, ...pts.sort((x, y) => param(x, p, q) - param(y, p, q)).map(x => g.vertex(x)), w]
      .filter((v, i, all) => i === 0 || v !== all[i - 1])
    if (chain.length < 2) continue
    g.e[e] = [chain[0]!, chain[1]!]
    for (let i = 1; i + 1 < chain.length; i++) extra.push([chain[i]!, chain[i + 1]!, g.a[e]!])
  }
  for (const [u, w, x] of extra) {
    g.e.push([u, w])
    g.a.push(x)
  }

  // the new crease's pieces: re-assign a coinciding crease, else add
  for (let i = 0; i + 1 < ids.length; i++) {
    const u = ids[i]!
    const w = ids[i + 1]!
    if (u === w) continue
    const k = g.edgeIndex(u, w)
    if (k >= 0) {
      if (g.a[k] !== 'B') g.a[k] = assignment
    } else {
      g.e.push([u, w])
      g.a.push(assignment)
    }
  }
  return g.toCP()
}

/** Re-assign a crease. The boundary cannot be re-assigned (cp returned as is). */
export function setAssignment(cp: CP, edge: number, a: Assignment): CP {
  const cur = cp.edges_assignment[edge]
  if (cur === undefined || cur === 'B' || cur === a) return cp
  const asg = [...cp.edges_assignment]
  asg[edge] = a
  return { ...cp, edges_assignment: asg, edges_foldAngle: asg.map(angleOf) }
}

/** Mountain ↔ valley; unassigned creases stay unassigned. */
export function flip(cp: CP, edge: number): CP {
  const cur = cp.edges_assignment[edge]
  return cur === 'M' ? setAssignment(cp, edge, 'V') : cur === 'V' ? setAssignment(cp, edge, 'M') : cp
}

/**
 * Remove a crease. A vertex left alone is removed; one left between two
 * collinear edges of the same assignment is merged away (the boundary heals).
 */
export function removeCrease(cp: CP, edge: number): CP {
  const cur = cp.edges_assignment[edge]
  if (cur === undefined || cur === 'B') return cp
  const g = new Graph(cp)
  const [u, w] = g.e[edge]!
  g.e.splice(edge, 1)
  g.a.splice(edge, 1)
  for (const v of [u, w].sort((x, y) => y - x)) tidyVertex(g, v)
  return g.toCP()
}

/** Remove vertex v if it is isolated, or merge its two collinear same-assignment edges. */
function tidyVertex(g: Graph, v: number) {
  const es = g.e.flatMap(([x, y], e) => (x === v || y === v ? [e] : []))
  if (es.length === 2) {
    const [e0, e1] = es as [number, number]
    if (g.a[e0] !== g.a[e1]) return
    const a = g.e[e0]!.find(x => x !== v)!
    const b = g.e[e1]!.find(x => x !== v)!
    const c = closest(g.v[v]!, g.v[a]!, g.v[b]!)
    if (dist(c, g.v[v]!) >= EPS || param(g.v[v]!, g.v[a]!, g.v[b]!) <= 0 || param(g.v[v]!, g.v[a]!, g.v[b]!) >= 1) return
    g.e[e0] = [a, b]
    g.e.splice(e1, 1)
    g.a.splice(e1, 1)
  } else if (es.length !== 0) return
  g.v.splice(v, 1)
  g.e = g.e.map(([x, y]) => [x > v ? x - 1 : x, y > v ? y - 1 : y])
}

/**
 * Snap p to the grid. A square grid snaps to the nearest grid point of the
 * sheet (`size`, the unit square by default). The angle grid snaps the
 * direction from `anchor` to the nearest multiple of its angle, keeping the
 * length along it (p is projected onto that ray); with no anchor p is kept.
 */
export function snapToGrid(p: Vec2, grid: GridPreset, opts: { anchor?: Vec2; size?: PaperSize } = {}): Vec2 {
  if (grid.kind === 'square') {
    const { width, height } = opts.size ?? { width: 1, height: 1 }
    const n = Math.max(1, Math.round(grid.divisions))
    const s = (x: number, len: number) => Math.min(n, Math.max(0, Math.round((x / len) * n))) * (len / n)
    return [s(p[0], width), s(p[1], height)]
  }
  const a = opts.anchor
  if (!a) return p
  const dx = p[0] - a[0]
  const dy = p[1] - a[1]
  const step = (grid.degrees * Math.PI) / 180
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  const ux = Math.cos(ang)
  const uy = Math.sin(ang)
  const len = Math.max(0, dx * ux + dy * uy)
  return [a[0] + ux * len, a[1] + uy * len]
}
