// The CPU XPBD reference solver (spec 08; Plan 6 Task 2), and the test oracle
// for the GPU solver (gpu/GpuSolver.ts runs the same constraints in the same
// order).
//
// Extended position-based dynamics (Macklin, Müller and Chentanez 2016) with
// small steps (Macklin et al. 2019): each step(dt) runs `iterations`
// substeps of one constraint pass each, λ reset per substep. Constraints:
//   - distance: every mesh edge keeps its paper length (no stretching);
//   - bending: the dihedral of every hinge inside a face keeps its rest angle
//     (flat paper; `dry` re-rests it), compliance bendCompliance (× WET_SOFTER
//     when wet);
//   - crease hinges: the dihedral across a crease tends to its target angle,
//     compliance creaseCompliance / stiffness (× WET_SOFTER when wet);
//   - pins: a pinned particle has infinite mass and sits on its target.
// Constraints are graph-coloured (no two in a colour share a particle) and
// solved colour by colour, Gauss–Seidel across colours. Inside a colour the
// order does not matter, which is what lets the GPU solve a colour in
// parallel and still agree with this solver.
//
// Time: dt is clamped to MAX_DT (1/30 s), so a long pause (a backgrounded tab:
// rAF stops, then reports a huge delta) is one ordinary step, never an
// explosion. Non-finite or non-positive dt does nothing.
import { dihedral, dihedralGradient } from './dihedral'
import type { SoftMesh } from './remesh'
import { collide, type CollisionOptions, type CollisionResult } from './collision'

export const MAX_DT = 1 / 30
/** Wet paper: bending and crease compliance are multiplied by this (softer). */
export const WET_SOFTER = 25
/** Share of a substep's slide along the desk that friction takes back. */
export const DESK_FRICTION = 0.9
const DEG = Math.PI / 180

export type Vec3 = [number, number, number]

export type SoftParams = {
  bendCompliance: number
  creaseCompliance: number
  /** Substeps per step (each one constraint pass). */
  iterations: number
  wet: boolean
  gravity?: Vec3
  /** Velocity damping per second (0: none). */
  damping?: number
  /** Self-collision (visual; collision.ts), after every substep's constraint pass. */
  collide?: boolean | CollisionOptions
  /** The desk: no particle goes below this z (null: no desk). */
  floor?: number | null
}

/** The packed constraints, shared with the GPU solver. */
export type Constraints = {
  /** Distance constraints: particle pairs, their rest lengths; sorted by colour. */
  dist: Uint32Array
  distRest: Float64Array
  /** distanceColors[k] … distanceColors[k + 1] − 1 are colour k. */
  distanceColors: number[]
  /** Hinges (a, b, c, d) as 4 particles each, sorted by colour. */
  hinge: Uint32Array
  /** Rest angle (radians) per hinge. */
  hingeRest: Float64Array
  /** 1 for a crease hinge (creaseCompliance / stiffness), 0 for a bending hinge (bendCompliance). */
  hingeIsCrease: Uint8Array
  hingeStiffness: Float64Array
  hingeColors: number[]
  /** Per particle mass (paper area around it). */
  mass: Float64Array
}

/** Greedy graph colouring of constraints over particles; returns the order and the colour offsets. */
function colour(n: number, parts: (i: number) => number[]): { order: number[]; offsets: number[] } {
  const colourOf = new Int32Array(n).fill(-1)
  const used: Set<number>[] = []
  for (let i = 0; i < n; i++) {
    const ps = parts(i)
    let k = 0
    while (used[k] && ps.some(p => used[k]!.has(p))) k++
    used[k] ??= new Set()
    for (const p of ps) used[k]!.add(p)
    colourOf[i] = k
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => colourOf[a]! - colourOf[b]! || a - b)
  const offsets = [0]
  for (let k = 0; k < used.length; k++) offsets.push(offsets[k]! + order.filter(i => colourOf[i] === k).length)
  return { order, offsets }
}

