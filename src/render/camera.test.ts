import { describe, expect, it } from 'vitest'
import { frameBounds, viewDirection } from './camera'
import { shadowMapSizeFor } from './washi'

describe('frameBounds', () => {
  it('fits a 1x1 sheet at fov 35 with a 15% margin', () => {
    const { distance } = frameBounds({ width: 1, height: 1 }, 35, 1)
    const expected = (0.5 * 1.15) / Math.tan((35 * Math.PI) / 360)
    expect(distance).toBeCloseTo(expected, 6)
  })
  it('is limited by width in a narrow viewport', () => {
    const wide = frameBounds({ width: 1, height: 1 }, 35, 2).distance
    const narrow = frameBounds({ width: 1, height: 1 }, 35, 0.5).distance
    expect(narrow).toBeCloseTo(2 * wide, 6)
  })
  it('scales linearly with the sheet', () => {
    const a = frameBounds({ width: 1, height: 1 }, 35, 1).distance
    const b = frameBounds({ width: 3, height: 3 }, 35, 1).distance
    expect(b).toBeCloseTo(3 * a, 6)
  })
})

describe('viewDirection', () => {
  it('top looks straight down -z', () => {
    const d = viewDirection('top')
    expect(d[0]).toBeCloseTo(0)
    expect(d[1]).toBeCloseTo(0)
    expect(d[2]).toBeCloseTo(-1)
  })
  it('reset looks from the +z side, tilted, as a unit vector', () => {
    const d = viewDirection('reset')
    expect(d[2]).toBeLessThan(0)
    expect(d[1]).toBeGreaterThan(0)
    expect(Math.hypot(...d)).toBeCloseTo(1)
  })
})

describe('shadowMapSizeFor', () => {
  it('uses 2048 on desktop and 1024 on low-end', () => {
    expect(shadowMapSizeFor({ cores: 8 })).toBe(2048)
    expect(shadowMapSizeFor({ cores: 4 })).toBe(1024)
    expect(shadowMapSizeFor({ cores: 8, memoryGB: 2 })).toBe(1024)
    expect(shadowMapSizeFor({})).toBe(2048)
  })
})
