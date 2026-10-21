// Numeric input and the hit face (final review 4b, 4c): Gesture.crease,
// Gesture.angleDeg and Gesture.face.
import { describe, expect, test } from 'vitest'
import { commit, preview, type Gesture } from './ops'
import { layerAt, selectFlap } from './layers'
import { foldedCoords, makeSheet } from './rabbit'
import { doubleTriangle, halfFolded, preliminary } from './testkit'
import type { Frame, Line, Vec2 } from './types'

const sheet = () => makeSheet({ width: 1, height: 1 })
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps
const near = (p: readonly number[], q: readonly number[], eps = 1e-9) => p.every((x, i) => close(x, q[i], eps))
const vertical = (x: number): Line => ({ origin: [x, 0], vector: [0, 1] })

const fold = (over: Partial<Gesture> & Pick<Gesture, 'grab' | 'target'>): Gesture => ({
  tool: 'fold',
  layers: 1,
  kind: 'valley',
  progress: 1,
  snapAngle: false,
  ...over,
})

function ok<T>(r: ({ ok: true } & T) | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r
}

const TOO_SHORT = { ok: false, reason: 'Drag further to fold.' }
const RANGE = { ok: false, reason: 'The fold angle must be between 0° and 180°.' }

const vertexAt = (frame: Frame, p: Vec2) =>
  frame.vertices_coords.findIndex(q => close(q[0], p[0]) && close(q[1], p[1]))

describe('Gesture.crease: an exact crease overrides the drag bisector', () => {
  // the drag alone would crease along a slant; the given crease is x = 0.5
  const g = fold({ grab: [0.9, 0.5], target: [0.1, 0.1], crease: vertical(0.5) })

  test('preview creases along the given line', () => {
    const { preview: pv } = ok(preview(sheet(), g))
    expect(pv.crease).toHaveLength(1)
    const [a, b] = pv.crease[0]
    expect([a, b].every(p => close(p[0], 0.5))).toBe(true)
  })

  test('commit folds the grab side over it, whichever way the line points', () => {
    for (const crease of [vertical(0.5), { origin: [0.5, 1], vector: [0, -3] } as Line]) {
      const { frame, step } = ok(commit(sheet(), { ...g, crease }))
      const c = foldedCoords(frame)
      expect(near(c[vertexAt(frame, [1, 0])], [0, 0])).toBe(true)
      expect(near(c[vertexAt(frame, [1, 1])], [0, 1])).toBe(true)
      expect(near(c[vertexAt(frame, [0, 0])], [0, 0])).toBe(true)
      const line = (step.params as { crease: Line }).crease
      expect(close(line.origin[0], 0.5) && close(line.vector[0], 0)).toBe(true)
    }
  })

  test('snapAngle does not rotate an exact crease', () => {
    const slant: Line = { origin: [0.5, 0.5], vector: [1, 0.3] }
    const { preview: pv } = ok(preview(sheet(), { ...g, grab: [0.5, 0.9], crease: slant, snapAngle: true }))
    const [a, b] = pv.crease[0]
    expect(close((b[1] - a[1]) / (b[0] - a[0]), 0.3)).toBe(true)
  })

  test('a crease through the grab point, a zero vector, or a non-finite line is refused quietly', () => {
    for (const crease of [
      { origin: [0.9, 0.5], vector: [0, 1] },
      { origin: [0.5, 0.5], vector: [0, 0] },
      { origin: [NaN, 0], vector: [0, 1] },
      { origin: [0.5, 0], vector: [0, Infinity] },
    ] as Line[]) {
      expect(preview(sheet(), { ...g, crease })).toEqual(TOO_SHORT)
      expect(commit(sheet(), { ...g, crease })).toEqual(TOO_SHORT)
    }
  })

  test('a crease that misses the paper is refused', () => {
    expect(commit(sheet(), { ...g, grab: [0.5, 0.5], crease: vertical(3) })).toEqual({
      ok: false,
      reason: 'That crease misses the paper.',
    })
  })

  test('reverse folds take the exact crease too', () => {
    // doubleTriangle's inside reverse at y = 0.25 (see compound.test.ts), given as a crease
    const drag: Gesture = { ...fold({ grab: [0.95, 0.1], target: [0.95, 0.4] }), tool: 'reverse', layers: 4 }
    const exact = { ...drag, target: [0.95, 0.2] as Vec2, crease: { origin: [0, 0.25], vector: [1, 0] } as Line }
    const a = ok(commit(doubleTriangle(), drag))
    const b = ok(commit(doubleTriangle(), exact))
    expect(b.step.label).toBe(a.step.label)
    expect(foldedCoords(b.frame).length).toBe(foldedCoords(a.frame).length)
    foldedCoords(b.frame).forEach((p, v) => expect(near(p, foldedCoords(a.frame)[v], 1e-9)).toBe(true))
  })
})