export function buildConstraints(mesh: SoftMesh): Constraints {
  const n = mesh.uv.length / 2
  const pairs = new Map<string, [number, number]>()
  const mass = new Float64Array(n)
  for (let t = 0; t < mesh.tris.length; t += 3) {
    const [a, b, c] = [mesh.tris[t]!, mesh.tris[t + 1]!, mesh.tris[t + 2]!]
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) pairs.set(u < v ? `${u} ${v}` : `${v} ${u}`, u < v ? [u, v] : [v, u])
    const area = Math.abs((mesh.uv[2 * b]! - mesh.uv[2 * a]!) * (mesh.uv[2 * c + 1]! - mesh.uv[2 * a + 1]!) - (mesh.uv[2 * c]! - mesh.uv[2 * a]!) * (mesh.uv[2 * b + 1]! - mesh.uv[2 * a + 1]!)) / 2
    for (const p of [a, b, c]) mass[p] += area / 3
  }
  const edges = [...pairs.values()]
  const dc = colour(edges.length, i => edges[i]!)
  const dist = new Uint32Array(2 * edges.length)
  const distRest = new Float64Array(edges.length)
  dc.order.forEach((e, k) => {
    const [u, v] = edges[e]!
    dist[2 * k] = u
    dist[2 * k + 1] = v
    distRest[k] = Math.hypot(mesh.uv[2 * u]! - mesh.uv[2 * v]!, mesh.uv[2 * u + 1]! - mesh.uv[2 * v + 1]!)
  })
  const hs = [...mesh.creaseHinges.map(h => ({ ...h, crease: 1 })), ...mesh.bendHinges.map(h => ({ ...h, crease: 0 }))]
  const hc = colour(hs.length, i => [hs[i]!.a, hs[i]!.b, hs[i]!.c, hs[i]!.d])
  const hinge = new Uint32Array(4 * hs.length)
  const hingeRest = new Float64Array(hs.length)
  const hingeIsCrease = new Uint8Array(hs.length)
  const hingeStiffness = new Float64Array(hs.length)
  hc.order.forEach((i, k) => {
    const h = hs[i]!
    hinge.set([h.a, h.b, h.c, h.d], 4 * k)
    hingeRest[k] = h.restAngle * DEG
    hingeIsCrease[k] = h.crease
    hingeStiffness[k] = h.stiffness
  })
  return { dist, distRest, distanceColors: dc.offsets, hinge, hingeRest, hingeIsCrease, hingeStiffness, hingeColors: hc.offsets, mass }
}

const wrap = (x: number) => x - 2 * Math.PI * Math.round(x / (2 * Math.PI))

export class SoftSolver {
  readonly mesh: SoftMesh
  readonly constraints: Constraints
  protected params: Required<SoftParams>
  /** The last substep's self-collision result (skipped cells render rigid). */
  lastCollision: CollisionResult = { contacts: 0, skippedCells: 0 }
  protected x: Float64Array
  protected prev: Float64Array
  protected v: Float64Array
  protected invMass: Float64Array
  protected pinned = new Map<number, Vec3>()
  private grad = new Float64Array(12)
  private out: Float32Array

  constructor(mesh: SoftMesh, params: SoftParams, constraints = buildConstraints(mesh)) {
    this.mesh = mesh
    this.constraints = constraints
    this.params = { gravity: [0, 0, -9.81], damping: 0.5, collide: false, floor: null, ...params }
    this.x = Float64Array.from(mesh.positions)
    this.prev = this.x.slice()
    this.v = new Float64Array(this.x.length)
    this.invMass = Float64Array.from(constraints.mass, m => (m > 0 ? 1 / m : 0))
    this.out = new Float32Array(this.x.length)
  }

  setParams(p: Partial<SoftParams>): void {
    this.params = { ...this.params, ...p }
  }
  getParams(): SoftParams {
    return { ...this.params }
  }

