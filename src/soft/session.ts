// A soft-paper session (spec 08; Plan 6 Task 4): what runs while Soft paper is
// on. Loaded on demand by the app shell.
//
//   start: the current frame is remeshed (its curved creases, if any, with
//     their rulings), the solver is picked (WebGPU, else CPU) and the Stage
//     shows the soft mesh in place of the rigid paper.
//   every animation frame: one solver step of the real elapsed time (the
//     solver clamps it to 1/30 s, so a backgrounded tab resumes calmly), the
//     Stage takes the positions, and the quality governor trades iterations,
//     then mesh resolution, for frame rate.
//   pointer: a primary-button drag grabs the sheet where it is pressed (the
//     nearest particle is pinned and follows the pointer on a plane facing the
//     camera); releasing lets go, and with Wet on the shape dries in place.
//     Other buttons (orbit, pan) and the wheel pass through to the Stage.
//   Curve fold: with a curved crease (a chain of short creases), the slider
//     folds it exactly (curvedFold) and the solver keeps the result.
//   stop: the loop and listeners end, the Stage shows rigid paper again, and
//     the final mesh and positions are returned for the hand-off (handoff.ts).
import { poses as posesOf, type Frame, type Vec2 } from '@engine'
import { remesh, type SoftMesh } from './remesh'
import { createSolver, transfer, type SoftSim } from './solver'
import { QualityGovernor } from './governor'
import { curveRulings, curvedFold } from './curvedCrease'
import type { SoftParams } from './xpbd'

/** What the session needs of the Stage. */
export type SoftStage = {
  readonly canvas: HTMLCanvasElement
  showSoft(tris: Uint32Array, uv: Float32Array, positions: Float32Array): void
  updateSoft(positions: ArrayLike<number>): void
  hideSoft(): void
  pickSoft(clientX: number, clientY: number): { index: number; point: [number, number, number] } | null
  rayAt(clientX: number, clientY: number, through: readonly [number, number, number]): [number, number, number]
}

export type SessionState = { solver: 'gpu' | 'cpu'; curves: number; level: number; iterations: number }

export type SessionOptions = {
  /** The crease pattern with the designer's own assignments (a pattern step's record), when the frame's are flattened. */
  cp?: Frame
  gpu?: GPU | null
  /** Animation frames (tests drive them by hand). */
  raf?: (cb: (t: number) => void) => number
  caf?: (id: number) => void
  onState?: (s: SessionState) => void
}

export const SOFT_PARAMS: SoftParams = {
  bendCompliance: 2e-3,
  creaseCompliance: 1e-3,
  iterations: 8,
  wet: false,
  gravity: [0, 0, -2],
  damping: 2,
  floor: 0,
  collide: { thickness: 0.004 },
}
/** About 2,000 particles on a unit sheet; each coarser level is 1.5× the edge. */
export const BASE_EDGE = 1 / 32
const COARSER = 1.5

type Curve = { points: Vec2[]; valley: boolean }

/**
 * Curved creases: chains of at least four crease edges through interior
 * vertices where exactly two creases meet and turn gently (under 30°), turning
 * some in all (over 5°). Points in order along the chain.
 */
