// The remesher (spec 08 Approach; Plan 6 Task 1): a FOLD frame and its face
// poses → a particle / triangle mesh for the soft solver, refined so that
// every crease is made of mesh edges.
//
//   1. Every frame edge is sampled into pieces no longer than `targetEdge`;
//      faces sharing an edge share its samples, so a crease is a chain of
//      mesh edges (and never crosses a triangle).
//   2. Each face is filled with a triangular lattice of interior points
//      (spacing targetEdge, kept half a spacing away from the face's sides)
//      and triangulated by Delaunay (Bowyer–Watson) over its side samples
//      and those points, keeping the triangles inside the face. With the
//      sides sampled at least as finely as the interior, the Delaunay mesh
//      conforms to them; if a side is ever missing (a very concave face), the
//      face falls back to ear clipping of its side samples, which always
//      conforms. Triangles are counter-clockwise in paper coordinates.
//   3. Positions are the paper points placed by their face's pose (rigid, so
//      areas are kept and shared points agree).
//   4. Hinges: every interior mesh edge joins two triangles. On a crease it is
//      a crease hinge whose rest angle is the crease's edges_foldAngle (FOLD
//      degrees: valley +, mountain −); inside a face it is a bending hinge at
//      rest flat (0). Hinge (a, b, c, d) has c on the left of a → b in paper
//      coordinates (see dihedral.ts).
import type { FacePose, Frame } from '@engine'

export type Hinge = { a: number; b: number; c: number; d: number; restAngle: number; stiffness: number }

export type SoftMesh = {
  /** World positions, xyz per particle. */
  positions: Float32Array
  /** Paper (unfolded) coordinates, xy per particle. */
  uv: Float32Array
  tris: Uint32Array
  /** One per mesh edge on a crease: rest angle = the crease's edges_foldAngle (degrees). */
  creaseHinges: Hinge[]
  /** One per mesh edge inside a face: rest angle 0 (flat paper). */
  bendHinges: Hinge[]
  /** Particles on the paper's outline. */
  boundary: Uint32Array
  /** Per frame edge, its particles from edges_vertices[e][0] to [1]. */
  edgeSamples: number[][]
  /** Per triangle, the frame face it fills. */
  triFace: Uint32Array
}

/** Crease stiffness by assignment: a pre-crease ('F', open) is a weakened line, not a hinge held at an angle. */
const CREASE_STIFFNESS: Record<string, number> = { V: 1, M: 1, F: 0.2, U: 0.2 }

type P = [number, number]