  pin(i: number, p: Vec3): void {
    if (i < 0 || 3 * i >= this.x.length) return
    this.pinned.set(i, [p[0], p[1], p[2]])
    this.x.set(p, 3 * i)
    this.v.fill(0, 3 * i, 3 * i + 3)
  }
  unpin(i: number): void {
    this.pinned.delete(i)
  }
  /** The pinned particles and their targets. */
  pins(): Map<number, Vec3> {
    return new Map(this.pinned)
  }

  /** Copy positions in (device-loss hand-over, tests). */
  setPositions(p: ArrayLike<number>): void {
    for (let i = 0; i < this.x.length; i++) this.x[i] = p[i]!
    this.prev.set(this.x)
    this.v.fill(0)
  }

  positions(): Float32Array {
    for (let i = 0; i < this.x.length; i++) this.out[i] = this.x[i]!
    return this.out
  }

  /** The fastest particle's speed. */
  maxSpeed(): number {
    let m = 0
    for (let i = 0; i < this.v.length; i += 3) m = Math.max(m, Math.hypot(this.v[i]!, this.v[i + 1]!, this.v[i + 2]!))
    return m
  }

  /** The largest relative stretch of a mesh edge. */
  maxStretch(): number {
    const { dist, distRest } = this.constraints
    let m = 0
    for (let k = 0; k < distRest.length; k++) {
      const a = dist[2 * k]!
      const b = dist[2 * k + 1]!
      const l = Math.hypot(this.x[3 * a]! - this.x[3 * b]!, this.x[3 * a + 1]! - this.x[3 * b + 1]!, this.x[3 * a + 2]! - this.x[3 * b + 2]!)
      m = Math.max(m, Math.abs(l - distRest[k]!) / distRest[k]!)
    }
    return m
  }

  /** Wet folding dries: every hinge takes its current angle as its rest angle, and the sheet comes to rest. */
  dry(): void {
    const { hinge, hingeRest } = this.constraints
    for (let k = 0; k < hingeRest.length; k++) hingeRest[k] = dihedral(this.x, hinge[4 * k]!, hinge[4 * k + 1]!, hinge[4 * k + 2]!, hinge[4 * k + 3]!)
    this.v.fill(0)
  }

  /** Set every crease hinge's target to `deg` (curved creases, tests); bending hinges keep theirs. */
  setCreaseTargets(deg: number): void {
    const { hingeRest, hingeIsCrease } = this.constraints
    for (let k = 0; k < hingeRest.length; k++) if (hingeIsCrease[k]) hingeRest[k] = deg * DEG
  }

  step(dt: number): void {
    if (!(dt > 0)) return
    const h = Math.min(dt, MAX_DT) / Math.max(1, Math.round(this.params.iterations))
    for (let s = 0; s < Math.max(1, Math.round(this.params.iterations)); s++) this.substep(h)
  }

  protected substep(h: number): void {
    const { x, prev, v, invMass } = this
    const [gx, gy, gz] = this.params.gravity
    for (let i = 0, p = 0; p < invMass.length; p++, i += 3) {
      prev[i] = x[i]!
      prev[i + 1] = x[i + 1]!
      prev[i + 2] = x[i + 2]!
      if (invMass[p] === 0 || this.pinned.has(p)) continue
      v[i] += gx * h
      v[i + 1] += gy * h
      v[i + 2] += gz * h
      x[i] += v[i]! * h
      x[i + 1] += v[i + 1]! * h
      x[i + 2] += v[i + 2]! * h
    }
    for (const [p, t] of this.pinned) x.set(t, 3 * p)
    const w = (p: number) => (this.pinned.has(p) ? 0 : invMass[p]!)
    // hinges first, lengths last: the shape a substep ends on is inextensible
    this.solveHinges(h, w)
    this.solveDistances(h, w)
    this.afterSolve(prev, w)
    const keep = Math.exp(-this.params.damping * h)
    for (let i = 0; i < x.length; i++) v[i] = ((x[i]! - prev[i]!) / h) * keep
  }

