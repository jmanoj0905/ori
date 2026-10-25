import { describe, expect, test } from 'vitest'
import { progressToAngle } from '@engine'
import type { HingeCandidate, Vec2 } from '@engine'
import { readDrag, settleOpen } from './dragReading'
import type { Reading } from './dragReading'

// side > 0 is left of line.vector, so the grab sits left of both fixtures.
const hinge = (origin: Vec2, vector: Vec2): HingeCandidate => ({
  line: { origin, vector },
  segments: [],
  faces: [],
  k: 1,
  openKind: 'valley',
  rangeDeg: 180,
} as unknown as HingeCandidate)

const H = hinge([0.5, 0], [0, 1]) // x = 0.5, n = [1, 0] from grab [0.1, 0.5]
const V = hinge([0, 0.9], [-1, 0]) // y = 0.9, n = [0, 1]
const grab: Vec2 = [0.1, 0.5]
const NEW: Reading = { mode: 'new' }
const read = (cursor: Vec2, o: Partial<Parameters<typeof readDrag>[0]> = {}) =>
  readDrag({ grab, cursor, hinges: [H], prev: NEW, forceNew: false, minDrag: 0.02, ...o })
const offBy = (deg: number): Vec2 => {
  const a = (deg * Math.PI) / 180
  return [grab[0] + 0.3 * Math.cos(a), grab[1] + 0.3 * Math.sin(a)]
}

describe('readDrag', () => {
  test('straight toward the hinge swings', () => {
    expect(read([0.4, 0.5])).toEqual({ mode: 'swing', hinge: 0 })
  })
  test('45 degree corner fold stays a new fold', () => {
    expect(read([0.3, 0.3])).toEqual(NEW)
  })
  test('away from the hinge is new', () => {
    expect(read([0.0, 0.5])).toEqual(NEW)
  })
  test('hysteresis', () => {
    const prev: Reading = { mode: 'swing', hinge: 0 }
    expect(read(offBy(40), { prev })).toEqual(prev)
    expect(read(offBy(50), { prev })).toEqual(NEW)
    expect(read(offBy(40))).toEqual(NEW) // entering needs the tighter cone
  })
  test('force new', () => {
    expect(read([0.4, 0.5], { forceNew: true, prev: { mode: 'swing', hinge: 0 } })).toEqual(NEW)
  })
  test('below minDrag keeps prev', () => {
    const prev: Reading = { mode: 'swing', hinge: 0 }
    expect(read([0.11, 0.5], { prev })).toEqual(prev)
    expect(read([0.11, 0.5])).toEqual(NEW)
  })
  test('two hinges, direction picks', () => {
    const hinges = [H, V]
    expect(read([0.1, 0.8], { hinges })).toEqual({ mode: 'swing', hinge: 1 })
    expect(read([0.4, 0.5], { hinges })).toEqual({ mode: 'swing', hinge: 0 })
  })
  test('a swing switches only past the margin', () => {
    const prev: Reading = { mode: 'swing', hinge: 0 }
    expect(read(offBy(40), { prev, hinges: [H, V] })).toEqual(prev) // V scores sin 40, under the margin
    expect(read(offBy(70), { prev, hinges: [H, V] })).toEqual({ mode: 'swing', hinge: 1 })
  })
})

describe('settleOpen', () => {
  const at = (deg: number) => 1 - Math.sqrt(1 - deg / 180)
  test('settles within 10 degrees of the range', () => {
    const p = at(172)
    expect(progressToAngle(p)).toBeCloseTo(172)
    expect(settleOpen(p, 180)).toBe(1)
  })
  test('leaves progress alone otherwise', () => {
    const p = at(160)
    expect(settleOpen(p, 180)).toBe(p)
  })
})
