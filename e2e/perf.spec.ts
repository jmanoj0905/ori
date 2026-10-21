// Performance gate (spec 01/02 quality bar, Ruling R30): 60 fps while dragging
// a fold on a 300-face model, i.e. the 95th percentile of frame times during a
// 2-second drag is at most one 60 Hz frame (16.7 ms).
//
// The model: the crane preset has only 64 faces, so (R30) the spec builds a
// deterministic 320-face model through the public engine API, committed step
// by step in the engine Worker exactly as a preset plays (store.commitStep):
//   1-6. Fold the sheet in half six times, all layers, alternating vertical and
//        horizontal creases: a 1/8 × 1/8 square, 64 faces, 64 layers.
//   7-10. Fold each of its four corners in by 30%, all layers: +64 faces each.
// It takes ~8 s to build (the layer solve of a 64-layer stack), then the view
// is reset and zoomed in with the real mouse wheel so the model fills the
// screen. A real (trusted) mouse press grabs the top flap near an edge, then
// one pointermove per frame sweeps the target along a path for 2 s (a new
// crease on every move: the worst case for the preview and the renderer). Frame times are the deltas between
// requestAnimationFrame timestamps recorded in the page during the drag (see
// the jitter note at the assertion).
//
// Ruling R48: the frame-time gates alone barely discriminate (frame times are
// quantised to vsyncs), so the per-move work is gated too: the p95 of the time
// spent handling one pointermove (engine preview + Stage rebuild, synchronous in
// the handler) must be ≤ 12 ms, leaving the rest of the 16.7 ms frame for the
// WebGL render and the browser. It is measured on a sustained drag, after a short
// warm-up drag (cancelled) has paid the one-off JIT and per-model cache costs;
// the warm-up's own numbers are logged.
import { expect, test } from '@playwright/test'
import { frames, openStudio, px, settle, type Vec2 } from './helpers'

const W = 1 / 8 // the stack's side after six halvings
const BUDGET_MS = 16.7
const VSYNC_JITTER_MS = 0.5
const HANDLER_P95_MS = 12

type G = { tool: 'fold'; grab: Vec2; target: Vec2; layers: number; kind: 'valley'; progress: 1; snapAngle: false }
const fold = (grab: Vec2, target: Vec2, layers: number): G => ({ tool: 'fold', grab, target, layers, kind: 'valley', progress: 1, snapAngle: false })

function model(): G[] {
  const steps: G[] = []
  let w = 1
  let h = 1
  for (let i = 0; i < 6; i++) {
    const all = 2 ** i
    if (i % 2 === 0) {
      steps.push(fold([w * 0.95, h * 0.5], [w * 0.05, h * 0.5], all))
      w /= 2
    } else {
      steps.push(fold([w * 0.5, h * 0.95], [w * 0.5, h * 0.05], all))
      h /= 2
    }
  }
  const corners: [Vec2, Vec2][] = [
    [[W, W], [W * 0.7, W * 0.7]],
    [[0, 0], [W * 0.3, W * 0.3]],
    [[W, 0], [W * 0.7, W * 0.3]],
    [[0, W], [W * 0.3, W * 0.7]],
  ]
  for (const [a, b] of corners) steps.push(fold([a[0] + (b[0] - a[0]) * 0.05, a[1] + (b[1] - a[1]) * 0.05], b, 999))
  return steps
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!
}

