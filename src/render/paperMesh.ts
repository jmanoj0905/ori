// The paper mesh: each face of a frame, posed into world space and lifted off
// the faces beneath it so stacks never z-fight. Pure geometry (no WebGL), so
// it is unit-testable in node.
//
// Layer offsets (R26, spec 02 "epsilon × layer index"). The engine's
// layerRanks(frame) is a total order over ALL faces (0 = bottom): faces side by
// side still get distinct ranks. Lifting every face by gap × rank would float a
// 300-face model 0.45 units off the desk, so the rank is used as the ORDER and
// the lift is the face's stack depth in that order: walking faces from rank 0
// up, a face's level is one more than the highest level among lower-ranked
// faces it actually overlaps (coplanar and with intersecting interiors), else 0.
// In a full stack (every face over every other) level === rank exactly.
//
// The lift is along the face's stack "up": world +z for flat faces; for posed
// (non-flat) faces it is the front normal, flipped for faces that are mirrored
// in the flat state (parity of folds crossed from the root face).
//
// Preview (R25 + Task 0 caveat): Preview.frame's ranks don't relate the moving
// flap to the faces it swings over, so with `moving` the stationary faces are
// levelled among themselves and the moving flap among itself; the flap is then
// shifted as a block past the stationary stack: above it (valley-like tools)
// or below it (mountain). The flap's own layers stay on its own (rotating) up,
// so its internal order reverses physically as it swings over.
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { layerRanks } from '@engine'
import type { FacePose, Frame } from '@engine'

export const LAYER_GAP = 0.0015

export type LayerOptions = {
  /** The preview's moving faces (of this frame). */
  moving?: readonly number[]
  /** Moving flap goes above the stationary stack (default) or below it (mountain). */
  above?: boolean
}

export type LayerOffsets = {
  /** World-space offset of each face: xyz per face. */
  offsets: Float32Array
  /** Stack depth of each face (see header). */
  levels: number[]
  /** Unit stack "up" of each face: xyz per face. */
  up: Float32Array
}

export type PaperGeometryOptions = {
  /** Precomputed offsets (from layerOffsets on the same frame and poses). */
  offsets?: Float32Array
  /** Only these faces (default: all). */
  faces?: readonly number[]
}