export function remesh(frame: Frame, poses: readonly FacePose[], targetEdge: number): SoftMesh {
  const h = Math.max(targetEdge, 1e-4)
  const uv: number[] = []
  const pos: number[] = []
  const owner: number[] = [] // the face whose pose places each particle
  const add = (p: readonly number[], face: number) => {
    uv.push(p[0]!, p[1]!)
    owner.push(face)
    return owner.length - 1
  }

  // faces around each frame edge (by vertex pair), to place shared particles
  const key = (u: number, v: number) => (u < v ? `${u} ${v}` : `${v} ${u}`)
  const facesOfSide = new Map<string, number[]>()
  frame.faces_vertices.forEach((vs, f) =>
    vs.forEach((u, i) => {
      const k = key(u, vs[(i + 1) % vs.length]!)
      facesOfSide.set(k, [...(facesOfSide.get(k) ?? []), f])
    }),
  )
  const vertexFace: number[] = []
  frame.faces_vertices.forEach((vs, f) => vs.forEach(v => (vertexFace[v] ??= f)))

  // 1. vertices and edge samples
  const vertexParticle = frame.vertices_coords.map((p, v) => add(p, vertexFace[v] ?? 0))
  const edgeOf = new Map<string, number>()
  const edgeSamples: number[][] = frame.edges_vertices.map(([u, v], e) => {
    edgeOf.set(key(u, v), e)
    const p = frame.vertices_coords[u]!
    const q = frame.vertices_coords[v]!
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / h - 1e-9))
    const face = facesOfSide.get(key(u, v))?.[0] ?? vertexFace[u] ?? 0
    const chain = [vertexParticle[u]!]
    for (let i = 1; i < n; i++) chain.push(add([p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n], face))
    chain.push(vertexParticle[v]!)
    return chain
  })

  // 2. each face: its side samples (in order), interior points, triangles
  const tris: number[] = []
  const triFace: number[] = []
  frame.faces_vertices.forEach((vs, f) => {
    const ring: number[] = []
    vs.forEach((u, i) => {
      const v = vs[(i + 1) % vs.length]!
      const e = edgeOf.get(key(u, v))
      let chain: number[]
      if (e === undefined) chain = [vertexParticle[u]!, vertexParticle[v]!]
      else chain = frame.edges_vertices[e]![0] === u ? edgeSamples[e]! : [...edgeSamples[e]!].reverse()
      ring.push(...chain.slice(0, -1))
    })
    const pt = (i: number): P => [uv[2 * i]!, uv[2 * i + 1]!]
    const poly = ring.map(pt)
    const ccw = signedArea(poly) > 0
    const loop = ccw ? ring : [...ring].reverse()
    const polyCcw = loop.map(pt)

    // interior lattice
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of polyCcw) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x)
      y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
    const inner: number[] = []
    const dy = (h * Math.sqrt(3)) / 2
    for (let r = 0, y = y0 + dy / 2; y < y1; r++, y += dy)
      for (let x = x0 + (r % 2 ? h / 2 : h / 4); x < x1; x += h) {
        const p: P = [x, y]
        if (inside(polyCcw, p) && distToPoly(polyCcw, p) > h * 0.5) inner.push(add(p, f))
      }

    const local = [...loop, ...inner]
    const ts = delaunay(local.map(pt)).filter(([a, b, c]) => {
      const A = pt(local[a]!)
      const B = pt(local[b]!)
      const C = pt(local[c]!)
      return inside(polyCcw, [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3])
    })
    const got = new Set(ts.flatMap(([a, b, c]) => [key(local[a]!, local[b]!), key(local[b]!, local[c]!), key(local[c]!, local[a]!)]))
    const conforms = loop.every((u, i) => got.has(key(u, loop[(i + 1) % loop.length]!)))
    if (conforms) {
      for (const [a, b, c] of ts) {
        const [A, B, C] = [local[a]!, local[b]!, local[c]!]
        if (orient(pt(A), pt(B), pt(C)) > 0) tris.push(A, B, C)
        else tris.push(A, C, B)
        triFace.push(f)
      }
    } else {
      // drop the interior points of this face (unused) and ear-clip its sides
      for (const [a, b, c] of earClip(polyCcw)) {
        tris.push(loop[a]!, loop[b]!, loop[c]!)
        triFace.push(f)
      }
    }
  })

  // 3. world positions
  const matrix = new Map(poses.map(p => [p.face, p.matrix]))
  for (let i = 0; i < owner.length; i++) {
    const m = matrix.get(owner[i]!) ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const x = uv[2 * i]!
    const y = uv[2 * i + 1]!
    pos.push(m[0]! * x + m[4]! * y + m[12]!, m[1]! * x + m[5]! * y + m[13]!, m[2]! * x + m[6]! * y + m[14]!)
  }

  // 4. hinges
  const creaseOfPair = new Map<string, number>()
  edgeSamples.forEach((chain, e) => {
    for (let i = 0; i + 1 < chain.length; i++) creaseOfPair.set(key(chain[i]!, chain[i + 1]!), e)
  })
  const wings = new Map<string, { a: number; b: number; c: number; d?: number }>()
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k]!
      const b = tris[t + ((k + 1) % 3)]!
      const c = tris[t + ((k + 2) % 3)]!
      const w = wings.get(key(a, b))
      // the triangle is counter-clockwise, so c is on the left of a → b
      if (!w) wings.set(key(a, b), { a, b, c })
      else w.d = c
    }
  const creaseHinges: Hinge[] = []
  const bendHinges: Hinge[] = []
  for (const [k, w] of wings) {
    if (w.d === undefined) continue
    const e = creaseOfPair.get(k)
    const asg = e === undefined ? '' : frame.edges_assignment[e]!
    if (e !== undefined && asg !== 'B') {
      creaseHinges.push({ a: w.a, b: w.b, c: w.c, d: w.d, restAngle: frame.edges_foldAngle[e] ?? 0, stiffness: CREASE_STIFFNESS[asg] ?? 1 })
    } else bendHinges.push({ a: w.a, b: w.b, c: w.c, d: w.d, restAngle: 0, stiffness: 1 })
  }

  const boundary = new Set<number>()
  frame.edges_assignment.forEach((a, e) => {
    if (a === 'B') for (const i of edgeSamples[e]!) boundary.add(i)
  })

  return {
    positions: Float32Array.from(pos),
    uv: Float32Array.from(uv),
    tris: Uint32Array.from(tris),
    creaseHinges,
    bendHinges,
    boundary: Uint32Array.from([...boundary].sort((x, y) => x - y)),
    edgeSamples,
    triFace: Uint32Array.from(triFace),
  }
}