describe('Gesture.angleDeg: an exact fold angle overrides progress', () => {
  const g = fold({ grab: [0.9, 0.5], target: [0.1, 0.5], progress: 0 })

  test('asking 90 commits exactly 90', () => {
    const { frame, step } = ok(commit(sheet(), { ...g, angleDeg: 90 }))
    expect((step.params as { angleDeg: number }).angleDeg).toBe(90)
    expect(frame.edges_foldAngle).toContain(90)
    expect(step.label).toBe('Valley fold · top flap · 90°')
    // through progress, the nearest one gets is a rounding error away
    const viaProgress = ok(commit(sheet(), { ...g, progress: 1 - Math.SQRT1_2 }))
    expect(close((viaProgress.step.params as { angleDeg: number }).angleDeg, 90, 1e-9)).toBe(true)
  })

  test('preview shows exactly the asked angle; 180 commits a flat fold whatever the progress', () => {
    expect(ok(preview(sheet(), { ...g, angleDeg: 45 })).preview.angleDeg).toBe(45)
    const { frame } = ok(commit(sheet(), { ...g, angleDeg: 180 }))
    expect(frame.edges_foldAngle).toContain(180)
    expect(frame.faceOrders.length).toBeGreaterThan(0)
  })

  test('0 is no fold; out of [0, 180] and non-finite are refused', () => {
    expect(commit(sheet(), { ...g, progress: 1, angleDeg: 0 })).toEqual(TOO_SHORT)
    for (const a of [-1, 180.0001, 360]) {
      expect(preview(sheet(), { ...g, angleDeg: a })).toEqual(RANGE)
      expect(commit(sheet(), { ...g, angleDeg: a })).toEqual(RANGE)
    }
    for (const a of [NaN, Infinity]) {
      expect(preview(sheet(), { ...g, angleDeg: a })).toEqual(TOO_SHORT)
      expect(commit(sheet(), { ...g, angleDeg: a })).toEqual(TOO_SHORT)
    }
  })

  test('compound tools complete on any angle > 0 and refuse 0', () => {
    const drag: Gesture = { ...fold({ grab: [0.95, 0.1], target: [0.95, 0.4] }), tool: 'reverse', layers: 4, progress: 0 }
    expect(commit(doubleTriangle(), { ...drag, angleDeg: 0, progress: 1 })).toEqual(TOO_SHORT)
    expect(ok(commit(doubleTriangle(), { ...drag, angleDeg: 30 })).step.label).toBe('Inside reverse fold · 4 layers')
    expect(ok(preview(doubleTriangle(), { ...drag, angleDeg: 30 })).preview.angleDeg).toBe(30)
  })
})

describe('Gesture.face: the hit face starts the top-k selection', () => {
  // crease x = 0.2, oriented so that grab [0.1, 0.5] is on its left; the half
  // fold's hinge (x = 0.5) is on the stationary side, so nothing floods across it
  const moveSide: Line = vertical(0.2)

  test('selectFlap starts at the hit face and clamps k to the layers from it down', () => {
    const f = halfFolded()
    expect(layerAt(f, [0.1, 0.5])).toEqual([1, 0])
    expect(selectFlap(f, [0.1, 0.5], 1, moveSide).faces).toEqual([1])
    expect(selectFlap(f, [0.1, 0.5], 1, moveSide, 0)).toEqual({ faces: [0], k: 1 })
    expect(selectFlap(f, [0.1, 0.5], 2, moveSide, 0)).toEqual({ faces: [0], k: 1 })
    expect(selectFlap(f, [0.1, 0.5], 2, moveSide, 1)).toEqual({ faces: [0, 1], k: 2 })
  })

  test('an invalid hit face (not under grab, not a face id) is ignored', () => {
    const f = halfFolded()
    for (const face of [7, -1, 0.5]) expect(selectFlap(f, [0.1, 0.5], 1, moveSide, face).faces).toEqual([1])
    const g = fold({ grab: [0.1, 0.5], target: [0.3, 0.5] })
    expect(ok(preview(f, { ...g, face: 7 })).preview.moving).toEqual(ok(preview(f, g)).preview.moving)
  })

  test('a gesture on the bottom layer folds the bottom layer', () => {
    const f = halfFolded()
    const g = fold({ grab: [0.1, 0.5], target: [0.3, 0.5], kind: 'mountain', face: 0 })
    const pv = ok(preview(f, g)).preview
    expect(pv.layers).toBe(1)
    const top = ok(preview(f, { ...g, face: undefined })).preview
    expect(pv.moving).not.toEqual(top.moving)
    const { step } = ok(commit(f, g))
    expect((step.params as { face: number }).face).toBe(0)
  })

  test('a non-finite hit face is refused quietly', () => {
    const g = fold({ grab: [0.1, 0.5], target: [0.3, 0.5], face: NaN })
    expect(preview(halfFolded(), g)).toEqual(TOO_SHORT)
    expect(commit(halfFolded(), g)).toEqual(TOO_SHORT)
  })

  test('compound tools start from the hit face: a squash on the top face is unchanged by naming it', () => {
    const f = preliminary()
    const top = layerAt(f, [0.3, 0.1])[0]
    const g: Gesture = { ...fold({ grab: [0.3, 0.1], target: [0.45, 0.05] }), tool: 'squash' }
    const a = preview(f, g)
    const b = preview(f, { ...g, face: top })
    expect(b.ok).toBe(a.ok)
    if (a.ok && b.ok) expect(b.preview.moving).toEqual(a.preview.moving)
  })
})