const IDENTITY: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Paper size (the crease pattern's extent). UVs are paper coord / size. */
export function paperSize(frame: Frame): { width: number; height: number } {
  let x1 = 0
  let y1 = 0
  let x0 = Infinity
  let y0 = Infinity
  for (const [x, y] of frame.vertices_coords) {
    if (x > x1) x1 = x
    if (y > y1) y1 = y
    if (x < x0) x0 = x
    if (y < y0) y0 = y
  }
  // Sheets start at the origin (createPaper); fall back to the extent otherwise.
  const w = x0 >= -1e-9 ? x1 : x1 - x0
  const h = y0 >= -1e-9 ? y1 : y1 - y0
  return { width: w > 0 ? w : 1, height: h > 0 ? h : 1 }
}

/** Pose matrix (column-major) per face id. */
export function poseTable(frame: Frame, poses: readonly FacePose[]): (readonly number[])[] {
  const t: (readonly number[])[] = new Array(frame.faces_vertices.length).fill(IDENTITY)
  for (const p of poses) if (p.face >= 0 && p.face < t.length) t[p.face] = p.matrix
  return t
}

/** Face vertex loop, counter-clockwise in paper space (front = paper +z). */
export function ccwLoop(frame: Frame, f: number): readonly number[] {
  const fv = frame.faces_vertices[f]!
  const c = frame.vertices_coords
  let a = 0
  for (let i = 0; i < fv.length; i++) {
    const p = c[fv[i]!]!
    const q = c[fv[(i + 1) % fv.length]!]!
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a >= 0 ? fv : [...fv].reverse()
}

const edgeFacesCache = new WeakMap<Frame, Map<number, number[]>>()

/** Faces on each undirected vertex pair (key a * V + b, a < b), from faces_vertices. */
export function edgeFaces(frame: Frame): Map<number, number[]> {
  const hit = edgeFacesCache.get(frame)
  if (hit) return hit
  const nv = frame.vertices_coords.length
  const m = new Map<number, number[]>()
  frame.faces_vertices.forEach((fv, f) => {
    for (let i = 0; i < fv.length; i++) {
      const a = fv[i]!
      const b = fv[(i + 1) % fv.length]!
      const k = a < b ? a * nv + b : b * nv + a
      const list = m.get(k)
      if (list) list.push(f)
      else m.set(k, [f])
    }
  })
  edgeFacesCache.set(frame, m)
  return m
}

export const edgeKey = (frame: Frame, a: number, b: number): number => {
  const nv = frame.vertices_coords.length
  return a < b ? a * nv + b : b * nv + a
}

const parityCache = new WeakMap<Frame, Int8Array>()

/**
 * +1 / −1 per face: mirrored in the folded form the engine ranks against (an
 * odd number of creases folded past 90° between it and root face 0). This
 * matches the engine: layerRanks reads faceOrders through `windings` of
 * `foldedCoords`, and RE's makeVerticesCoordsFolded folds each edge by its
 * edges_foldAngle, so a face's winding flips exactly when its crease passes
 * 90° (checked: a flap committed at 60° keeps its windings, at 120° they
 * flip). Up = parity × normal then always points to higher ranks, and the
 * flap's internal order stays put in its own frame across 90°.
 */
export function faceParity(frame: Frame): Int8Array {
  const hit = parityCache.get(frame)
  if (hit) return hit
  const n = frame.faces_vertices.length
  const par = new Int8Array(n)
  const ef = edgeFaces(frame)
  const flips = new Map<number, boolean>()
  frame.edges_vertices.forEach(([a, b], e) => {
    flips.set(edgeKey(frame, a, b), Math.abs(frame.edges_foldAngle[e] ?? 0) > 90)
  })
  for (let root = 0; root < n; root++) {
    if (par[root]) continue
    par[root] = 1
    const queue = [root]
    while (queue.length) {
      const f = queue.pop()!
      const fv = frame.faces_vertices[f]!
      for (let i = 0; i < fv.length; i++) {
        const k = edgeKey(frame, fv[i]!, fv[(i + 1) % fv.length]!)
        for (const g of ef.get(k) ?? []) {
          if (par[g]) continue
          par[g] = (flips.get(k) ? -par[f]! : par[f]!) as 1 | -1
          queue.push(g)
        }
      }
    }
  }
  parityCache.set(frame, par)
  return par
}

type Posed = {
  /** World points per face, xyz flattened. */
  pts: Float64Array[]
  /** Posed front normal per face. */
  n: Float64Array
  /** AABB per face: minx, miny, minz, maxx, maxy, maxz. */
  box: Float64Array
}

function posedFaces(frame: Frame, table: (readonly number[])[], faces: readonly number[]): Posed {
  const n = frame.faces_vertices.length
  const pts: Float64Array[] = new Array(n)
  const nrm = new Float64Array(3 * n)
  const box = new Float64Array(6 * n)
  const c = frame.vertices_coords
  for (const f of faces) {
    const m = table[f]!
    const loop = ccwLoop(frame, f)
    const p = new Float64Array(3 * loop.length)
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    loop.forEach((v, i) => {
      const [x, y] = c[v]!
      const wx = m[0]! * x + m[4]! * y + m[12]!
      const wy = m[1]! * x + m[5]! * y + m[13]!
      const wz = m[2]! * x + m[6]! * y + m[14]!
      p[3 * i] = wx; p[3 * i + 1] = wy; p[3 * i + 2] = wz
      if (wx < x0) x0 = wx
      if (wy < y0) y0 = wy
      if (wz < z0) z0 = wz
      if (wx > x1) x1 = wx
      if (wy > y1) y1 = wy
      if (wz > z1) z1 = wz
    })
    pts[f] = p
    nrm[3 * f] = m[8]!; nrm[3 * f + 1] = m[9]!; nrm[3 * f + 2] = m[10]!
    box.set([x0, y0, z0, x1, y1, z1], 6 * f)
  }
  return { pts, n: nrm, box }
}

const EPS = 1e-6

/** Coplanar faces whose interiors intersect (convex polygons, separating axis test). */
function overlaps(P: Posed, a: number, b: number): boolean {
  const A = P.box, ia = 6 * a, ib = 6 * b
  if (A[ia]! > A[ib + 3]! - EPS || A[ib]! > A[ia + 3]! - EPS) return false
  if (A[ia + 1]! > A[ib + 4]! - EPS || A[ib + 1]! > A[ia + 4]! - EPS) return false
  if (A[ia + 2]! > A[ib + 5]! + EPS || A[ib + 2]! > A[ia + 5]! + EPS) return false
  const nx = P.n[3 * a]!, ny = P.n[3 * a + 1]!, nz = P.n[3 * a + 2]!
  const dot = nx * P.n[3 * b]! + ny * P.n[3 * b + 1]! + nz * P.n[3 * b + 2]!
  if (Math.abs(dot) < 1 - 1e-6) return false
  const pa = P.pts[a]!, pb = P.pts[b]!
  const dist = nx * (pb[0]! - pa[0]!) + ny * (pb[1]! - pa[1]!) + nz * (pb[2]! - pa[2]!)
  if (Math.abs(dist) > 1e-5) return false
  // Project onto the plane by dropping the dominant normal axis.
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz)
  const [u, v] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [0, 2]
  return !separated(pa, pb, u, v) && !separated(pb, pa, u, v)
}

/** Some edge of `p` is a separating axis (overlap thinner than EPS counts as touching). */
function separated(p: Float64Array, q: Float64Array, u: number, v: number): boolean {
  const n = p.length / 3
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ex = p[3 * j + u]! - p[3 * i + u]!
    const ey = p[3 * j + v]! - p[3 * i + v]!
    const len = Math.hypot(ex, ey)
    if (len < 1e-12) continue
    const ax = -ey / len, ay = ex / len
    let pmin = Infinity, pmax = -Infinity, qmin = Infinity, qmax = -Infinity
    for (let k = 0; k < p.length; k += 3) {
      const d = p[k + u]! * ax + p[k + v]! * ay
      if (d < pmin) pmin = d
      if (d > pmax) pmax = d
    }
    for (let k = 0; k < q.length; k += 3) {
      const d = q[k + u]! * ax + q[k + v]! * ay
      if (d < qmin) qmin = d
      if (d > qmax) qmax = d
    }
    if (Math.min(pmax, qmax) - Math.max(pmin, qmin) < EPS) return true
  }
  return false
}

