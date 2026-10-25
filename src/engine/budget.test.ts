// The layer budget (final review item 1, R52): a flat fold whose result would
// stack more layers, or need more face-pair orders, than the solver can order
// in reasonable time is refused BEFORE the layer solve, with TOO_MANY_LAYERS.
//
// Measured (Node 24 / Chromium): repeated halving of a square, every layer —
// fold 7 (128 layers, 4 032 new orders) commits in 1.9 s / 0.9 s, fold 8 (256
// layers, 16 256 new orders) in 16.9 s / 8.3 s; the perf gate's 320-face
// model (128 layers, 26 464 pairs, 4 032 new) in 6.2 s in Node. The limits
// (LAYER_BUDGET) let the 7th halving and the perf model through, refuse the 8th.
import { describe, expect, test } from 'vitest'
import { commit, type Gesture } from './ops'
import { LAYER_BUDGET, TOO_MANY_LAYERS, layerBudget } from './layers'
import { accordion } from './testkit'

/** Fold every layer of accordion(n) (strips [0, 1/n] × [0, 1], stacked) in half, top edge down. */
const halveAll = (n: number): Gesture => ({
  tool: 'fold', grab: [0.5 / n, 1], target: [0.5 / n, 0], layers: 1e6, kind: 'valley', progress: 1, snapAngle: false,
})

describe('layer budget', () => {
  test('limits: 128 layers, 6 000 new face-pair orders, 30 000 in all', () => {
    expect(LAYER_BUDGET).toEqual({ maxLayers: 128, maxNewOrders: 6_000, maxOrders: 30_000 })
  })

  // accordion(n) orders only adjacent strips, so its pair counts are lifted here to test the depth alone.
  const depthOnly = { ...LAYER_BUDGET, maxNewOrders: Infinity, maxOrders: Infinity }

  test('a stack of 128 layers passes', () => {
    expect(layerBudget(accordion(128), depthOnly)).toBeNull()
  })

  test('one layer over the budget is refused', () => {
    expect(layerBudget(accordion(129), depthOnly)).toEqual({ ok: false, reason: TOO_MANY_LAYERS })
  })

  test('the real limits: a small stack passes, an unordered 128-strip stack (8 001 new orders) does not', () => {
    expect(layerBudget(accordion(40))).toBeNull()
    expect(layerBudget(accordion(128))).toEqual({ ok: false, reason: TOO_MANY_LAYERS })
  })

  test('the face-pair counts are limits of their own: all pairs, and pairs without an order yet', () => {
    // 20 stacked strips: 20 layers, 190 overlapping pairs; the 19 adjacent ones are ordered.
    const loose = { maxLayers: 1000, maxNewOrders: 1000, maxOrders: 1000 }
    expect(layerBudget(accordion(20), { ...loose, maxOrders: 190 })).toBeNull()
    expect(layerBudget(accordion(20), { ...loose, maxOrders: 189 })).toEqual({ ok: false, reason: TOO_MANY_LAYERS })
    expect(layerBudget(accordion(20), { ...loose, maxNewOrders: 171 })).toBeNull()
    expect(layerBudget(accordion(20), { ...loose, maxNewOrders: 170 })).toEqual({ ok: false, reason: TOO_MANY_LAYERS })
  })

  test('strips side by side (no overlap) count one layer and no orders', () => {
    // accordion(1) is a single flat face.
    expect(layerBudget(accordion(1), { maxLayers: 1, maxNewOrders: 0, maxOrders: 0 })).toBeNull()
  })

  test('commit refuses a fold past the budget with the exact message', () => {
    // 65 stacked strips folded in half: 130 layers > 128.
    expect(commit(accordion(65), halveAll(65))).toEqual({ ok: false, reason: 'Too many layers to fold here.' })
  })

  test('the refusal comes before the solve (cheap even on a deep stack)', () => {
    // 150 → 300 layers, 44 850 orders: a full solve here took 27 s.
    const t = performance.now()
    const r = commit(accordion(150), halveAll(150))
    expect(r).toEqual({ ok: false, reason: TOO_MANY_LAYERS })
    expect(performance.now() - t).toBeLessThan(3000)
  })
})
