import { describe, expect, test } from 'vitest'
import type { Line, Vec2 } from '@engine'
import { AXIOM_INPUTS, axiom, clipLine } from './axioms'

const dist = (l: Line, p: Vec2) => {
  const n = Math.hypot(l.vector[0], l.vector[1])
  return Math.abs((p[0] - l.origin[0]) * l.vector[1] - (p[1] - l.origin[1]) * l.vector[0]) / n
}
/** Reflect p across l. */
const reflect = (l: Line, p: Vec2): Vec2 => {
  const n = Math.hypot(l.vector[0], l.vector[1])
  const [ux, uy] = [l.vector[0] / n, l.vector[1] / n]
  const dx = p[0] - l.origin[0]
  const dy = p[1] - l.origin[1]
  const t = dx * ux + dy * uy
  return [l.origin[0] + 2 * t * ux - dx, l.origin[1] + 2 * t * uy - dy]
}
const angleOf = (l: Line) => ((Math.atan2(l.vector[1], l.vector[0]) * 180) / Math.PI + 180) % 180

describe('Huzita–Justin axioms', () => {
  test('each axiom asks for its inputs', () => {
    expect(AXIOM_INPUTS).toEqual({
      1: { points: 2, lines: 0 },
      2: { points: 2, lines: 0 },
      3: { points: 0, lines: 2 },
      4: { points: 1, lines: 1 },
      5: { points: 2, lines: 1 },
      6: { points: 2, lines: 2 },
      7: { points: 1, lines: 2 },
    })
    expect(() => axiom(1, { points: [[0, 0]] })).toThrow(/2 points/)
  })

  test('axiom 1 through two points gives one line through both', () => {
    const ls = axiom(1, { points: [[0.1, 0.2], [0.7, 0.5]] })
    expect(ls).toHaveLength(1)
    expect(dist(ls[0]!, [0.1, 0.2])).toBeLessThan(1e-12)
    expect(dist(ls[0]!, [0.7, 0.5])).toBeLessThan(1e-12)
  })

  test('axiom 2 gives the perpendicular bisector', () => {
    const [l] = axiom(2, { points: [[0.2, 0.2], [0.6, 0.4]] })
    const r = reflect(l!, [0.2, 0.2])
    expect(r[0]).toBeCloseTo(0.6, 12)
    expect(r[1]).toBeCloseTo(0.4, 12)
    expect(dist(l!, [0.4, 0.3])).toBeLessThan(1e-12)
  })

  test('axiom 3 gives the bisectors of two crossing lines', () => {
    const ls = axiom(3, { lines: [{ origin: [0, 0], vector: [1, 0] }, { origin: [0, 0], vector: [0, 1] }] })
    expect(ls.map(angleOf).sort((a, b) => a - b).map(a => Math.round(a))).toEqual([45, 135])
  })

  test('axiom 4: perpendicular to a line through a point', () => {
    const [l] = axiom(4, { lines: [{ origin: [0, 0], vector: [1, 1] }], points: [[0.2, 0.7]] })
    expect(dist(l!, [0.2, 0.7])).toBeLessThan(1e-12)
    expect(Math.round(angleOf(l!))).toBe(135)
  })

  test('axiom 5: through p2, folding p1 onto a line', () => {
    const line: Line = { origin: [0, 0], vector: [1, 0] }
    const p1: Vec2 = [0.2, 0.6]
    const p2: Vec2 = [0.5, 0.3]
    const ls = axiom(5, { lines: [line], points: [p1, p2] })
    expect(ls.length).toBeGreaterThan(0)
    for (const l of ls) {
      expect(dist(l, p2)).toBeLessThan(1e-9)
      expect(Math.abs(reflect(l, p1)[1])).toBeLessThan(1e-9)
    }
  })

  test('axiom 6: folds p1 onto l1 and p2 onto l2 at once', () => {
    const l1: Line = { origin: [0, 0], vector: [1, 0] }
    const l2: Line = { origin: [0, 0], vector: [0, 1] }
    const p1: Vec2 = [0.3, 0.8]
    const p2: Vec2 = [0.7, 0.4]
    const ls = axiom(6, { lines: [l1, l2], points: [p1, p2] })
    expect(ls.length).toBeGreaterThan(0)
    for (const l of ls) {
      expect(dist(l1, reflect(l, p1))).toBeLessThan(1e-6)
      expect(dist(l2, reflect(l, p2))).toBeLessThan(1e-6)
    }
  })

  test('axiom 7: folds p onto l1, perpendicular to l2', () => {
    const l1: Line = { origin: [0, 0], vector: [1, 0] }
    const l2: Line = { origin: [0, 0], vector: [1, 1] }
    const p: Vec2 = [0.4, 0.6]
    const [l] = axiom(7, { lines: [l1, l2], points: [p] })
    expect(Math.abs(reflect(l!, p)[1])).toBeLessThan(1e-9)
    expect(Math.round(angleOf(l!))).toBe(135)
  })

  test('clipLine gives the chord of a line across the sheet', () => {
    const s = clipLine({ origin: [0.5, 0.5], vector: [1, 1] }, { width: 1, height: 1 })!
    expect(s.flat().map(x => Math.round(x * 1e9) / 1e9).sort()).toEqual([0, 0, 1, 1])
    expect(clipLine({ origin: [2, 2], vector: [1, 0] }, { width: 1, height: 1 })).toBeNull()
  })
})