/**
 * Stack depth of `faces`, walked in ascending engine rank. Placed faces are
 * kept sorted by level, highest first, so the first overlap found decides
 * (a full stack costs O(n) overlap tests per face, not O(n²) in total).
 */
function stackLevels(P: Posed, ranks: readonly number[], faces: readonly number[], levels: number[]): number {
  const order = [...faces].sort((a, b) => ranks[a]! - ranks[b]! || a - b)
  const placed: number[] = []
  let top = -1
  for (const f of order) {
    let lvl = 0
    for (const g of placed) {
      if (overlaps(P, f, g)) {
        lvl = levels[g]! + 1
        break
      }
    }
    levels[f] = lvl
    if (lvl > top) top = lvl
    // insert keeping levels descending
    let lo = 0
    let hi = placed.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (levels[placed[mid]!]! >= lvl) lo = mid + 1
      else hi = mid
    }
    placed.splice(lo, 0, f)
  }
  return top
}

type LevelCache = { key: string; levels: number[]; sTop: number; mTop: number }
const levelCache = new WeakMap<Frame, LevelCache>()

/** Per-face layer offsets (see the header for the rules). */
export function layerOffsets(
  frame: Frame,
  poses: readonly FacePose[],
  gap: number = LAYER_GAP,
  opts: LayerOptions = {},
): LayerOffsets {
  const n = frame.faces_vertices.length
  const table = poseTable(frame, poses)
  const all = Array.from({ length: n }, (_, f) => f)
  const parity = faceParity(frame)
  const normal = (f: number, k: number) => table[f]![8 + k]!
  const up = new Float32Array(3 * n)
  for (let f = 0; f < n; f++) {
    const nz = normal(f, 2)
    if (Math.abs(nz) > 0.999) {
      up[3 * f + 2] = 1
    } else {
      const s = parity[f]!
      up[3 * f] = s * normal(f, 0); up[3 * f + 1] = s * normal(f, 1); up[3 * f + 2] = s * nz
    }
  }
  const offsets = new Float32Array(3 * n)
  const moving = new Set(opts.moving ?? [])
  if (!moving.size) {
    const levels = new Array<number>(n).fill(0)
    stackLevels(posedFaces(frame, table, all), layerRanks(frame), all, levels)
    for (let f = 0; f < n; f++) for (let k = 0; k < 3; k++) offsets[3 * f + k] = up[3 * f + k]! * gap * levels[f]!
    return { offsets, levels, up }
  }
  const stationary = all.filter(f => !moving.has(f))
  const flap = all.filter(f => moving.has(f))
  // Within each part the poses are rigid (stationary fixed, flap swung as one),
  // so the levels depend only on the frame and the moving set: cache them per
  // Preview.frame, and each pointer move only recomputes the offsets.
  const key = flap.join(',')
  let cached = levelCache.get(frame)
  if (!cached || cached.key !== key) {
    const levels = new Array<number>(n).fill(0)
    const P = posedFaces(frame, table, all)
    const ranks = layerRanks(frame)
    const sTop = stackLevels(P, ranks, stationary, levels)
    const mTop = stackLevels(P, ranks, flap, levels)
    cached = { key, levels, sTop, mTop }
    levelCache.set(frame, cached)
  }
  const { sTop, mTop } = cached
  const levels = [...cached.levels]
  for (const f of stationary) for (let k = 0; k < 3; k++) offsets[3 * f + k] = up[3 * f + k]! * gap * levels[f]!
  // The flap's own up comes from its pre-swing parity: it rotates with the flap.
  const shift = (opts.above === false ? -1 : 1) * gap * (sTop + 1 + mTop)
  for (const f of flap) {
    const s = parity[f]!
    for (let k = 0; k < 3; k++) {
      const u = s * normal(f, k)
      up[3 * f + k] = u
      offsets[3 * f + k] = u * gap * levels[f]! + (k === 2 ? shift : 0)
    }
  }
  return { offsets, levels, up }
}

