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

test('soft paper in the studio: on shows the soft sheet; off with no edit snaps back to the exact frame (no step)', async ({ page }) => {
  await page.evaluate(() => window.__ori!.settings.getState().update({ softPaper: true }))
  const tools = page.getByRole('region', { name: 'Tools' })
  const soft = tools.getByRole('button', { name: 'Soft paper' })
  await soft.click()
  await expect(soft).toHaveAttribute('aria-pressed', 'true')
  await expect(tools.getByRole('button', { name: 'Wet' })).toBeEnabled()
  expect(await page.evaluate(() => (window.__ori!.stage as unknown as { softShown: boolean }).softShown)).toBe(true)
  await page.waitForTimeout(500) // the sheet settles on the desk
  await soft.click()
  await expect(soft).toHaveAttribute('aria-pressed', 'false')
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.__ori!.store.getState().history.steps.length)).toBe(0)
  expect(await page.evaluate(() => (window.__ori!.stage as unknown as { softShown: boolean }).softShown)).toBe(false)
})

test('leaving soft paper with a sculpted shape keeps it as a step; undo is back on the exact folded frame', async ({ page }) => {
  await page.evaluate(() => window.__ori!.settings.getState().update({ softPaper: true }))
  const tools = page.getByRole('region', { name: 'Tools' })
  await tools.getByRole('button', { name: 'Soft paper' }).click()
  await tools.getByRole('button', { name: 'Wet' }).click()
  const [x, y] = await page.evaluate(() => window.__ori!.stage.clientOf([0.95, 0.95]))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 250, y - 120, { steps: 15 })
  await page.waitForTimeout(600)
  await page.mouse.up() // wet: it dries in this shape
  await page.waitForTimeout(300)
  await tools.getByRole('button', { name: 'Soft paper' }).click()
  await expect.poll(() => page.evaluate(() => window.__ori!.store.getState().history.steps.map((s: { kind: string }) => s.kind))).toEqual(['sculpted'])
  expect(await page.evaluate(() => (window.__ori!.stage as unknown as { softShown: boolean }).softShown)).toBe(true) // drawn from the snapshot
  await expect(page.getByRole('list', { name: 'Fold steps' })).toContainText('Sculpted (soft paper)')
  await page.getByRole('button', { name: 'Undo' }).click()
  expect(await page.evaluate(() => window.__ori!.store.getState().history.cursor)).toBe(0)
  expect(await page.evaluate(() => (window.__ori!.stage as unknown as { softShown: boolean }).softShown)).toBe(false)
})

test('a flat sheet resting on the desk stays flat on the GPU, as on the CPU', async ({ page }) => {
  const r = await page.evaluate(async () => ((await (window.__ori as unknown as { soft(): Promise<{ restingSheet(): Promise<{ available: boolean; gpu?: number; cpu?: number; errors?: string[] }> }> }).soft()).restingSheet()))
  console.log(`[soft] ${JSON.stringify(r)}`)
  expect(r).toMatchObject({ available: true, errors: [] })
  expect(r.cpu!).toBeLessThan(1e-4)
  expect(r.gpu!).toBeLessThan(1e-4)
})
