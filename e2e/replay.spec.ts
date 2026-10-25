// Replay, end to end (spec 05 "Replay"; Plan 3 task 4, R61 / R62): play the cup
// preset, open replay, scrub to the middle (a fold in progress), screenshot it
// (an attachment, not a baseline: it only has to render), then exit and check
// the Stage is back on the last step and the history was never touched.
import { expect, test, type Page } from '@playwright/test'
import { openStudio, playPreset, settle, studio } from './helpers'

/** Which history frame the Stage is drawing (its private `frame`), or -1; and whether a preview is up. */
const stageShows = (page: Page) =>
  page.evaluate(() => {
    const o = window.__ori! as any
    const h = o.store.getState().history
    return { index: h.frames.indexOf(o.stage.frame), preview: o.stage.preview !== null, cursor: h.cursor }
  })

test('replay the cup: scrub to the middle, then exit back to the last step', async ({ page }, info) => {
  // Motion on, so the scrub shows the fold in progress (reduced motion lands on whole steps).
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await openStudio(page)
  await playPreset(page, 'Cup', 6)
  const before = await studio(page, s => JSON.stringify({ c: s.history.cursor, n: s.history.steps.length }))

  await page.getByRole('button', { name: 'Replay', exact: true }).click()
  const bar = page.getByRole('region', { name: 'Replay' })
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Pause' })).toBeFocused()
  await bar.getByRole('button', { name: 'Pause' }).click()
  await expect(bar.getByRole('button', { name: 'Play', exact: true })).toBeVisible()

  // Editing is suspended: the dock is inert and undo is off.
  await expect(page.locator('.dock')).toHaveAttribute('inert', '')
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()

  const slider = bar.getByRole('slider', { name: 'Replay position' })
  await slider.fill('2.5')
  await expect(slider).toHaveAttribute('aria-valuetext', 'Step 3 of 6')
  await settle(page)
  const mid = await stageShows(page)
  expect(mid.index).toBe(2) // frames[2], with step 3 swinging on top
  expect(mid.preview).toBe(true)
  const shot = await page.screenshot({ path: info.outputPath('replay-middle.png') })
  expect(shot.byteLength).toBeGreaterThan(10_000)
  await info.attach('replay-middle', { body: shot, contentType: 'image/png' })

  // Keyboard: whole steps.
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuetext', 'Step 3 of 6')
  expect((await stageShows(page)).index).toBe(3)

  // Esc exits; the Stage is back on the last step, and nothing in the history moved.
  await page.keyboard.press('Escape')
  await expect(bar).toHaveCount(0)
  await settle(page)
  const after = await stageShows(page)
  expect(after).toEqual({ index: 6, preview: false, cursor: 6 })
  expect(await studio(page, s => JSON.stringify({ c: s.history.cursor, n: s.history.steps.length }))).toBe(before)
  await expect(page.getByRole('button', { name: 'Replay', exact: true })).toBeFocused()
  await expect(page.locator('.dock')).not.toHaveAttribute('inert', '')
  expect(errors).toEqual([])
})
