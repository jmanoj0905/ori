import { describe, expect, test } from 'vitest'
import { clipLineToPolygon, angleDeg, reflect } from './geometry'
import { creaseFromDrag, progressToAngle, snapAngle } from './gesture'
import { unitSquare } from './testkit'
import type { Vec2 } from './types'

describe('gesture', () => {
  test('bisector carries grab onto target', () => {
    const l = creaseFromDrag([1, 1], [0, 0])!
    expect(reflect([1, 1], l)).toEqual([expect.closeTo(0), expect.closeTo(0)])
  })
  test('zero-length drag gives null', () => expect(creaseFromDrag([0.2, 0.2], [0.2, 0.20001])).toBeNull())
  test('snapAngle locks to 22.5° steps', () => {
    const l = snapAngle({ origin: [0, 0], vector: [Math.cos(0.42), Math.sin(0.42)] }, [0, 0])
    expect(angleDeg(l.vector)).toBeCloseTo(22.5)
  })
  test('snapAngle keeps the pivot on the line', () => {
    const pivot: Vec2 = [0.3, 0.7]
    const l = snapAngle({ origin: [0.9, 0.1], vector: [1, 0.3] }, pivot)
    const cross = (pivot[0] - l.origin[0]) * l.vector[1] - (pivot[1] - l.origin[1]) * l.vector[0]
    expect(cross).toBeCloseTo(0)
    expect((angleDeg(l.vector) % 22.5 + 22.5) % 22.5).toBeCloseTo(0)
  })
  test('progressToAngle is clamped and flat at 1', () => {
    expect(progressToAngle(-1)).toBe(0); expect(progressToAngle(1)).toBe(180); expect(progressToAngle(2)).toBe(180)
  })
  test('progressToAngle eases out', () => expect(progressToAngle(0.5)).toBeCloseTo(135))
  test('clipLineToPolygon misses → null', () =>
    expect(clipLineToPolygon({ origin: [5, 0], vector: [0, 1] }, unitSquare)).toBeNull())
  test('clipLineToPolygon diagonal through the unit square', () => {
    const r = clipLineToPolygon({ origin: [0.5, 0.5], vector: [1, 1] }, unitSquare)!
    const [a, b] = [...r].sort((p, q) => p[0] - q[0])
    expect(a[0]).toBeCloseTo(0); expect(a[1]).toBeCloseTo(0)
    expect(b[0]).toBeCloseTo(1); expect(b[1]).toBeCloseTo(1)
  })
  test('clipLineToPolygon touching only a corner → null', () =>
    expect(clipLineToPolygon({ origin: [1, 1], vector: [1, -1] }, unitSquare)).toBeNull())
})
