import { describe, expect, test } from 'vitest'
import { BUDGET_MS, QualityGovernor } from './governor'

describe('the quality governor', () => {
  test('frames over 16.7 ms lower the iterations; the mesh coarsens only once they are at their minimum', () => {
    const g = new QualityGovernor({ iterations: 8, minIterations: 2, maxLevel: 2 })
    const seen: { iterations: number; level: number; coarsen: boolean }[] = []
    for (let k = 0; k < 200; k++) {
      const r = g.update(25) // always too slow
      seen.push({ iterations: g.iterations, level: g.level, coarsen: r.coarsen })
    }
    expect(g.iterations).toBe(2)
    expect(g.level).toBe(2)
    const firstCoarsen = seen.findIndex(s => s.coarsen)
    expect(firstCoarsen).toBeGreaterThan(0)
    expect(seen.slice(0, firstCoarsen).every(s => s.level === 0)).toBe(true)
    expect(seen[firstCoarsen - 1]!.iterations).toBe(2) // iterations were already at the minimum
    expect(seen.filter(s => s.coarsen)).toHaveLength(2) // once per level, then it stays
  })

  test('within budget nothing changes; with headroom the iterations come back slowly', () => {
    const g = new QualityGovernor({ iterations: 8, minIterations: 2 })
    for (let k = 0; k < 100; k++) g.update(12)
    expect(g.iterations).toBe(8)
    for (let k = 0; k < 9; k++) g.update(30) // three steps down
    const low = g.iterations
    expect(low).toBe(5)
    for (let k = 0; k < 400; k++) g.update(5)
    expect(g.iterations).toBe(8)
    expect(g.level).toBe(0)
  })

  test('a dense crease region on a slow GPU: iterations drop before the frame rate falls below 30 (Review Focus 2)', () => {
    // frame time = fixed cost + a per-iteration cost that grows as the dense region comes into play
    const g = new QualityGovernor({ iterations: 10, minIterations: 2, maxLevel: 2 })
    let worst = 0
    for (let k = 0; k < 600; k++) {
      const dense = Math.min(1, k / 300) // ramps up over 5 s
      const perIteration = 1 + 3 * dense // ms per iteration, at level 0
      const ms = 4 + perIteration * g.iterations * (1 / (1 + g.level))
      if (g.iterations > 2) worst = Math.max(worst, ms)
      g.update(ms)
    }
    expect(worst).toBeLessThan(1000 / 30) // never below 30 fps while iterations could still be cut
    expect(BUDGET_MS).toBeCloseTo(16.7, 6)
  })
})
