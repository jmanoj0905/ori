// Drag-preview performance (Plan 2 Task 0): the studio previews a fold on
// every pointer move, and must hold 60 fps on a 300-face model.
//
// Timing on shared CI is noisy, so the default bounds are generous (they
// catch an order-of-magnitude regression); ORI_PERF=1 enforces the real
// budget, as in collision.test.ts. Timings are logged for the report.
//
// Fixtures:
//   - grid(c, r): a flat sheet pre-creased (flat 'F' creases) into c × r
//     cells — 64, 128 and 289 faces. The drag folds the right part of the
//     sheet over: the crease sweeps across ~half the grid, cutting a row of
//     cells, and the flood fill carries every cell on the grab side.
//   - accordion(n): n strips fully stacked (a realistic folded model: every
//     face lies under the grab point) — 64, 128 and 300 faces. The drag
//     folds all n layers across the strip, so every face is cut.
import { describe, expect, test } from 'vitest'
import { preview, type Gesture } from './ops'
import { layerAt } from './layers'
import { windings } from './rabbit'
import { accordion, grid } from './testkit'
import type { FaceOrder, Frame, Vec2 } from './types'

const strict = typeof process !== 'undefined' && process.env.ORI_PERF === '1'
const MOVES = 32

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** A simulated drag: the target (and progress) change on every move. */
function drag(frame: Frame, gesture: (i: number) => Gesture): { cold: number; warm: number } {
  const times: number[] = []
  for (let i = 0; i < MOVES; i++) {
    const t = performance.now()
    const r = preview(frame, gesture(i))
    times.push(performance.now() - t)
    if (!r.ok) throw new Error(`move ${i} refused: ${r.reason}`)
  }
  return { cold: times[0], warm: median(times.slice(1)) }
}

const fold = (grab: Vec2, target: Vec2, layers: number, progress: number): Gesture => ({
  tool: 'fold',
  grab,
  target,
  layers,
  kind: 'valley',
  progress,
  snapAngle: false,
})

/** Folding the right side of a grid over toward the left, the target moving every call. */
const gridDrag = (i: number) => fold([0.95, 0.55], [0.8 - i * 0.012, 0.5 + i * 0.002], 1, 0.1 + (0.8 * i) / MOVES)

/** Folding the top of an accordion stack down over itself, all layers. */
const stackDrag = (n: number) => (i: number) =>
  fold([0.5 / n, 0.95], [0.5 / n + 1e-4 * i, 0.8 - i * 0.012], n, 0.1 + (0.8 * i) / MOVES)

/** An n-layer stack with every pairwise order given (as a full layer solve reports it). */
function fullStack(n: number): Frame {
  const f = accordion(n)
  const w = windings(f)
  // face j lies above face i for j > i: [j, i, s] with s · (w[i] ? 1 : −1) > 0
  const faceOrders: FaceOrder[] = []
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) faceOrders.push([j, i, w[i] ? 1 : -1])
  return { ...f, faceOrders }
}

const log = (what: string, r: Record<string, number>) =>
  console.log(`[perf] ${what}: ${Object.entries(r).map(([k, v]) => `${k} ${v.toFixed(2)} ms`).join(', ')}`)

describe('drag preview performance', () => {
  test.each([
    ['grid 8×8 (64 faces)', 8, 8],
    ['grid 16×8 (128 faces)', 16, 8],
    ['grid 17×17 (289 faces)', 17, 17],
  ])('%s: a preview per pointer move fits a frame', (name, c, r) => {
    const t = drag(grid(c, r), gridDrag)
    log(name, t)
    expect(t.warm).toBeLessThan(strict ? 8 : 60)
  }, 60_000)

  test.each([
    ['accordion stack of 64', 64],
    ['accordion stack of 128', 128],
    ['accordion stack of 300', 300],
  ])('%s: a preview per pointer move fits a frame', (name, n) => {
    const t = drag(accordion(n), stackDrag(n))
    log(name, t)
    expect(t.warm).toBeLessThan(strict ? 8 : 60)
  }, 120_000)
})

describe('layerAt performance', () => {
  test('a 300-layer stack with a full pairwise order', () => {
    const f = fullStack(300)
    const p: Vec2 = [0.5 / 300, 0.5]
    let t = performance.now()
    const stack = layerAt(f, p)
    const cold = performance.now() - t
    const times: number[] = []
    for (let i = 0; i < 9; i++) {
      t = performance.now()
      layerAt(f, [p[0], 0.1 + i * 0.1])
      times.push(performance.now() - t)
    }
    const warm = median(times)
    log('layerAt, 300-layer stack', { cold, warm })
    expect(stack).toEqual(Array.from({ length: 300 }, (_, k) => 299 - k))
    expect(warm).toBeLessThan(strict ? 2 : 20)
    expect(cold).toBeLessThan(strict ? 20 : 200)
  })
})
