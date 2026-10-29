// Living creases and layer picking (spec 09), end to end: the three acceptance
// scenarios with the mouse alone, and picking layers from the press-and-hold
// belt. Each scenario checks the step list and the mini crease pattern (open
// creases are drawn there as .cp-open, faint and solid).
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { drag, expectSteps, foldLayers, holdForLayers, openStudio, settle, stepList, studio, type Vec2 } from './helpers'

const cp = (page: Page, kind: 'open' | 'valley' | 'mountain') => page.locator(`.mini-cp .cp-${kind}`)

/** Every mini-CP line of `kind` runs one way: 'h' (horizontal) or 'v' (vertical). */
async function allRun(page: Page, kind: 'open' | 'valley', way: 'h' | 'v'): Promise<boolean> {
  return cp(page, kind).evaluateAll((ls, way) => ls.every(l => {
    const n = (a: string) => Number(l.getAttribute(a))
    return way === 'h' ? Math.abs(n('y1') - n('y2')) < 1e-6 : Math.abs(n('x1') - n('x2')) < 1e-6
  }), way)
}

/**
 * Fold `from` onto `to`, then swing the flap straight back open. The swing presses just inside
 * the flap's tip (which sits on `to`), as a person would: on the paper's very corner the pick
 * can land on the layer underneath, and lifting that one turns the whole sheet face down.
 */
async function preCrease(page: Page, from: Vec2, to: Vec2) {
  await drag(page, from, to)
  const tip: Vec2 = [to[0] + (from[0] - to[0]) * 0.05, to[1] + (from[1] - to[1]) * 0.05]
  await drag(page, tip, from)
}

test.beforeEach(async ({ page }) => {
  await openStudio(page)
  await expectSteps(page, 0)
})

test('open the second of two folds', async ({ page }) => {
  await drag(page, [0.99, 0.5], [0, 0.5]) // book fold: right half over the left
  await drag(page, [0.25, 0.99], [0.25, 0]) // the top layer down, along y = 0.5
  await expectSteps(page, 2)
  await drag(page, [0.25, 0.02], [0.25, 0.99]) // lift that flap back over its hinge
  await expectSteps(page, 3)
  await expect(stepList(page).getByRole('button', { name: /^3 · Unfold · top flap/ })).toHaveAttribute('aria-current', 'step')
  // Only the second fold opened: the book fold is still a valley, the second fold an open crease.
  expect(await cp(page, 'valley').count()).toBeGreaterThan(0)
  expect(await cp(page, 'open').count()).toBeGreaterThan(0)
  expect(await allRun(page, 'valley', 'v')).toBe(true)
  expect(await allRun(page, 'open', 'h')).toBe(true)
  await expect(cp(page, 'mountain')).toHaveCount(0)
})

test('refold reversed: the mountain lands on the opened crease', async ({ page }) => {
  await preCrease(page, [0.99, 0.99], [0.5, 0.5]) // a corner to the centre, then open again
  await expectSteps(page, 2)
  expect(await cp(page, 'open').count()).toBeGreaterThan(0)
  const edges = await studio(page, s => s.history.frames[s.history.cursor].edges_vertices.length)
  await page.locator('[data-stage-host] canvas').focus()
  await page.keyboard.press('m')
  await drag(page, [0.99, 0.99], [0.53, 0.49]) // a little off: the crease snap locks it onto the old line
  await expectSteps(page, 3)
  await expect(stepList(page).getByRole('button', { name: /^3 · Mountain fold · top flap/ })).toBeVisible()
  // The same crease, folded the other way: no new edge, and nothing left open.
  expect(await studio(page, s => s.history.frames[s.history.cursor].edges_vertices.length)).toBe(edges)
  expect(await cp(page, 'mountain').count()).toBeGreaterThan(0)
  await expect(cp(page, 'open')).toHaveCount(0)
  await expect(cp(page, 'valley')).toHaveCount(0)
})

test('waterbomb from pre-creases', async ({ page }) => {
  await preCrease(page, [0.99, 0.99], [0, 0])
  await preCrease(page, [0.01, 0.99], [1, 0])
  await preCrease(page, [0.5, 0.99], [0.5, 0])
  await preCrease(page, [0.99, 0.5], [0, 0.5])
  await expectSteps(page, 8)
  // All four lines are open creases now, and nothing is folded.
  expect(await cp(page, 'open').count()).toBeGreaterThanOrEqual(4)
  await expect(cp(page, 'valley')).toHaveCount(0)
  await expect(cp(page, 'mountain')).toHaveCount(0)

  // Collapse along them with the waterbomb lesson's own moves (src/lessons/data/waterbomb.json).
  const lesson = JSON.parse(readFileSync('src/lessons/data/waterbomb.json', 'utf8')) as {
    steps: { tool: string; allowMirror?: boolean; target: unknown; demo?: { grab: Vec2; target: Vec2; layers: number } }[]
  }
  const canvas = page.locator('[data-stage-host] canvas')
  for (const step of lesson.steps) {
    if (step.tool === 'turnOver') {
      await canvas.focus()
      await page.keyboard.press('t')
      await settle(page)
      continue
    }
    const d = step.demo!
    if (step.tool === 'squash') await page.getByRole('button', { name: 'Squash', exact: true }).click()
    await foldLayers(page, d.grab, d.target, d.layers) // the squash presses right on the open diagonal
  }
  await expectSteps(page, 8 + lesson.steps.length)
  const last = lesson.steps.at(-1)!
  const result = await page.evaluate(async ({ target, allowMirror }) => {
    const { checkStep } = await (window.__ori as unknown as { check(): Promise<{ checkStep(a: unknown, t: unknown, o: { allowMirror: boolean }): { match: boolean; reason?: string } }> }).check()
    const s = window.__ori!.store.getState()
    return checkStep(s.history.frames[s.history.cursor], target, { allowMirror })
  }, { target: last.target, allowMirror: last.allowMirror ?? false })
  expect(result).toEqual({ match: true })
})

test('belt: hold the half-folded sheet, slide onto row 2 and drag out', async ({ page }) => {
  await drag(page, [0.99, 0.5], [0, 0.5])
  await expectSteps(page, 1)
  const [rx, ry] = await holdForLayers(page, [0.25, 0.5], 2)
  await expect(page.locator('.layer-belt')).toBeVisible()
  await page.mouse.move(rx - 90, ry, { steps: 4 }) // out of the belt, along the row
  await expect(page.locator('.layer-belt')).toHaveCount(0)
  await expect(page.getByTestId('layer-badge')).toHaveText('2 of 2 layers')
  await page.mouse.up()
  await settle(page)
})
