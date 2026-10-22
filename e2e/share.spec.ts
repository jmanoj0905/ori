// Share links, end to end (spec 05, Plan 3 task 2): fold twice, read the link
// from the Share dialog, open it in a fresh context, and the replace confirm.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { drag, expectSteps, openStudio, settle, studio } from './helpers'

async function foldTwice(page: Page) {
  await drag(page, [0.99, 0.99], [0, 0])
  await drag(page, [0.01, 0.99], [0.5, 0.5])
  await expectSteps(page, 2)
}

async function shareUrl(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'Share link' })
  await expect(field).toHaveValue(/#v1:/)
  const url = await field.inputValue()
  await page.getByRole('dialog', { name: 'Share this model' }).getByRole('button', { name: 'Close' }).click()
  return url
}

const frameOf = (page: Page) => studio(page, s => {
  const h = s.history
  return JSON.stringify({ n: h.steps.length, c: h.cursor, f: h.frames[h.cursor].faces_vertices, a: h.frames[h.cursor].edges_assignment })
})

async function freshPage(browser: Browser, url: string, seed?: () => void) {
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:4317' })
  const page = await ctx.newPage()
  await page.addInitScript(() => localStorage.getItem('ori.coach.v1') ?? localStorage.setItem('ori.coach.v1', '1'))
  if (seed) await page.addInitScript(seed)
  await page.goto(url)
  await page.waitForFunction(() => !!window.__ori && !!document.querySelector('[data-stage-host] canvas'))
  return { ctx, page }
}

test('the link opens the same steps in a fresh browser, and the hash is cleared', async ({ page, browser }) => {
  await openStudio(page)
  await foldTwice(page)
  const url = await shareUrl(page)
  const mine = await frameOf(page)
  const { ctx, page: other } = await freshPage(browser, url)
  await settle(other)
  await expectSteps(other, 2)
  expect(await frameOf(other)).toBe(mine)
  expect(new URL(other.url()).hash).toBe('')
  await ctx.close()
})

test('with work already saved, the link asks first: Cancel keeps it, Replace opens the shared model', async ({ page, browser }) => {
  await openStudio(page)
  await foldTwice(page)
  const url = await shareUrl(page)

  // A browser with one saved fold (its own autosave).
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:4317' })
  const mine = await ctx.newPage()
  await mine.addInitScript(() => localStorage.setItem('ori.coach.v1', '1'))
  await mine.goto('/')
  await mine.waitForFunction(() => !!window.__ori && !!document.querySelector('[data-stage-host] canvas'))
  await settle(mine)
  await drag(mine, [0.99, 0.99], [0, 0])
  await expectSteps(mine, 1)
  await mine.waitForTimeout(800) // autosave debounce
  await mine.goto('about:blank') // a hash-only change would not reload the page
  await mine.goto(url)
  const dialog = mine.getByRole('alertdialog', { name: 'Replace your current model?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await settle(mine)
  await expectSteps(mine, 1)
  expect(new URL(mine.url()).hash).toBe('')

  await mine.goto('about:blank')
  await mine.goto(url)
  await mine.getByRole('alertdialog').getByRole('button', { name: 'Replace' }).click()
  await settle(mine)
  await expectSteps(mine, 2)
  await ctx.close()
})

test('pasting the link into an already-open tab asks, then opens it', async ({ page, browser }) => {
  await openStudio(page)
  await foldTwice(page)
  const url = await shareUrl(page)
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:4317' })
  const open = await ctx.newPage()
  await open.addInitScript(() => localStorage.setItem('ori.coach.v1', '1'))
  await open.goto('/')
  await open.waitForFunction(() => !!window.__ori && !!document.querySelector('[data-stage-host] canvas'))
  await settle(open)
  await drag(open, [0.99, 0.99], [0, 0])
  await expectSteps(open, 1)
  await open.evaluate(u => { location.href = u }, url) // hash-only navigation: no reload
  const dialog = open.getByRole('alertdialog', { name: 'Replace your current model?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Replace' }).click()
  await settle(open)
  await expectSteps(open, 2)
  expect(new URL(open.url()).hash).toBe('')
  await ctx.close()
})

test('Export menu: .fold and crease-pattern SVG download with dated names and content', async ({ page }) => {
  await openStudio(page)
  await foldTwice(page)
  const stamp = /^ori-\d{4}-\d{2}-\d{2}-2\.(fold|svg)$/
  const menu = async () => {
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    return page.getByRole('group', { name: 'Export' })
  }
  const fold = page.waitForEvent('download')
  await (await menu()).getByRole('button', { name: '.fold file' }).click()
  const f = await fold
  expect(f.suggestedFilename()).toMatch(stamp)
  const { readFile } = await import('node:fs/promises')
  const foldJson = JSON.parse(await readFile((await f.path())!, 'utf8'))
  expect(foldJson.file_spec).toBe(1.2)
  expect(foldJson.file_frames).toHaveLength(3)

  const group = await menu()
  await group.getByRole('checkbox', { name: 'Grid' }).check()
  const svg = page.waitForEvent('download')
  await group.getByRole('button', { name: 'Crease pattern (SVG)' }).click()
  const s = await svg
  expect(s.suggestedFilename()).toMatch(stamp)
  const text = await readFile((await s.path())!, 'utf8')
  expect(text).toContain('<svg')
  expect(text).toContain('stroke-dasharray="6 4"')
  expect(text).toContain('cp-grid')
})
