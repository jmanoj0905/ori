// Shared helpers for the e2e specs. The app runs from the e2e-mode build, which
// exposes `window.__ori` (store, stage, ui, settings; see src/studio/App.tsx).
// Points are folded-space paper coordinates (the unit square is [0,1]²); the
// Stage maps them to client pixels, so the specs never hard-code pixels.
import { expect, type Locator, type Page } from '@playwright/test'

export type Vec2 = [number, number]

declare global {
  interface Window {
    // Typed loosely on purpose: the specs only read plain data through it.
    __ori?: {
      store: { getState(): any; setState(s: any): void; subscribe(f: (s: any, p: any) => void): () => void }
      stage: { clientOf(p: Vec2): Vec2; canvas: HTMLCanvasElement }
      ui: { getState(): any }
      settings: { getState(): any }
    }
  }
}

/** Open the studio on a fresh blank sheet, with fonts loaded and a frame rendered. */
export async function openStudio(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__ori && !!document.querySelector('[data-stage-host] canvas'))
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await settle(page)
}

/** Wait until no commit is in flight and no gesture or settle is live, then for two rendered frames. */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const s = window.__ori!.store.getState()
    return !s.pending && !s.settling
  })
  await frames(page, 2)
}

export async function frames(page: Page, n = 1): Promise<void> {
  await page.evaluate(
    n => new Promise<void>(r => {
      const tick = (k: number) => (k <= 0 ? r() : requestAnimationFrame(() => tick(k - 1)))
      tick(n)
    }),
    n,
  )
}

/** Client pixel position of a folded-space point on the z = 0 plane. */
export async function px(page: Page, p: Vec2): Promise<Vec2> {
  return page.evaluate(p => window.__ori!.stage.clientOf(p), p)
}

/** Press on `from`, move to `to` in `steps` moves, release (unless `release` is false). */
export async function drag(page: Page, from: Vec2, to: Vec2, opts: { steps?: number; release?: boolean } = {}): Promise<void> {
  const [ax, ay] = await px(page, from)
  const [bx, by] = await px(page, to)
  await page.mouse.move(ax, ay)
  await page.mouse.down()
  await page.mouse.move(bx, by, { steps: opts.steps ?? 12 })
  if (opts.release !== false) {
    await page.mouse.up()
    await settle(page)
  }
}

export const stepList = (page: Page): Locator => page.getByRole('list', { name: 'Fold steps' })

/** Fold steps in the list (the "0 · Blank sheet" row is not a step). */
export async function expectSteps(page: Page, n: number): Promise<void> {
  await expect(stepList(page).getByRole('listitem')).toHaveCount(n + 1)
}

export const hint = (page: Page): Locator => page.locator('p.hint')

export async function studio<T>(page: Page, f: (s: any) => T): Promise<T> {
  return page.evaluate(`(${f.toString()})(window.__ori.store.getState())`) as Promise<T>
}

/** Play a preset from the step list and wait until it has `steps` steps (and nothing is in flight). */
export async function playPreset(page: Page, name: 'Paper plane' | 'Cup' | 'Crane', steps: number): Promise<void> {
  await page.getByRole('group', { name: 'Presets' }).getByRole('button', { name }).click()
  const dialog = page.getByRole('alertdialog')
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: 'Play preset' }).click()
  await expectSteps(page, steps)
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 30_000 })
  await settle(page)
}