test('dragging a fold on a 320-face model holds 60 fps (p95 frame time ≤ 16.7 ms)', async ({ page }, info) => {
  test.setTimeout(180_000)
  await openStudio(page)

  const built = await page.evaluate(async steps => {
    const store = window.__ori!.store
    const t0 = performance.now()
    for (const s of steps) {
      const r = await store.getState().commitStep(s)
      if (!r.ok) return { error: r.reason as string | null }
    }
    return { faces: store.getState().history.frames.at(-1).faces_vertices.length as number, ms: performance.now() - t0 }
  }, model())
  expect(built).not.toHaveProperty('error')
  const faces = (built as { faces: number }).faces
  expect(faces).toBeGreaterThanOrEqual(300)
  await settle(page)

  // Frame the model, then zoom in with the wheel until it fills most of the view.
  await page.evaluate(() => (window.__ori!.stage as any).view('reset', false))
  await frames(page, 2)
  const [cx, cy] = await px(page, [W / 2, W / 2])
  await page.mouse.move(cx, cy)
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -100)
  await frames(page, 4)
  await info.attach('model', { body: await page.screenshot(), contentType: 'image/png' })

  // The drag: grab the top flap near the middle of the top edge, sweep the target down and side to side.
  const grab: Vec2 = [W * 0.5, W * 0.96]
  const path = (t: number): Vec2 => [W * (0.5 + 0.25 * Math.sin(t * Math.PI * 2)), W * (0.85 - 0.75 * t)]
  const points: Vec2[] = []
  for (let i = 0; i <= 240; i++) points.push(await px(page, path(i / 240)))
  const [gx, gy] = await px(page, grab)

  // A real (trusted) press on the flap, then one pointermove per frame: what Chrome
  // delivers for a mouse that keeps moving (input is rAF-aligned and coalesced).
  // Each move is dispatched at the start of a frame, so the frame's time includes the
  // full input handling (engine preview + mesh rebuild) and the WebGL render.
  type Sample = { ts: number[]; handle: number[]; build: number[]; previewing: boolean; refusal: string | null }
  const dragFor = async (ms: number, pts: Vec2[]): Promise<Sample> => {
    await page.evaluate(() => {
      const w = window as unknown as { __pid: number }
      window.addEventListener('pointerdown', e => (w.__pid = e.pointerId), { once: true, capture: true })
    })
    await page.mouse.move(gx, gy)
    await page.mouse.down()
    return page.evaluate(([ms, points]) => new Promise<Sample>(resolve => {
      const w = window as unknown as { __pid: number; __ori: any }
      const canvas = w.__ori.stage.canvas as HTMLCanvasElement
      const ts: number[] = []
      const handle: number[] = []
      const build: number[] = []
      let t0 = -1
      const tick = (t: number) => {
        if (t0 < 0) t0 = t
        ts.push(t)
        const f = (t - t0) / ms
        if (f >= 1) {
          const s = w.__ori.store.getState()
          resolve({ ts, handle, build, previewing: s.preview !== null, refusal: s.refusal })
          return
        }
        const [x, y] = points[Math.min(points.length - 1, Math.floor(f * points.length))]!
        const h0 = performance.now()
        canvas.dispatchEvent(new PointerEvent('pointermove', {
          pointerId: w.__pid, pointerType: 'mouse', isPrimary: true, buttons: 1, clientX: x + (ts.length % 2) * 0.5, clientY: y, bubbles: true,
        }))
        handle.push(performance.now() - h0)
        build.push(w.__ori.stage.lastPreviewMs)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }), [ms, pts] as const)
  }

  // Warm-up: a first, short drag along the path backwards, cancelled with Esc. The
  // first moves of a page's first drag pay one-off costs (JIT compilation of the
  // preview and mesh code, per-model caches); the gate measures sustained dragging.
  // The warm-up's own numbers are logged, not asserted.
  const cold = await dragFor(500, [...points].reverse())
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await settle(page)
  expect(await page.evaluate(() => window.__ori!.store.getState().history.steps.length)).toBe(10)

  const sample = await dragFor(2000, points)
  await page.mouse.up()
  await settle(page)
  const moves = sample.handle.length

  const dts = sample.ts.slice(1).map((t, i) => t - sample.ts[i]!)
  const p50 = pct(dts, 50)
  const p95 = pct(dts, 95)
  const worst = Math.max(...dts)
  const summary =
    `${faces} faces, built in ${((built as { ms: number }).ms / 1000).toFixed(1)} s; ` +
    `${moves} pointer moves, ${dts.length} frames in the 2 s drag: p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${worst.toFixed(2)} ms, ` +
    `frames over 16.7 ms: ${dts.filter(d => d > 16.7).length}, over 20 ms: ${dts.filter(d => d > 20).length}; ` +
    `input handling per move p50 ${pct(sample.handle, 50).toFixed(2)} / p95 ${pct(sample.handle, 95).toFixed(2)} ms ` +
    `(of which Stage preview rebuild p50 ${pct(sample.build, 50).toFixed(2)} / p95 ${pct(sample.build, 95).toFixed(2)} ms); ` +
    `cold warm-up drag (${cold.handle.length} moves): handling p50 ${pct(cold.handle, 50).toFixed(2)} / p95 ${pct(cold.handle, 95).toFixed(2)} / max ${Math.max(...cold.handle).toFixed(2)} ms`
  console.log(`[perf] ${summary}`)
  await info.attach('perf', { body: summary, contentType: 'text/plain' })

  // The drag really previewed a fold on the big model the whole time.
  expect(sample.refusal).toBeNull()
  expect(sample.previewing).toBe(true)
  expect(dts.length).toBeGreaterThan(90)
  // The budget is one 60 Hz frame. rAF timestamps are vsync-aligned but jitter by
  // ±0.1 ms around 16.67 (16.6 / 16.7 / 16.8 at idle), so the comparison allows
  // VSYNC_JITTER on top; it cannot hide a dropped frame, which is ≥ 33 ms.
  expect(p95).toBeLessThanOrEqual(BUDGET_MS + VSYNC_JITTER_MS)
  // The same gate counted directly: at most 5% of frames miss a vsync.
  expect(dts.filter(d => d > 1.5 * BUDGET_MS).length / dts.length).toBeLessThanOrEqual(0.05)
  // Ruling R48, the discriminating one: the per-move work itself (engine preview +
  // Stage rebuild, synchronous in the pointer handler) leaves headroom in the frame
  // for the WebGL render and the browser.
  expect(pct(sample.handle, 95)).toBeLessThanOrEqual(HANDLER_P95_MS)
})
