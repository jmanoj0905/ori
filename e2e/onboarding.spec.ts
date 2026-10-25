// First visit (spec 03, R55): the coach mark points at a corner, is
// dismissible, never shows again; the release lift eases the flap down.
import { expect, test } from '@playwright/test'
import { drag, expectSteps, openStudio, px, settle } from './helpers'

test('the coach mark points at the top-right corner, "Got it" dismisses it for good', async ({ page }) => {
  await openStudio(page, { coach: true })
  const note = page.getByRole('note', { name: 'Tip' })
  await expect(note).toBeVisible()
  const [cx, cy] = await px(page, [1, 1])
  // The bubble sits just above-left of the corner, leaving the corner itself free.
  const box = (await note.boundingBox())!
  expect(Math.abs(box.x + box.width + 14 - cx)).toBeLessThan(2)
  expect(Math.abs(box.y + box.height + 14 - cy)).toBeLessThan(2)
  await note.getByRole('button', { name: 'Got it' }).click()
  await expect(note).toHaveCount(0)
  await page.reload()
  await page.waitForFunction(() => !!document.querySelector('[data-stage-host] canvas'))
  await expect(page.getByRole('note', { name: 'Tip' })).toHaveCount(0)
})

test('the corner under the coach mark can still be grabbed; the first fold ends onboarding', async ({ page }) => {
  await openStudio(page, { coach: true })
  await expect(page.getByRole('note', { name: 'Tip' })).toBeVisible()
  await drag(page, [0.99, 0.99], [0, 0])
  await expectSteps(page, 1)
  await expect(page.getByRole('note', { name: 'Tip' })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('ori.coach.v1'))).toBe('1')
})

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('a dragged flap hovers, and on release eases down over ~250 ms without changing the fold', async ({ page }) => {
    await openStudio(page)
    await drag(page, [0.99, 0.5], [0, 0.5], { release: false })
    const lifted = await page.evaluate(() => (window.__ori!.stage as unknown as { flapLift: number }).flapLift)
    expect(lifted).toBeGreaterThan(0)
    // Sample the lift every frame across the release.
    await page.evaluate(() => {
      const w = window as unknown as { __lifts: number[] }
      w.__lifts = []
      const t0 = performance.now()
      const tick = () => {
        w.__lifts.push((window.__ori!.stage as unknown as { flapLift: number }).flapLift)
        if (performance.now() - t0 < 600) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.mouse.up()
    await page.waitForTimeout(700)
    const lifts = await page.evaluate(() => (window as unknown as { __lifts: number[] }).__lifts)
    expect(lifts.at(-1)).toBe(0)
    expect(lifts.some(z => z > 0 && z < lifted)).toBe(true) // it eased, not jumped
    for (let i = 1; i < lifts.length; i++) expect(lifts[i]!).toBeLessThanOrEqual(lifts[i - 1]! + 1e-9)
    await settle(page)
    await expectSteps(page, 1)
  })
})
