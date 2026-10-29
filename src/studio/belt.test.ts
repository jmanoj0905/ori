import { describe, expect, test } from 'vitest'
import { BELT_RADIUS_PX, beltRowAt, insideBelt, layerWords, rowPx, type BeltState } from './belt'

const beltOf = (n: number): BeltState => ({
  clientX: 200,
  clientY: 300,
  stack: { faces: Array.from({ length: n }, (_, i) => i), joins: [] },
  hovered: null,
  keyboard: false,
})

describe('belt geometry', () => {
  test('rowPx: 14 px rows, squeezed to fit the circle for a tall stack', () => {
    expect(rowPx(2)).toBe(14)
    expect(rowPx(30)).toBeLessThan(14)
    expect(rowPx(30) * 30).toBeCloseTo(2 * BELT_RADIUS_PX - 16)
  })

  test('beltRowAt, n = 2: one row either side of the centre', () => {
    const b = beltOf(2)
    expect(beltRowAt(b, 200, 300 - 7)).toBe(0)
    expect(beltRowAt(b, 200, 300 + 7)).toBe(1)
    // across the row, horizontally, the row holds
    expect(beltRowAt(b, 200 + 50, 300 + 7)).toBe(1)
    expect(beltRowAt(b, 200 - 50, 300 - 7)).toBe(0)
  })

  test('beltRowAt, n = 30: centre is the middle row, the stack ends map to the end rows', () => {
    const b = beltOf(30)
    const r = rowPx(30)
    const top = 300 - 15 * r
    expect(beltRowAt(b, 200, 300 + r / 2)).toBe(15)
    expect(beltRowAt(b, 200, 300 - r / 2)).toBe(14)
    expect(beltRowAt(b, 200, top + r / 2)).toBe(0)
    expect(beltRowAt(b, 200, top + 29.5 * r)).toBe(29)
    expect(beltRowAt(b, 200, 300 + 3.5 * r)).toBe(18)
  })

  test('beltRowAt: above or below the stack clamps to the end rows; outside the circle is null', () => {
    const b = beltOf(2)
    expect(beltRowAt(b, 200, 300 - 40)).toBe(0)
    expect(beltRowAt(b, 200, 300 + 40)).toBe(1)
    expect(beltRowAt(b, 200 + BELT_RADIUS_PX + 1, 300)).toBeNull()
    expect(insideBelt(b, 200 + BELT_RADIUS_PX - 1, 300)).toBe(true)
    expect(insideBelt(b, 200 + BELT_RADIUS_PX + 1, 300)).toBe(false)
  })

  test('layerWords: the announcement format', () => {
    expect(layerWords(1, 4)).toBe('Layer 1 of 4: top flap')
    expect(layerWords(3, 4)).toBe('Layer 3 of 4: top flap and 2 below')
  })
})
