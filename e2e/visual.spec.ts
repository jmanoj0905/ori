// Screenshot baselines (spec 02): the blank sheet, a half fold, the finished
// paper plane, a live preview mid-drag, and a blocked preview.
//
// Stabilised: 1280×800 at deviceScaleFactor 1, reduced motion (no settle, no
// framing tween), fonts loaded and two frames rendered before each shot, the
// pointer parked off the paper (no hover ring), caret hidden. A small pixel
// tolerance (playwright.config.ts) absorbs GPU anti-aliasing noise.
// Baselines live in e2e/__screenshots__/; refresh them deliberately with
// `npm run e2e -- e2e/visual.spec.ts --update-snapshots`.
//
// The blocked preview is a real engine verdict, not a forced flag: after the
// book fold, the top flap is mountain-folded, so it would have to swing down
// through the layer beneath it (the engine's "flap swung down through the
// layer beneath is blocked at once" case).
import { expect, test, type Page } from '@playwright/test'
import { drag, expectSteps, frames, hint, openStudio, playPreset, settle } from './helpers'

/** Park the pointer where it hovers nothing (no landmark ring), then wait for a quiet frame. */
async function still(page: Page) {
  await page.mouse.move(640, 4)
  await frames(page, 3)
}

test.beforeEach(async ({ page }) => {
  await openStudio(page)
})

test('blank sheet', async ({ page }) => {
  await still(page)
  await expect(page).toHaveScreenshot('blank-sheet.png')
})

test('half fold', async ({ page }) => {
  await drag(page, [0.99, 0.5], [0, 0.5])
  await expectSteps(page, 1)
  await still(page)
  await expect(page).toHaveScreenshot('half-fold.png')
})

test('finished paper plane', async ({ page }) => {
  await playPreset(page, 'Paper plane', 8)
  await still(page)
  await expect(page).toHaveScreenshot('paper-plane.png')
})

test('preview mid-drag', async ({ page }) => {
  await drag(page, [0.99, 0.99], [0.3, 0.35], { release: false })
  await expect(page.locator('.studio[data-folding]')).toHaveCount(1)
  await frames(page, 3)
  await expect(page).toHaveScreenshot('preview.png')
  await page.mouse.up()
  await settle(page)
})

test('blocked preview', async ({ page }) => {
  await drag(page, [0.99, 0.5], [0, 0.5]) // book fold: the right half lies on the left
  await page.locator('[data-stage-host] canvas').focus()
  await page.keyboard.press('m') // mountain: the top flap would swing down through the bottom layer
  await drag(page, [0.1, 0.5], [0.4, 0.5], { release: false })
  await expect(hint(page)).toHaveText('Flap would pass through paper.')
  await expect(hint(page)).toHaveAttribute('data-blocked', '')
  await frames(page, 3)
  await expect(page).toHaveScreenshot('blocked-preview.png')
  await page.keyboard.press('Escape')
  await page.mouse.up()
})