// ---- 2D helpers ----

const orient = (a: P, b: P, c: P) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

function signedArea(poly: P[]): number {
  let s = 0
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length]!
    s += p[0] * q[1] - q[0] * p[1]
  })
  return s / 2
}

function inside(poly: P[], p: P): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!
    const [xj, yj] = poly[j]!
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

function distToPoly(poly: P[], p: P): number {
  let best = Infinity
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t))
  })
  return best
}

/** Bowyer–Watson Delaunay triangulation (indices into `pts`). */
function delaunay(pts: P[]): [number, number, number][] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  const d = Math.max(x1 - x0, y1 - y0) * 20 || 1
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const all: P[] = [...pts, [cx - d, cy - d], [cx + d, cy - d], [cx, cy + d]]
  const n = pts.length
  type T = { v: [number, number, number]; cx: number; cy: number; r2: number }
  const circ = (a: number, b: number, c: number): T => {
    const [ax, ay] = all[a]!
    const [bx, by] = all[b]!
    const [qx, qy] = all[c]!
    const D = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by))
    const ux = ((ax * ax + ay * ay) * (by - qy) + (bx * bx + by * by) * (qy - ay) + (qx * qx + qy * qy) * (ay - by)) / D
    const uy = ((ax * ax + ay * ay) * (qx - bx) + (bx * bx + by * by) * (ax - qx) + (qx * qx + qy * qy) * (bx - ax)) / D
    return { v: [a, b, c], cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 }
  }
  let tris: T[] = [circ(n, n + 1, n + 2)]
  for (let i = 0; i < n; i++) {
    const [px, py] = all[i]!
    const bad: T[] = []
    const keep: T[] = []
    for (const t of tris) ((px - t.cx) ** 2 + (py - t.cy) ** 2 < t.r2 * (1 + 1e-12) ? bad : keep).push(t)
    const count = new Map<string, [number, number]>()
    const seen = new Map<string, number>()
    for (const t of bad)
      for (let k = 0; k < 3; k++) {
        const a = t.v[k]!
        const b = t.v[(k + 1) % 3]!
        const kk = a < b ? `${a} ${b}` : `${b} ${a}`
        seen.set(kk, (seen.get(kk) ?? 0) + 1)
        count.set(kk, [a, b])
      }
    tris = keep
    for (const [kk, [a, b]] of count) if (seen.get(kk) === 1) tris.push(circ(a, b, i))
  }
  return tris.filter(t => t.v.every(v => v < n)).map(t => t.v)
}

/** Ear clipping of a simple counter-clockwise polygon. */
function earClip(poly: P[]): [number, number, number][] {
  const idx = poly.map((_, i) => i)
  const out: [number, number, number][] = []
  let guard = 0
  while (idx.length > 3 && guard++ < 10_000) {
    let cut = false
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length]!
      const b = idx[i]!
      const c = idx[(i + 1) % idx.length]!
      if (orient(poly[a]!, poly[b]!, poly[c]!) <= 1e-15) continue
      const tri = [poly[a]!, poly[b]!, poly[c]!]
      const blocked = idx.some(j => j !== a && j !== b && j !== c && inside(tri, poly[j]!))
      if (blocked) continue
      out.push([a, b, c])
      idx.splice(i, 1)
      cut = true
      break
    }
    if (!cut) break
  }
  if (idx.length === 3) out.push([idx[0]!, idx[1]!, idx[2]!])
  return out
}
