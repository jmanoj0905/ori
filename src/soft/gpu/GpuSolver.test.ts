// WebGPU-only: these run where the test environment has navigator.gpu (a
// browser runner) and skip cleanly elsewhere (Node / jsdom). The same checks
// run in Chromium through e2e/soft.spec.ts.
import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, createPaper, poses } from '@engine'
import { remesh } from '../remesh'
import { SoftSolver, type SoftParams } from '../xpbd'

const gpu = (globalThis.navigator as (Navigator & { gpu?: GPU }) | undefined)?.gpu

describe.skipIf(!gpu)('GpuSolver (WebGPU)', () => {
  test('agrees with the CPU solver within 1e-3 after 200 steps', async () => {
    const { GpuSolver, requestDevice } = await import('./GpuSolver')
    const device = await requestDevice(gpu)
    if (!device) return
    const f = createPaper(PAPER_SIZES.square)
    const mesh = remesh(f, poses(f), 0.125)
    const params: SoftParams = { bendCompliance: 1e-2, creaseCompliance: 1e-4, iterations: 8, wet: true, gravity: [0, 0, -9.81] }
    const cpu = new SoftSolver(mesh, params)
    const g = new GpuSolver(device, mesh, params)
    for (let i = 0; i < mesh.uv.length / 2; i++)
      if (mesh.uv[2 * i]! < 0.13) for (const s of [cpu, g]) s.pin(i, [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, 0])
    for (let k = 0; k < 200; k++) {
      cpu.step(1 / 60)
      g.step(1 / 60)
    }
    const a = await g.read()
    const b = cpu.positions()
    expect(Math.max(...Array.from(a, (x, i) => Math.abs(x - b[i]!)))).toBeLessThan(1e-3)
  })
})
