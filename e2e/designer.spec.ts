// Designer mode (spec 07, Plan 5): the editor in a real browser — an axe scan,
// a waterbomb drawn with the exact numeric input and folded with Fold all into
// the 3D view (checks and the layer solve run in the designer worker), and a
// 5,100-crease .cp import with no long task over 50 ms on the main thread.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openStudio, settle } from './helpers'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

async function designer(page: Page) {
  await openStudio(page)
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Designer' }).click()
  await expect(page.getByRole('application', { name: /Crease pattern editor/ })).toBeVisible()
}

async function crease(page: Page, a: [number, number], b: [number, number]) {
  const form = page.getByRole('group', { name: 'Exact crease' })
  await form.getByLabel('From x').fill(String(a[0]))
  await form.getByLabel('From y').fill(String(a[1]))
  await form.getByLabel('To x').fill(String(b[0]))
  await form.getByLabel('To y').fill(String(b[1]))
  await form.getByRole('button', { name: 'Add crease' }).click()
}

test('designer mode: no serious or critical axe violations', async ({ page }) => {
  await designer(page)
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const bad = violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
  expect(bad).toEqual([])
})

test('draw a waterbomb base, then Fold all shows it folded in 3D', async ({ page }) => {
  await designer(page)
  const tools = page.getByRole('region', { name: 'Designer tools' })
  await tools.getByRole('button', { name: 'Valley' }).click()
  await crease(page, [0, 0], [1, 1])
  await crease(page, [1, 0], [0, 1])
  await tools.getByRole('button', { name: 'Mountain' }).click()
  await crease(page, [0, 0.5], [1, 0.5])
  await tools.getByRole('button', { name: 'Unassigned' }).click()
  await crease(page, [0.5, 0], [0.5, 1])
  await expect(page.getByRole('region', { name: 'Flat-foldability' })).toContainText('Kawasaki and Maekawa hold at every vertex.')
  await page.getByRole('button', { name: 'Fold all' }).click()
  await expect(page.getByText(/Folded flat: \d+ faces\./)).toBeVisible()
  await settle(page)
  const h = await page.evaluate(() => {
    const s = window.__ori!.store.getState()
    return { labels: s.history.steps.map((x: { label: string }) => x.label), orders: s.history.frames[s.history.cursor].faceOrders.length }
  })
  expect(h.labels).toEqual(['Fold all'])
  expect(h.orders).toBeGreaterThan(0)
  await expect(page.getByRole('list', { name: 'Fold steps' })).toContainText('Fold all')
})

test('importing a 5,100-crease .cp keeps the main thread free of long tasks (≤ 50 ms)', async ({ page }) => {
  await designer(page)
  const n = 51
  const at = (i: number) => -200 + (400 * i) / n
  const lines = ['1 -200 -200 200 -200', '1 200 -200 200 200', '1 200 200 -200 200', '1 -200 200 -200 -200']
  for (let i = 1; i < n; i++)
    for (let j = 0; j < n; j++) {
      lines.push(`2 ${at(i)} ${at(j)} ${at(i)} ${at(j + 1)}`)
      lines.push(`${j % 2 === 0 ? 2 : 3} ${at(j)} ${at(i)} ${at(j + 1)} ${at(i)}`)
    }
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] }
    w.__long = []
    new PerformanceObserver(list => list.getEntries().forEach(e => w.__long.push(e.duration))).observe({ type: 'longtask' })
  })
  await page.getByLabel('Import a crease pattern').setInputFiles({ name: 'grid.cp', mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n')) })
  await expect(page.getByText('Imported 5100 creases from grid.cp.')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('region', { name: 'Flat-foldability' })).toContainText('Kawasaki and Maekawa hold at every vertex.', { timeout: 20_000 })
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long)
  console.log(`[designer] long tasks during the import: ${long.length ? long.map(d => d.toFixed(0)).join(', ') + ' ms' : 'none'}`)
  expect(Math.max(0, ...long)).toBeLessThanOrEqual(50)
})