export function findCurves(frame: Frame, cp: Frame = frame): Curve[] {
  const crease = (e: number) => frame.edges_assignment[e] !== 'B'
  const byVertex = new Map<number, number[]>()
  const onBoundary = new Set<number>()
  frame.edges_vertices.forEach(([u, v], e) => {
    if (!crease(e)) {
      onBoundary.add(u)
      onBoundary.add(v)
      return
    }
    for (const x of [u, v]) byVertex.set(x, [...(byVertex.get(x) ?? []), e])
  })
  const P = (v: number) => frame.vertices_coords[v]!
  const turn = (a: number, b: number, c: number) => {
    const [p, q, r] = [P(a), P(b), P(c)]
    const t1 = Math.atan2(q[1] - p[1], q[0] - p[0])
    const t2 = Math.atan2(r[1] - q[1], r[0] - q[0])
    return Math.abs(((t2 - t1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
  }
  const inner = (v: number) => !onBoundary.has(v) && byVertex.get(v)?.length === 2
  const seen = new Set<number>()
  const out: Curve[] = []
  frame.edges_vertices.forEach(([u0, v0], e0) => {
    if (!crease(e0) || seen.has(e0)) return
    // walk both ways through smooth inner vertices
    const chain = [u0, v0]
    const edges = [e0]
    for (const forward of [true, false]) {
      for (;;) {
        const end = forward ? chain.at(-1)! : chain[0]!
        const prev = forward ? chain.at(-2)! : chain[1]!
        if (!inner(end)) break
        const next = byVertex.get(end)!.find(e => !edges.includes(e))
        if (next === undefined) break
        const [a, b] = frame.edges_vertices[next]!
        const far = a === end ? b : a
        if (turn(prev, end, far) > Math.PI / 6 || chain.includes(far)) break
        edges.push(next)
        if (forward) chain.push(far)
        else chain.unshift(far)
      }
    }
    edges.forEach(e => seen.add(e))
    if (edges.length < 4) return
    let total = 0
    for (let i = 1; i + 1 < chain.length; i++) total += turn(chain[i - 1]!, chain[i]!, chain[i + 1]!)
    if (total < (5 * Math.PI) / 180) return
    const valley = cp.edges_assignment[e0] !== 'M'
    out.push({ points: chain.map(P).map(p => [p[0], p[1]] as Vec2), valley })
  })
  return out
}

export class SoftSession {
  readonly frame: Frame
  sim!: SoftSim
  mesh!: SoftMesh
  private stage: SoftStage
  private governor = new QualityGovernor({ iterations: SOFT_PARAMS.iterations, minIterations: 2, maxLevel: 2 })
  private curves: Curve[]
  private h: number
  private raf: (cb: (t: number) => void) => number
  private caf: (id: number) => void
  private frameId = 0
  private last = -1
  private stopped = false
  private grab: { pointer: number; index: number; through: [number, number, number] } | null = null
  private host: HTMLElement
  private opts: SessionOptions
  private wet = false
  private coarsenPending = false

  private constructor(stage: SoftStage, frame: Frame, opts: SessionOptions) {
    this.stage = stage
    this.frame = frame
    this.opts = opts
    this.curves = findCurves(frame, opts.cp)
    let w = 0
    let hgt = 0
    for (const [x, y] of frame.vertices_coords) {
      w = Math.max(w, x)
      hgt = Math.max(hgt, y)
    }
    this.h = Math.sqrt(Math.max(w * hgt, 1e-6)) * BASE_EDGE
    this.raf = opts.raf ?? (cb => requestAnimationFrame(cb))
    this.caf = opts.caf ?? (id => cancelAnimationFrame(id))
    this.host = stage.canvas.parentElement ?? stage.canvas
  }

  static async start(stage: SoftStage, frame: Frame, opts: SessionOptions = {}): Promise<SoftSession> {
    const s = new SoftSession(stage, frame, opts)
    s.mesh = s.build(s.h)
    s.sim = await createSolver(s.mesh, SOFT_PARAMS, { gpu: opts.gpu, coarsen: m => s.coarser(m) })
    s.sim.onChange(sim => {
      s.mesh = sim.mesh
      s.stage.showSoft(s.mesh.tris, s.mesh.uv, sim.positions())
      s.report()
    })
    stage.showSoft(s.mesh.tris, s.mesh.uv, s.sim.positions())
    s.host.addEventListener('pointerdown', s.down, true)
    window.addEventListener('pointermove', s.move, true)
    window.addEventListener('pointerup', s.up, true)
    window.addEventListener('pointercancel', s.up, true)
    s.report()
    s.frameId = s.raf(s.tick)
    return s
  }

  private build(h: number): SoftMesh {
    const rulings = this.curves.flatMap(c => curveRulings(c.points))
    return remesh(this.frame, posesOf(this.frame), h, { rulings })
  }

  private coarser(m: SoftMesh): SoftMesh {
    void m
    this.h *= COARSER
    return this.build(this.h)
  }

  private report(): void {
    this.opts.onState?.({ solver: this.sim.kind, curves: this.curves.length, level: this.governor.level, iterations: this.governor.iterations })
  }

  get curveCount(): number {
    return this.curves.length
  }

  private readonly tick = (t: number): void => {
    if (this.stopped) return
    if (this.last >= 0) {
      const ms = t - this.last
      this.sim.step(ms / 1000)
      this.stage.updateSoft(this.sim.positions())
      const g = this.governor.update(ms)
      if (g.iterations !== this.sim.getParams().iterations) this.sim.setParams({ iterations: g.iterations })
      if (g.coarsen) this.coarsenPending = true
      // a new mesh would drop the particle in hand: coarsen between grabs
      if (this.coarsenPending && !this.grab) {
        this.coarsenPending = false
        this.rebuildCoarser()
      }
    }
    this.last = t
    this.frameId = this.raf(this.tick)
  }

  /** The governor asked for a coarser mesh: rebuild it and carry the shape over. */
  private rebuildCoarser(): void {
    const old = this.mesh
    const positions = Float32Array.from(this.sim.positions())
    const next = this.coarser(old)
    const params = this.sim.getParams()
    void createSolver(next, params, { gpu: this.sim.kind === 'gpu' ? this.opts.gpu : null, coarsen: m => this.coarser(m) }).then(sim => {
      if (this.stopped) return sim.dispose()
      sim.setPositions(transfer(old, positions, next))
      this.sim.dispose()
      this.sim = sim
      this.mesh = next
      this.stage.showSoft(next.tris, next.uv, sim.positions())
      this.report()
    })
  }

  private readonly down = (e: PointerEvent): void => {
    if (e.button !== 0 || this.grab) return
    const hit = this.stage.pickSoft(e.clientX, e.clientY)
    if (!hit) return
    e.preventDefault()
    e.stopPropagation() // the fold gesture never sees a soft grab
    this.grab = { pointer: e.pointerId, index: hit.index, through: hit.point }
    this.sim.pin(hit.index, hit.point)
  }

  private readonly move = (e: PointerEvent): void => {
    const g = this.grab
    if (!g || e.pointerId !== g.pointer) return
    e.stopPropagation()
    const p = this.stage.rayAt(e.clientX, e.clientY, g.through)
    const floor = SOFT_PARAMS.floor ?? -Infinity
    this.sim.pin(g.index, [p[0], p[1], Math.max(p[2], floor)]) // never into the desk
  }

  private readonly up = (e: PointerEvent): void => {
    const g = this.grab
    if (!g || e.pointerId !== g.pointer) return
    e.stopPropagation()
    this.grab = null
    this.sim.unpin(g.index)
    if (this.wet) this.sim.dry() // decision 2: a wet fold dries on release
  }

  setWet(on: boolean): void {
    this.wet = on
    this.sim.setParams({ wet: on })
  }

  /** Fold the first curved crease to `deg` (0 flattens it back to the frame's pose), and hold it there. */
  setCurve(deg: number): boolean {
    const c = this.curves[0]
    if (!c) return false
    const pos = deg > 0 ? curvedFold(this.mesh.uv, c.points, deg, c.valley) : Float32Array.from(this.mesh.positions)
    if (!pos) return false
    this.sim.setPositions(pos)
    this.sim.dry()
    this.stage.updateSoft(this.sim.positions())
    return true
  }

  /** End the session; the mesh and its final positions (for the hand-off). */
  stop(): { mesh: SoftMesh; positions: Float32Array } {
    const out = { mesh: this.mesh, positions: Float32Array.from(this.sim.positions()) }
    this.stopped = true
    this.caf(this.frameId)
    this.host.removeEventListener('pointerdown', this.down, true)
    window.removeEventListener('pointermove', this.move, true)
    window.removeEventListener('pointerup', this.up, true)
    window.removeEventListener('pointercancel', this.up, true)
    this.stage.hideSoft()
    this.sim.dispose()
    return out
  }
}
