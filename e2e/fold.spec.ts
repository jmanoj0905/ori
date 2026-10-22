// Folding with the mouse, end to end (spec 03): a fold, Esc cancel, a refused
// crease, compound tools (squash, reverse), undo / redo, jumping to a step,
// the pointer leaving mid-drag (Review Focus 2) and the preset confirm dialog.
//
// Compound folds: the cup preset contains no reverse or squash step, so the
// base they need (a square folded in half twice into the "double triangle":
// corner (0,1) onto (1,0), then (0,0) onto (1,1) through both layers, the
// crane's first two steps) is folded through the UI here.
import { expect, test, type Page } from '@playwright/test'
import { drag, expectSteps, hint, openStudio, playPreset, settle, stepList, studio, type Vec2 } from './helpers'

const MISS = 'That crease misses the paper.'

const folding = (page: Page) => page.locator('.studio[data-folding]')

/** Fold `from` onto `to`, adding `extraLayers` with ] while the button is held. */
async function foldWith(page: Page, from: Vec2, to: Vec2, extraLayers = 0) {
  await drag(page, from, to, { release: false })
  for (let i = 0; i < extraLayers; i++) await page.keyboard.press(']')
  await page.mouse.up()
  await settle(page)
}

/** The double triangle: two folds, four layers, open along P–Q = (1,0)–(1,1). */
async function doubleTriangle(page: Page) {
  await foldWith(page, [0.01, 0.99], [1, 0])
  await foldWith(page, [0.015, 0.005], [1, 1], 1) // inside the triangle (y < x), snaps to (0,0)
  await expectSteps(page, 2)
  await expect(stepList(page).getByRole('button', { name: /^2 · .*2 layers/ })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await openStudio(page)
  await expectSteps(page, 0)
  await expect(hint(page)).toHaveText('Grab a corner and drag it across.')
})

test('dragging the top-right corner to the bottom-left folds the sheet: one step', async ({ page }) => {
  await drag(page, [0.99, 0.99], [0, 0])
  await expectSteps(page, 1)
  const step = stepList(page).getByRole('button', { name: /^1 · Valley fold · top flap · 180°/ })
  await expect(step).toHaveAttribute('aria-current', 'step')
  // Snapped to the corners: (1,1) landed on (0,0), the crease is the diagonal.
  const crease = await studio(page, s => s.history.steps[0].params.crease)
  expect(Math.abs(crease.vector[0] + crease.vector[1])).toBeLessThan(1e-6)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
})

test('Esc mid-drag cancels the fold: no preview is left and the release commits nothing', async ({ page }) => {
  await drag(page, [0.98, 0.98], [0.4, 0.4], { release: false })
  await expect(folding(page)).toHaveCount(1)
  expect(await studio(page, s => s.preview !== null)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(folding(page)).toHaveCount(0)
  expect(await studio(page, s => ({ g: s.gesture, p: s.preview }))).toEqual({ g: null, p: null })
  await page.mouse.up()
  await settle(page)
  await expectSteps(page, 0)
})

test('the pointer leaving mid-drag (window blur) cancels cleanly, as Esc does', async ({ page }) => {
  await drag(page, [0.98, 0.5], [0.6, 0.5], { release: false })
  await expect(folding(page)).toHaveCount(1)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(folding(page)).toHaveCount(0)
  expect(await studio(page, s => s.preview)).toBeNull()
  await page.mouse.up()
  await settle(page)
  await expectSteps(page, 0)
  // The studio is still usable: the next drag folds.
  await drag(page, [0.99, 0.5], [0, 0.5])
  await expectSteps(page, 1)
})

test('a crease off the paper is refused: the hint says why and nothing is folded', async ({ page }) => {
  // Grab near the right edge, drag further right: the crease (the bisector) lies beyond the sheet.
  await drag(page, [0.9, 0.5], [1.3, 0.5], { release: false })
  await expect(hint(page)).toHaveText(MISS)
  await expect(hint(page)).toHaveAttribute('data-refusal', '')
  await page.mouse.up()
  await settle(page)
  await expectSteps(page, 0)
  await expect(hint(page)).toHaveText(MISS)
})

test('squash fold on the double triangle', async ({ page }) => {
  await doubleTriangle(page)
  await page.getByRole('button', { name: 'Squash', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Squash', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await drag(page, [0.9, 0.5], [0.6, 0.1])
  await expectSteps(page, 3)
  await expect(stepList(page).getByRole('button', { name: '3 · Squash fold' })).toHaveAttribute('aria-current', 'step')
  // The tool returns to Fold after one compound fold (default setting).
  await expect(page.getByRole('button', { name: 'Fold', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('inside reverse fold on the double triangle (R key, all four layers)', async ({ page }) => {
  await doubleTriangle(page)
  await page.locator('[data-stage-host] canvas').focus()
  await page.keyboard.press('r')
  await expect(page.getByRole('button', { name: 'Reverse', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await foldWith(page, [0.95, 0.1], [0.95, 0.4], 3)
  await expectSteps(page, 3)
  await expect(stepList(page).getByRole('button', { name: '3 · Inside reverse fold · 4 layers' })).toBeVisible()
})

test('undo, redo and jumping to a step', async ({ page }) => {
  await drag(page, [0.99, 0.5], [0, 0.5]) // book fold
  await drag(page, [0.25, 0.99], [0.25, 0]) // top layer down
  await expectSteps(page, 2)
  const s1 = stepList(page).getByRole('button', { name: /^1 · / })
  const s2 = stepList(page).getByRole('button', { name: /^2 · / })
  await expect(s2).toHaveAttribute('aria-current', 'step')

  await page.keyboard.press('ControlOrMeta+z')
  await expect(s1).toHaveAttribute('aria-current', 'step')
  await expect(s2).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()

  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(s2).toHaveAttribute('aria-current', 'step')
  await expect(s2).not.toHaveAttribute('aria-disabled', 'true')

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(stepList(page).getByRole('button', { name: /^0 · Blank sheet/ })).toHaveAttribute('aria-current', 'step')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(s1).toHaveAttribute('aria-current', 'step')

  // Jump: a greyed future step is still clickable (jump forward = redo), and back again.
  // (It is aria-disabled, which Playwright's actionability check treats as disabled: force.)
  await s2.click({ force: true })
  await expect(s2).toHaveAttribute('aria-current', 'step')
  await stepList(page).getByRole('button', { name: /^0 · Blank sheet/ }).click()
  expect(await studio(page, s => s.history.cursor)).toBe(0)
  await s1.click({ force: true })
  expect(await studio(page, s => s.history.cursor)).toBe(1)
  await expectSteps(page, 2) // jumping never drops steps
})

test('choosing a preset over your work asks first: Cancel keeps it, Play preset replaces it', async ({ page }) => {
  await drag(page, [0.99, 0.99], [0, 0])
  await expectSteps(page, 1)
  const presets = page.getByRole('group', { name: 'Presets' })

  await presets.getByRole('button', { name: 'Cup' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Replace your work?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Playing a preset starts a new sheet and replaces your folds.')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expectSteps(page, 1)

  // Esc also cancels.
  await presets.getByRole('button', { name: 'Cup' }).click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expectSteps(page, 1)

  await playPreset(page, 'Cup', 6)
  await expect(stepList(page).getByRole('button', { name: /^5 · Turn over/ })).toBeVisible()
  await expect(stepList(page).getByRole('button', { name: /^6 · / })).toHaveAttribute('aria-current', 'step')
})
