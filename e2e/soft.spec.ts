// The WebGPU soft-paper solver in a real browser (Plan 6 Task 3), through the
// e2e build's hook (window.__ori.soft → src/soft/harness.ts). WebGPU-only:
// each test skips cleanly when the browser has no navigator.gpu or adapter.
import { expect, test } from '@playwright/test'
import { openStudio } from './helpers'

type Harness = {
  gpuVsCpu(steps?: number): Promise<{ available: boolean; maxDiff?: number; particles?: number; moved?: number }>
  deviceLoss(): Promise<{ available: boolean; kind?: string; kept?: boolean; finite?: boolean; reason?: string | null }>
}

test.beforeEach(async ({ page }) => {
  await openStudio(page)
  const gpu = await page.evaluate(async () => !!(navigator as Navigator & { gpu?: GPU }).gpu && !!(await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter()))
  test.skip(!gpu, 'WebGPU is not available in this browser')
})

test('the GPU and CPU solvers agree within 1e-3 after 200 steps on the reference mesh', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const h = (await (window.__ori as unknown as { soft(): Promise<Harness> }).soft())
    return h.gpuVsCpu(200)
  })
  console.log(`[soft] ${JSON.stringify(r)}`)
  expect(r.available).toBe(true)
  expect(r.moved!).toBeGreaterThan(0.01) // the sheet really moved
  expect(r.maxDiff!).toBeLessThan(1e-3)
})

test('a device loss switches to the CPU solver and keeps the positions (Review Focus 5)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const h = (await (window.__ori as unknown as { soft(): Promise<Harness> }).soft())
    return h.deviceLoss()
  })
  console.log(`[soft] ${JSON.stringify(r)}`)
  expect(r).toMatchObject({ available: true, kind: 'cpu', kept: true, finite: true })
})
