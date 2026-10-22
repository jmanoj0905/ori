// Recording, end to end (spec 05 "Replay and recording"; Plan 3 Task 5): fold
// twice, record the replay as a GIF from the Export menu and check the
// download (name, GIF89a header, size, frames, the user's paper on the washi
// desk); the Stage comes back exactly as it was. Cancel downloads nothing.
// WebM is recorded too where Chromium's MediaRecorder supports it.
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { drag, expectSteps, openStudio, settle, studio } from './helpers'

async function foldTwice(page: Page) {
  await drag(page, [0.99, 0.99], [0, 0])
  await drag(page, [0.01, 0.99], [0.5, 0.5])
  await expectSteps(page, 2)
}

/** What the Stage shows and how: frame index, preview, camera, canvas buffer and view offset. */
const stageState = (page: Page) =>
  page.evaluate(() => {
    const o = window.__ori! as any
    const h = o.store.getState().history
    const c = o.stage.renderer.domElement as HTMLCanvasElement
    return {
      index: h.frames.indexOf(o.stage.frame),
      preview: o.stage.preview !== null,
      cam: JSON.stringify(o.stage.cam),
      buffer: [c.width, c.height],
      offset: JSON.stringify(o.stage.camera.view),
      aspect: o.stage.camera.aspect,
    }
  })

async function openRecorder(page: Page) {
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('button', { name: 'Record replay…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Record the replay' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('record a 2-step GIF: downloaded, GIF89a, in the user’s paper; the Stage is restored', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await openStudio(page)
  await page.evaluate(() => (window.__ori! as any).store.getState().setPaper({ front: '#2F4A8A' })) // indigo
  await foldTwice(page)
  const before = await stageState(page)

  const dialog = await openRecorder(page)
  await expect(dialog.getByRole('radio', { name: /GIF/ })).toBeChecked()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Record' }).click()
  await expect(dialog.getByRole('progressbar', { name: 'Recording progress' })).toBeVisible()
  expect(await studio(page, s => s.replaying)).toBe(true) // replay mode for the duration
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^ori-\d{4}-\d\d-\d\d-2\.gif$/)
  const bytes = readFileSync((await file.path())!)
  expect(bytes.byteLength).toBeGreaterThan(0)
  expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a')
  // 1280 × 800 viewport → 480p at the canvas aspect.
  expect(bytes.readUInt16LE(6)).toBe(768)
  expect(bytes.readUInt16LE(8)).toBe(480)

  // Decode it in the page: 1.6 s at 15 fps → 25 frames; frame 0 is the flat indigo sheet on the washi desk.
  const probe = await page.evaluate(async (b64: string) => {
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const dec = new ImageDecoder({ data, type: 'image/gif' })
    await dec.tracks.ready
    await dec.completed
    const { image } = await dec.decode({ frameIndex: 0 })
    const c = new OffscreenCanvas(image.displayWidth, image.displayHeight)
    const ctx = c.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]
    const centre = at(384, 240)
    const corner = at(6, 6)
    // The middle frame (step 1 swinging), as a PNG attachment: it only has to render.
    const mid = (await dec.decode({ frameIndex: 9 })).image
    ctx.drawImage(mid, 0, 0)
    const png = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    return { frames: dec.tracks.selectedTrack!.frameCount, centre, corner, mid: btoa(String.fromCharCode(...png)) }
  }, bytes.toString('base64'))
  expect(probe.frames).toBe(25)
  const midPng = Buffer.from(probe.mid, 'base64')
  writeFileSync(info.outputPath('record-mid.png'), midPng)
  await info.attach('record-mid', { body: midPng, contentType: 'image/png' })
  const [r, g, b] = probe.centre
  expect(b!).toBeGreaterThan(r! + 25) // the user's indigo, not the default vermilion
  expect(b!).toBeGreaterThan(g!)
  expect(Math.min(...probe.corner)).toBeGreaterThan(150) // the ivory washi desk, not black or transparent

  // The dialog closes; replay mode is left; the Stage is back exactly.
  await expect(dialog).toHaveCount(0)
  expect(await studio(page, s => s.replaying)).toBe(false)
  await settle(page)
  expect(await stageState(page)).toEqual(before)
  await expect(page.locator('.dock')).not.toHaveAttribute('inert', '')
  expect(errors).toEqual([])
})

test('Cancel stops the recording: no download, replay mode left, the Stage restored', async ({ page }) => {
  await openStudio(page)
  await foldTwice(page)
  const before = await stageState(page)
  let downloads = 0
  page.on('download', () => downloads++)

  const dialog = await openRecorder(page)
  await dialog.getByRole('radio', { name: '1080p' }).check()
  await dialog.getByRole('radio', { name: '30 fps' }).check()
  await dialog.getByRole('button', { name: 'Record' }).click()
  const bar = dialog.getByRole('progressbar', { name: 'Recording progress' })
  await expect(bar).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await page.waitForTimeout(1500)
  expect(downloads).toBe(0)
  expect(await studio(page, s => s.replaying)).toBe(false)
  await settle(page)
  expect(await stageState(page)).toEqual(before)
})

test('record a WebM where MediaRecorder supports it', async ({ page }) => {
  await openStudio(page)
  const supported = await page.evaluate(() => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm'))
  test.skip(!supported, 'this Chromium has no MediaRecorder WebM')
  await foldTwice(page)
  const before = await stageState(page)
  const dialog = await openRecorder(page)
  await dialog.getByRole('radio', { name: /WebM/ }).check()
  const download = page.waitForEvent('download', { timeout: 30_000 })
  await dialog.getByRole('button', { name: 'Record' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^ori-\d{4}-\d\d-\d\d-2\.webm$/)
  const bytes = readFileSync((await file.path())!)
  expect(bytes.byteLength).toBeGreaterThan(1000)
  expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]) // EBML (Matroska / WebM)
  await expect(dialog).toHaveCount(0)
  await settle(page)
  expect(await stageState(page)).toEqual(before)
})
