// Accessibility gate (spec 04): an axe scan of the studio and of the open
// settings sheet finds no serious or critical violations (WCAG 2.x A/AA rules
// plus axe best practices). Scanned at rest: while a fold gesture is live the
// islands fade to 40% on purpose (spec 03), which is an accepted exception.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { drag, openStudio } from './helpers'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

async function scan(page: Page, include?: string) {
  let b = new AxeBuilder({ page }).withTags(TAGS)
  if (include) b = b.include(include)
  const { violations } = await b.analyze()
  const all = violations.map(v => `${v.impact} ${v.id}: ${v.help} (${v.nodes.map(n => n.target.join(' ')).join(', ')})`)
  console.log(all.length ? `[axe] ${all.join('\n[axe] ')}` : '[axe] no violations')
  return violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

test('the studio at rest: no serious or critical violations', async ({ page }) => {
  await openStudio(page)
  expect(await scan(page)).toEqual([])
})

test('first visit, coach mark showing: no serious or critical violations', async ({ page }) => {
  await openStudio(page, { coach: true })
  await expect(page.getByRole('note', { name: 'Tip' })).toBeVisible()
  expect(await scan(page)).toEqual([])
})

test('the studio with a fold, the paper panel and the export menu open', async ({ page }) => {
  await openStudio(page)
  await drag(page, [0.99, 0.99], [0, 0])
  await page.getByRole('button', { name: 'Paper', exact: true }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Export' })).toBeVisible()
  expect(await scan(page)).toEqual([])
})

test('the open settings sheet: no serious or critical violations', async ({ page }) => {
  await openStudio(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  expect(await scan(page)).toEqual([])
})

test('the shortcut sheet and the preset confirm dialog', async ({ page }) => {
  await openStudio(page)
  await page.locator('[data-stage-host] canvas').focus()
  await page.keyboard.press('Shift+Slash')
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await scan(page)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await drag(page, [0.99, 0.99], [0, 0])
  await page.getByRole('group', { name: 'Presets' }).getByRole('button', { name: 'Crane' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  expect(await scan(page)).toEqual([])
})

test('the replay bar: no serious or critical violations', async ({ page }) => {
  await openStudio(page)
  await drag(page, [0.99, 0.99], [0, 0])
  await page.getByRole('button', { name: 'Replay', exact: true }).click()
  const bar = page.getByRole('region', { name: 'Replay' })
  await expect(bar).toBeVisible()
  expect(await scan(page, '.replaybar')).toEqual([])
})

test('the Share dialog: no serious or critical violations', async ({ page }) => {
  await openStudio(page)
  await drag(page, [0.99, 0.99], [0, 0])
  await page.getByRole('button', { name: 'Share' }).click()
  await expect(page.getByRole('textbox', { name: 'Share link' })).not.toHaveValue('')
  expect(await scan(page, '.dialog.share')).toEqual([])
})

test('the Record dialog: no serious or critical violations', async ({ page }) => {
  await openStudio(page)
  await drag(page, [0.99, 0.99], [0, 0])
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('button', { name: 'Record replay…' }).click()
  await expect(page.getByRole('dialog', { name: 'Record the replay' })).toBeVisible()
  expect(await scan(page, '.dialog.record')).toEqual([])
})
