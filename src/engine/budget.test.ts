// The layer budget (final review item 1, R52): a flat fold whose result would
// stack more layers, or need more face-pair orders, than the solver can order
// in reasonable time is refused BEFORE the layer solve, with TOO_MANY_LAYERS.
//
// Measured (repeated halving of a square, every layer, Node 24 / Chromium):
// fold 7 → 128 faces, 128 layers, 8 128 orders: commit 1.9 s / 0.9 s;
// fold 8 → 256 faces, 256 layers, 32 640 orders: 16.9 s / 8.3 s. The limits
// (LAYER_BUDGET) let the 7th halving through and refuse the 8th.
import { describe, expect, test } from 'vitest'
import { commit, type Gesture } from './ops'
import { LAYER_BUDGET, TOO_MANY_LAYERS, layerBudget } from './layers'
import { accordion } from './testkit'

/** Fold every layer of accordion(n) (strips [0, 1/n] × [0, 1], stacked) in half, top edge down. */
const halveAll = (n: number): Gesture => ({
  tool: 'fold', grab: [0.5 / n, 1], target: [0.5 / n, 0], layers: 1e6, kind: 'valley', progress: 1, snapAngle: false,
})

describe('layer budget', () => {
  test('limits: 128 layers, 10 000 face-pair orders', () => {
    expect(LAYER_BUDGET).toEqual({ maxLayers: 128, maxOrders: 10_000 })
  })

  test('a stack within the budget passes', () => {
    expect(layerBudget(accordion(128))).toBeNull()
  })

  test('one layer over the budget is refused', () => {
    expect(layerBudget(accordion(129))).toEqual({ ok: false, reason: TOO_MANY_LAYERS })
  })

  test('the face-pair order count is its own limit', () => {
    // 20 stacked strips: 20 layers, 190 overlapping pairs.
    expect(layerBudget(accordion(20), { maxLayers: 1000, maxOrders: 190 })).toBeNull()
    expect(layerBudget(accordion(20), { maxLayers: 1000, maxOrders: 189 })).toEqual({ ok: false, reason: TOO_MANY_LAYERS })
  })

  test('strips side by side (no overlap) count one layer and no orders', () => {
    // accordion(1) is a single flat face.
    expect(layerBudget(accordion(1), { maxLayers: 1, maxOrders: 0 })).toBeNull()
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
