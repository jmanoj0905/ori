// Picking the solver (Plan 6 Task 3): the WebGPU one where the browser has it,
// the CPU reference otherwise, and the hand-over when the GPU device is lost
// (Review Focus 5): the model keeps its shape (the last positions read back
// and every pin) and carries on in the CPU solver at reduced resolution —
// half the substeps and, above CPU_MAX_PARTICLES, a coarser mesh with the
// positions carried over through the paper coordinates.
import { SoftSolver, type SoftParams, type Vec3 } from './xpbd'
import type { SoftMesh } from './remesh'

/** What the rest of the app drives (both solvers have it). */
export interface Solver {
  step(dt: number): void
  pin(i: number, p: Vec3): void
  unpin(i: number): void
  positions(): Float32Array
  setPositions(p: ArrayLike<number>): void
  setParams(p: Partial<SoftParams>): void
  getParams(): SoftParams
  dry(): void
  setCreaseTargets(deg: number): void
}

/** A GPU solver as SoftSim sees it (GpuSolver, or a stand-in in tests). */
export type GpuLike = Solver & { lost: Promise<unknown>; pins(): Map<number, Vec3>; dispose(): void }

/** Above this many particles the CPU fallback runs on a coarser mesh. */
export const CPU_MAX_PARTICLES = 1500

/** Map positions from mesh `from` onto mesh `to` through the paper (uv): each new particle is interpolated in the old triangle under it. */
export function transfer(from: SoftMesh, positions: ArrayLike<number>, to: SoftMesh): Float32Array {
  const out = new Float32Array(to.uv.length * 1.5)
  const nt = from.tris.length / 3
  for (let i = 0; i < to.uv.length / 2; i++) {
    const px = to.uv[2 * i]!
    const py = to.uv[2 * i + 1]!
    let best = { t: 0, l: [1, 0, 0], err: Infinity }
    for (let t = 0; t < nt; t++) {
      const [a, b, c] = [from.tris[3 * t]!, from.tris[3 * t + 1]!, from.tris[3 * t + 2]!]
      const ax = from.uv[2 * a]!, ay = from.uv[2 * a + 1]!
      const bx = from.uv[2 * b]! - ax, by = from.uv[2 * b + 1]! - ay
      const cx = from.uv[2 * c]! - ax, cy = from.uv[2 * c + 1]! - ay
      const det = bx * cy - by * cx
      if (Math.abs(det) < 1e-18) continue
      const v = ((px - ax) * cy - (py - ay) * cx) / det
      const w = (bx * (py - ay) - by * (px - ax)) / det
      const u = 1 - v - w
      const err = Math.max(0, -u, -v, -w) // 0 inside the triangle
      if (err < best.err) best = { t, l: [u, v, w], err }
      if (err === 0) break
    }
    const ids = [from.tris[3 * best.t]!, from.tris[3 * best.t + 1]!, from.tris[3 * best.t + 2]!]
    for (let k = 0; k < 3; k++) out[3 * i + k] = ids.reduce((s, id, j) => s + best.l[j]! * positions[3 * id + k]!, 0)
  }
  return out
}

/**
 * The soft model's solver. `kind` says which one runs; after a device loss it
 * is 'cpu' for good, and `fellBack` says why.
 */
export class SoftSim implements Solver {
  kind: 'gpu' | 'cpu'
  mesh: SoftMesh
  fellBack: string | null = null
  private impl: Solver
  private gpu: GpuLike | null
  private coarsen?: (m: SoftMesh) => SoftMesh
  private listeners = new Set<(s: SoftSim) => void>()

  constructor(mesh: SoftMesh, params: SoftParams, gpu: GpuLike | null, opts: { coarsen?: (m: SoftMesh) => SoftMesh } = {}) {
    this.mesh = mesh
    this.gpu = gpu
    this.coarsen = opts.coarsen
    this.kind = gpu ? 'gpu' : 'cpu'
    this.impl = gpu ?? new SoftSolver(mesh, params)
    if (gpu) void gpu.lost.then(info => this.fallBack(info))
  }

  /** Called whenever the solver (or its mesh) changes: the renderer rebuilds its geometry. */
  onChange(fn: (s: SoftSim) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private fallBack(info: unknown): void {
    const gpu = this.gpu
    if (!gpu || this.impl !== gpu) return
    const params = gpu.getParams()
    const positions = Float32Array.from(gpu.positions())
    const pins = gpu.pins()
    let mesh = this.mesh
    let pos: ArrayLike<number> = positions
    let pinMap = pins
    if (mesh.uv.length / 2 > CPU_MAX_PARTICLES && this.coarsen) {
      const coarse = this.coarsen(mesh)
      pos = transfer(mesh, positions, coarse)
      // each pin moves to the coarse particle nearest it in the paper
      pinMap = new Map()
      for (const [i, p] of pins) {
        let best = 0
        let bd = Infinity
        for (let j = 0; j < coarse.uv.length / 2; j++) {
          const d = Math.hypot(coarse.uv[2 * j]! - mesh.uv[2 * i]!, coarse.uv[2 * j + 1]! - mesh.uv[2 * i + 1]!)
          if (d < bd) [bd, best] = [d, j]
        }
        pinMap.set(best, p)
      }
      mesh = coarse
    }
    const cpu = new SoftSolver(mesh, { ...params, iterations: Math.max(2, Math.floor(params.iterations / 2)) })
    cpu.setPositions(pos)
    for (const [i, p] of pinMap) cpu.pin(i, p)
    this.impl = cpu
    this.mesh = mesh
    this.kind = 'cpu'
    this.gpu = null
    this.fellBack = String((info as { message?: string } | undefined)?.message ?? 'device lost')
    try {
      gpu.dispose()
    } catch {
      /* already gone */
    }
    for (const fn of this.listeners) fn(this)
  }

  step(dt: number) { this.impl.step(dt) }
  pin(i: number, p: Vec3) { this.impl.pin(i, p) }
  unpin(i: number) { this.impl.unpin(i) }
  positions() { return this.impl.positions() }
  setPositions(p: ArrayLike<number>) { this.impl.setPositions(p) }
  setParams(p: Partial<SoftParams>) { this.impl.setParams(p) }
  getParams() { return this.impl.getParams() }
  dry() { this.impl.dry() }
  setCreaseTargets(deg: number) { this.impl.setCreaseTargets(deg) }
  dispose() { this.gpu?.dispose() }
}

/**
 * The solver for `mesh`: WebGPU when a device is available (the GPU module is
 * loaded on demand), else the CPU one.
 */
export async function createSolver(
  mesh: SoftMesh,
  params: SoftParams,
  opts: { gpu?: GPU | null; coarsen?: (m: SoftMesh) => SoftMesh } = {},
): Promise<SoftSim> {
  const gpu = opts.gpu === undefined ? (globalThis.navigator as Navigator | undefined)?.gpu : opts.gpu
  if (gpu) {
    const { GpuSolver, requestDevice } = await import('./gpu/GpuSolver')
    const device = await requestDevice(gpu)
    if (device) {
      const solver = new GpuSolver(device, mesh, params)
      if (await solver.valid) return new SoftSim(mesh, params, solver, opts)
      solver.dispose()
      device.destroy()
    }
  }
  return new SoftSim(mesh, params, null, opts)
}
