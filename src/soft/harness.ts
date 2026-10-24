// Browser-only checks of the WebGPU solver (e2e/soft.spec.ts), reached through
// the e2e build's test hook (window.__ori.soft). Each check reports
// `available: false` when the browser has no WebGPU device, and the spec
// skips.
import { PAPER_SIZES, commit, createPaper, poses, type Frame } from '@engine'
import { remesh, type SoftMesh } from './remesh'
import { SoftSolver, type SoftParams } from './xpbd'
import { GpuSolver, requestDevice } from './gpu/GpuSolver'
import { SoftSim } from './solver'

const PARAMS: SoftParams = { bendCompliance: 1e-2, creaseCompliance: 1e-4, iterations: 8, wet: true, gravity: [0, 0, -9.81] }

/** The reference mesh: a sheet with a valley fold standing at 90°. */
function reference(h = 0.125): SoftMesh {
  const r = commit(createPaper(PAPER_SIZES.square), { tool: 'fold', grab: [0.9, 0.5], target: [0.1, 0.5], layers: 1, kind: 'valley', progress: 1, snapAngle: false, angleDeg: 90 })
  const f: Frame = r.ok ? r.frame : createPaper(PAPER_SIZES.square)
  return remesh(f, poses(f), h)
}

/** Pin the left quarter of the sheet where it lies (both solvers alike). */
function clamp(mesh: SoftMesh, s: { pin(i: number, p: [number, number, number]): void }) {
  for (let i = 0; i < mesh.uv.length / 2; i++)
    if (mesh.uv[2 * i]! < 0.13) s.pin(i, [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!])
}

/** GPU vs CPU after `steps` steps of 1/60 s: the largest coordinate difference. */
export async function gpuVsCpu(steps = 200): Promise<{ available: boolean; maxDiff?: number; particles?: number; moved?: number; errors?: string[] }> {
  const device = await requestDevice()
  if (!device) return { available: false }
  const errors: string[] = []
  device.addEventListener('uncapturederror', e => errors.push((e as GPUUncapturedErrorEvent).error.message))
  const mesh = reference()
  const cpu = new SoftSolver(mesh, PARAMS)
  const gpu = new GpuSolver(device, mesh, PARAMS)
  clamp(mesh, cpu)
  clamp(mesh, gpu)
  for (let k = 0; k < steps; k++) {
    cpu.step(1 / 60)
    gpu.step(1 / 60)
  }
  const g = await gpu.read()
  const c = cpu.positions()
  let maxDiff = 0
  let moved = 0
  for (let i = 0; i < c.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(g[i]! - c[i]!))
    moved = Math.max(moved, Math.abs(c[i]! - mesh.positions[i]!))
  }
  gpu.dispose()
  device.destroy()
  return { available: true, maxDiff, particles: mesh.uv.length / 2, moved, errors }
}

/** Lose the device mid-simulation: the CPU solver takes over with the same positions. */
export async function deviceLoss(): Promise<{ available: boolean; kind?: string; kept?: boolean; finite?: boolean; reason?: string | null }> {
  const device = await requestDevice()
  if (!device) return { available: false }
  const mesh = reference()
  const gpu = new GpuSolver(device, mesh, PARAMS)
  const sim = new SoftSim(mesh, PARAMS, gpu)
  clamp(mesh, sim)
  for (let k = 0; k < 20; k++) sim.step(1 / 60)
  const before = Float32Array.from(await gpu.read())
  const switched = new Promise<void>(r => sim.onChange(() => r()))
  device.destroy() // a real loss: device.lost resolves
  await switched
  const after = sim.positions()
  const kept = before.every((x, i) => x === after[i])
  sim.step(1 / 60)
  return { available: true, kind: sim.kind, kept, finite: sim.positions().every(Number.isFinite), reason: sim.fellBack }
}

/**
 * A flat sheet resting on the desk under the soft-paper defaults: the highest
 * point after a second, on each solver. (Exactly flat hinges once read as half
 * turns on SwiftShader's atan2; solver.wgsl's atan2q fixed it.)
 */
export async function restingSheet(): Promise<{ available: boolean; gpu?: number; cpu?: number; errors?: string[] }> {
  const device = await requestDevice()
  if (!device) return { available: false }
  const errors: string[] = []
  device.addEventListener('uncapturederror', e => errors.push((e as GPUUncapturedErrorEvent).error.message))
  const { SOFT_PARAMS } = await import('./session')
  const f = createPaper(PAPER_SIZES.square)
  const mesh = remesh(f, poses(f), 1 / 32)
  const params = { ...SOFT_PARAMS, collide: false }
  const cpu = new SoftSolver(mesh, params)
  const gpu = new GpuSolver(device, mesh, params)
  for (let k = 0; k < 60; k++) {
    cpu.step(1 / 60)
    gpu.step(1 / 60)
  }
  const top = (p: ArrayLike<number>) => Math.max(...Array.from(p).filter((_, i) => i % 3 === 2))
  const g = await gpu.read()
  const out = { available: true, gpu: top(g), cpu: top(cpu.positions()), errors }
  gpu.dispose()
  device.destroy()
  return out
}

