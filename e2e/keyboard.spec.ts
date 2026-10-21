// Keyboard-only folding (spec 04 section 2): from a blank sheet, Tab to the
// canvas, F (the keyboardFold action) shows the landmark cursor, arrows choose
// the grab corner, Enter grabs, arrows choose the target, Enter commits. Every
// mouse, pointer and wheel event is counted from before the app loads: there
// must be none.
import { expect, test } from '@playwright/test'
import { expectSteps, hint, openStudio, settle, stepList, studio } from './helpers'

const MOUSE_EVENTS = [
  'pointerdown', 'pointermove', 'pointerup', 'pointerover', 'pointerenter', 'mousedown', 'mousemove', 'mouseup',
  'mouseover', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel',
]

test('a complete fold from a blank sheet with the keyboard alone', async ({ page }) => {
  await page.addInitScript(events => {
    const w = window as unknown as { __mouse: string[] }
    w.__mouse = []
    for (const type of events) window.addEventListener(type, e => w.__mouse.push(`${type}${e.isTrusted ? '' : ' (synthetic)'}`), true)
  }, MOUSE_EVENTS)
  await openStudio(page)
  await expectSteps(page, 0)

  // Tab to the sheet (the canvas is a tab stop).
  const canvas = page.getByRole('application', { name: /Origami sheet/ })
  for (let i = 0; i < 40 && !(await canvas.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  await expect(canvas).toBeFocused()

  await page.keyboard.press('f')
  await expect(hint(page)).toHaveText(/^Keyboard fold: arrows or Tab choose a grab point/)
  // The cursor starts at the first landmark in reading order: the top-left corner (0, 1).
  await page.keyboard.press('ArrowRight') // top midpoint
  await page.keyboard.press('ArrowRight') // top-right corner (1, 1)
  await page.keyboard.press('Enter')
  await expect(hint(page)).toHaveText(/^Choose where to fold to\. Enter commits/)
  expect(await studio(page, s => s.gesture?.grab)).toEqual([1, 1])

  // Target: down the right edge, then left along the bottom to the bottom-left corner (0, 0).
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowLeft']) await page.keyboard.press(key)
  expect(await studio(page, s => ({ target: s.gesture?.target, previewing: s.preview !== null }))).toEqual({ target: [0, 0], previewing: true })
  await page.keyboard.press('Enter')
  await settle(page)

  await expectSteps(page, 1)
  await expect(stepList(page).getByRole('button', { name: /^1 · Valley fold · top flap · 180°/ })).toHaveAttribute('aria-current', 'step')
  await expect(page.getByRole('log', { name: 'Fold log' })).toContainText('Step 1: valley fold, top flap, 1 layer, 180 degrees.')
  // Undo is on the keyboard too.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(stepList(page).getByRole('button', { name: /^0 · Blank sheet/ })).toHaveAttribute('aria-current', 'step')

  expect(await page.evaluate(() => (window as unknown as { __mouse: string[] }).__mouse)).toEqual([])
})