/**
 * Non-indexed triangles, fan-triangulated per face (faces are convex), posed
 * and offset. Attributes: position, normal (the face's posed front normal),
 * uv (paper coordinate / paper size). `userData.triFace` maps each triangle to
 * its face id. Front faces (counter-clockwise from outside) are the paper's front.
 */
export function buildPaperGeometry(
  frame: Frame,
  poses: readonly FacePose[],
  layerGap: number = LAYER_GAP,
  opts: PaperGeometryOptions = {},
): BufferGeometry {
  const table = poseTable(frame, poses)
  const faces = opts.faces ?? frame.faces_vertices.map((_, f) => f)
  const offsets = opts.offsets ?? layerOffsets(frame, poses, layerGap).offsets
  const { width, height } = paperSize(frame)
  const c = frame.vertices_coords
  let tris = 0
  for (const f of faces) tris += Math.max(0, frame.faces_vertices[f]!.length - 2)
  const pos = new Float32Array(9 * tris)
  const nrm = new Float32Array(9 * tris)
  const uv = new Float32Array(6 * tris)
  const triFace = new Int32Array(tris)
  let t = 0
  for (const f of faces) {
    const m = table[f]!
    const loop = ccwLoop(frame, f)
    const ox = offsets[3 * f]!, oy = offsets[3 * f + 1]!, oz = offsets[3 * f + 2]!
    for (let i = 1; i + 1 < loop.length; i++) {
      const corners = [loop[0]!, loop[i]!, loop[i + 1]!]
      for (let k = 0; k < 3; k++) {
        const [x, y] = c[corners[k]!]!
        const o = 9 * t + 3 * k
        pos[o] = m[0]! * x + m[4]! * y + m[12]! + ox
        pos[o + 1] = m[1]! * x + m[5]! * y + m[13]! + oy
        pos[o + 2] = m[2]! * x + m[6]! * y + m[14]! + oz
        nrm[o] = m[8]!; nrm[o + 1] = m[9]!; nrm[o + 2] = m[10]!
        uv[6 * t + 2 * k] = x / width
        uv[6 * t + 2 * k + 1] = y / height
      }
      triFace[t++] = f
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.userData.triFace = triFace
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}
