import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, createPaper, poses } from '@engine'
import { remesh, type SoftMesh } from './remesh'
import { SoftSolver, type SoftParams } from './xpbd'
import { CPU_MAX_PARTICLES, SoftSim, createSolver, transfer, type GpuLike } from './solver'

const sheet = createPaper(PAPER_SIZES.square)
const meshOf = (h: number) => remesh(sheet, poses(sheet), h)
const params: SoftParams = { bendCompliance: 1e-2, creaseCompliance: 1e-4, iterations: 8, wet: false, gravity: [0, 0, -2] }

/** A "GPU" solver stand-in: the CPU solver with a device that can be lost. */
function fakeGpu(mesh: SoftMesh) {
  let lose!: (info: { message: string }) => void
  const s = new SoftSolver(mesh, params)
  const gpu: GpuLike & { disposed: boolean } = Object.assign(s, {
    lost: new Promise<{ message: string }>(r => (lose = r)),
    disposed: false,
    dispose() { gpu.disposed = true },
  })
  return { gpu, lose: (m = 'GPU reset') => lose({ message: m }) }
}

describe('solver choice and device loss (Review Focus 5)', () => {
  test('without WebGPU the CPU solver runs', async () => {
    const sim = await createSolver(meshOf(0.25), params, { gpu: null })
    expect(sim.kind).toBe('cpu')
    sim.step(1 / 60)
    expect(sim.positions().every(Number.isFinite)).toBe(true)
  })

  test('a lost device hands over to the CPU solver, keeping the positions and the pins, at reduced resolution', async () => {
    const mesh = meshOf(0.125)
    const { gpu, lose } = fakeGpu(mesh)
    const sim = new SoftSim(mesh, params, gpu)
    let changed = 0
    sim.onChange(() => changed++)
    sim.pin(0, [0, 0, 0.2])
    for (let k = 0; k < 30; k++) sim.step(1 / 60)
    const before = Float32Array.from(sim.positions())
    expect(sim.kind).toBe('gpu')
    lose()
    await Promise.resolve()
    await Promise.resolve()
    expect(sim.kind).toBe('cpu')
    expect(sim.fellBack).toBe('GPU reset')
    expect(gpu.disposed).toBe(true)
    expect(changed).toBe(1)
    expect(Array.from(sim.positions())).toEqual(Array.from(before)) // the model is not lost
    expect(sim.getParams().iterations).toBe(4) // half the substeps
    sim.step(1 / 60)
    expect(Array.from(sim.positions().slice(0, 3))).toEqual([0, 0, Math.fround(0.2)]) // the pin holds
  })

  test(`above ${CPU_MAX_PARTICLES} particles the fallback also coarsens the mesh, carrying the shape over`, async () => {
    const fine = meshOf(0.02)
    expect(fine.uv.length / 2).toBeGreaterThan(CPU_MAX_PARTICLES)
    const { gpu, lose } = fakeGpu(fine)
    // a known shape: the sheet lifted and tilted (z = 0.3 + 0.2 x)
    const lifted = new Float32Array(fine.positions.length)
    for (let i = 0; i < lifted.length / 3; i++) lifted.set([fine.uv[2 * i]!, fine.uv[2 * i + 1]!, 0.3 + 0.2 * fine.uv[2 * i]!], 3 * i)
    gpu.setPositions(lifted)
    const sim = new SoftSim(fine, params, gpu, { coarsen: () => meshOf(0.1) })
    lose()
    await Promise.resolve()
    await Promise.resolve()
    expect(sim.kind).toBe('cpu')
    expect(sim.mesh.uv.length / 2).toBeLessThan(CPU_MAX_PARTICLES)
    const p = sim.positions()
    for (let i = 0; i < sim.mesh.uv.length / 2; i++) expect(p[3 * i + 2]!).toBeCloseTo(0.3 + 0.2 * sim.mesh.uv[2 * i]!, 4)
  })

  test('transfer interpolates through the paper', () => {
    const a = meshOf(0.2)
    const b = meshOf(0.07)
    const pos = new Float32Array(a.positions.length)
    for (let i = 0; i < pos.length / 3; i++) pos.set([a.uv[2 * i]! * 2, a.uv[2 * i + 1]!, a.uv[2 * i]! + a.uv[2 * i + 1]!], 3 * i)
    const out = transfer(a, pos, b)
    for (let i = 0; i < b.uv.length / 2; i++) {
      expect(out[3 * i]).toBeCloseTo(b.uv[2 * i]! * 2, 5)
      expect(out[3 * i + 2]).toBeCloseTo(b.uv[2 * i]! + b.uv[2 * i + 1]!, 5)
    }
  })
})
