// Guided lessons (spec 06, Plan 4 Task 3): the cup lesson completed with the
// keyboard alone (no mouse, pointer or wheel event at all), with the target
// ghost on the Stage, then an axe scan of the lesson outline and summary.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openStudio, settle, studio } from './helpers'

const MOUSE_EVENTS = [
  'pointerdown', 'pointermove', 'pointerup', 'pointerover', 'pointerenter', 'mousedown', 'mousemove', 'mouseup',
  'mouseover', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel',
]

/** Tab forward until `target` has focus. */
async function tabTo(page: Page, target: ReturnType<Page['getByRole']>) {
  for (let i = 0; i < 80 && !(await target.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  await expect(target).toBeFocused()
}

const near = (a: number[] | undefined, b: number[]) => !!a && Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-6

test('complete the cup lesson with the keyboard alone', async ({ page }) => {
  await page.addInitScript(events => {
    const w = window as unknown as { __mouse: string[] }
    w.__mouse = []
    // a button activated with Enter fires a click with detail 0 (no pointer involved): that is keyboard use
    for (const type of events)
      window.addEventListener(type, e => {
        if (type === 'click' && (e as MouseEvent).detail === 0) return
        w.__mouse.push(`${type}${e.isTrusted ? '' : ' (synthetic)'}`)
      }, true)
  }, MOUSE_EVENTS)
  await openStudio(page)

  // Open the lesson menu and start the cup (keyboard: Tab, Enter)
  await tabTo(page, page.getByRole('button', { name: 'Lessons' }))
  await page.keyboard.press('Enter')
  const cup = page.getByRole('group', { name: 'Lessons' }).getByRole('button', { name: /^Cup/ })
  await expect(cup).toBeVisible()
  await tabTo(page, cup)
  await page.keyboard.press('Enter')
  const outline = page.getByRole('region', { name: 'Lesson' })
  await expect(outline.getByRole('heading', { name: 'Cup' })).toBeVisible()
  await settle(page)
  expect(await page.evaluate(() => (window.__ori!.stage as unknown as { targetShown: { shown: boolean } }).targetShown.shown)).toBe(true)
  await expect(page.getByRole('button', { name: 'Fold', exact: true })).toHaveAttribute('data-lesson', 'expected')

  const steps: { tool: string; demo?: { grab: number[]; target: number[]; layers: number } }[] = await studio(page, s =>
    s.lessonData.steps.map((x: { tool: string; demo?: unknown }) => ({ tool: x.tool, demo: x.demo })),
  )
  const canvas = page.getByRole('application', { name: /Origami sheet/ })
  for (const [i, step] of steps.entries()) {
    await expect(outline.getByRole('button', { name: new RegExp(`^${i + 1} · `) })).toHaveAttribute('aria-current', 'step')
    await tabTo(page, canvas)
    if (step.tool === 'turnOver') {
      await page.keyboard.press('t')
    } else {
      const d = step.demo!
      await page.keyboard.press('f') // the cursor starts on the lesson's grab point
      await page.keyboard.press('Enter')
      expect(near(await studio(page, s => s.gesture?.grab), d.grab)).toBe(true)
      for (let n = 0; n < 60 && !near(await studio(page, s => s.gesture?.target), d.target); n++) await page.keyboard.press('Tab')
      expect(near(await studio(page, s => s.gesture?.target), d.target)).toBe(true)
      if (d.layers > 1) {
        await page.keyboard.press('l') // the layer belt, top layer first
        for (let k = 1; k < d.layers; k++) await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
      }
      await page.keyboard.press('Enter')
    }
    await settle(page)
    await expect.poll(() => studio(page, s => s.lesson.index)).toBe(i + 1)
  }

  const summary = page.getByRole('group', { name: 'Lesson summary' })
  await expect(summary).toContainText('Steps done6')
  await expect(summary).toContainText('Skipped0')
  await expect(page.getByRole('log', { name: 'Fold log' })).toContainText('Lesson complete: Cup. 6 of 6 steps folded, 0 skipped')
  expect(await page.evaluate(() => (window as unknown as { __mouse: string[] }).__mouse)).toEqual([])

  // Free fold from here: back to the sandbox with the cup kept
  await tabTo(page, summary.getByRole('button', { name: 'Free fold from here' }))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('list', { name: 'Fold steps' }).getByRole('listitem')).toHaveCount(7)
})

test('lesson outline and hint: no serious or critical axe violations; the target pulses after two misses', async ({ page }) => {
  await openStudio(page)
  await page.evaluate(() => window.__ori!.store.getState().startLesson('cup'))
  const outline = page.getByRole('region', { name: 'Lesson' })
  await expect(outline).toBeVisible()
  await settle(page)
  // two misses: a book fold where the diagonal is expected
  for (let k = 0; k < 2; k++) {
    await page.evaluate(async () => {
      const s = window.__ori!.store.getState()
      s.begin([0.5, 1])
      window.__ori!.store.getState().drag([0.5, 0], 1)
      await window.__ori!.store.getState().release()
    })
    await settle(page)
  }
  await expect(outline.locator('.lesson-hint')).toBeVisible()
  expect(await page.evaluate(() => (window.__ori!.stage as unknown as { targetShown: { pulse: boolean } }).targetShown.pulse)).toBe(true)
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .include('.lesson')
    .analyze()
  expect(violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([])
})