  /** After each substep's constraint pass: the desk, then self-collision, when on. */
  protected afterSolve(prev: Float64Array, w: (p: number) => number): void {
    const floor = this.params.floor
    if (floor !== null && floor !== undefined)
      for (let i = 0; i < this.x.length; i += 3) {
        if (this.x[i + 2]! >= floor) continue
        // on the desk: held there, and most of this substep's slide taken back (friction)
        this.x[i + 2] = floor
        this.x[i] = prev[i]! + (this.x[i]! - prev[i]!) * (1 - DESK_FRICTION)
        this.x[i + 1] = prev[i + 1]! + (this.x[i + 1]! - prev[i + 1]!) * (1 - DESK_FRICTION)
      }
    const c = this.params.collide
    if (c) this.lastCollision = collide(this.x, prev, this.mesh, w, c === true ? {} : c)
  }

  private solveDistances(h: number, w: (p: number) => number): void {
    const { x } = this
    const { dist, distRest, distanceColors } = this.constraints
    void h // distance constraints are stiff (zero compliance)
    for (let k = 0; k + 1 < distanceColors.length; k++)
      for (let c = distanceColors[k]!; c < distanceColors[k + 1]!; c++) {
        const a = dist[2 * c]!
        const b = dist[2 * c + 1]!
        const wa = w(a)
        const wb = w(b)
        if (wa + wb === 0) continue
        const dx = x[3 * a]! - x[3 * b]!
        const dy = x[3 * a + 1]! - x[3 * b + 1]!
        const dz = x[3 * a + 2]! - x[3 * b + 2]!
        const l = Math.hypot(dx, dy, dz)
        if (l < 1e-12) continue
        const C = l - distRest[c]!
        const s = -C / (wa + wb) / l
        x[3 * a] += wa * s * dx
        x[3 * a + 1] += wa * s * dy
        x[3 * a + 2] += wa * s * dz
        x[3 * b] -= wb * s * dx
        x[3 * b + 1] -= wb * s * dy
        x[3 * b + 2] -= wb * s * dz
      }
  }

  private solveHinges(h: number, w: (p: number) => number): void {
    const { x, grad } = this
    const { hinge, hingeRest, hingeIsCrease, hingeStiffness, hingeColors } = this.constraints
    const wet = this.params.wet ? WET_SOFTER : 1
    const bend = this.params.bendCompliance * wet
    const crease = this.params.creaseCompliance * wet
    const h2 = h * h
    for (let k = 0; k + 1 < hingeColors.length; k++)
      for (let c = hingeColors[k]!; c < hingeColors[k + 1]!; c++) {
        const alpha = hingeIsCrease[c] ? crease / Math.max(hingeStiffness[c]!, 1e-9) : bend
        if (!Number.isFinite(alpha)) continue
        const p = [hinge[4 * c]!, hinge[4 * c + 1]!, hinge[4 * c + 2]!, hinge[4 * c + 3]!]
        const C = wrap(dihedral(x, p[0]!, p[1]!, p[2]!, p[3]!) - hingeRest[c]!)
        dihedralGradient(x, p[0]!, p[1]!, p[2]!, p[3]!, grad)
        let denom = 0
        for (let j = 0; j < 4; j++) denom += w(p[j]!) * (grad[3 * j]! ** 2 + grad[3 * j + 1]! ** 2 + grad[3 * j + 2]! ** 2)
        const at = alpha / h2
        if (denom + at < 1e-12) continue
        const dl = -C / (denom + at)
        for (let j = 0; j < 4; j++) {
          const wj = w(p[j]!) * dl
          x[3 * p[j]!] += wj * grad[3 * j]!
          x[3 * p[j]! + 1] += wj * grad[3 * j + 1]!
          x[3 * p[j]! + 2] += wj * grad[3 * j + 2]!
        }
      }
  }
}
