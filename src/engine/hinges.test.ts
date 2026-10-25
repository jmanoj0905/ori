import { describe, expect, test } from 'vitest'
import { hingesAt } from '@engine'
import type { Frame, Gesture } from '@engine'
import { commit } from './ops'
import { makeSheet } from './rabbit'
import { accordion, halfFolded } from './testkit'

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

function ok<T>(r: ({ ok: true } & T) | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r
}

const fold = (over: Partial<Gesture>): Gesture => ({
  tool: 'fold',
  grab: [0, 0],
  target: [0, 0],
  layers: 1,
  kind: 'valley',
  progress: 1,
  snapAngle: false,
  ...over,
})

function opened(): Frame {
  const f = halfFolded()
  const [h] = hingesAt(f, [0.1, 0.5], 1)
  return ok(commit(f, fold({ crease: h.line, kind: h.openKind, progress: 1, grab: [0.1, 0.5], target: [0.1, 0.5] }))).frame
}

describe('hingesAt', () => {
  test('half fold: one hinge at x = 0.5', () => {
    const hs = hingesAt(halfFolded(), [0.1, 0.5], 1)
    expect(hs).toHaveLength(1)
    const [h] = hs
    expect(Math.abs(h.line.vector[0])).toBeLessThan(1e-9)
    expect(close(h.line.origin[0], 0.5)).toBe(true)
    expect(close(h.rangeDeg, 180)).toBe(true)
    const ys = h.segments.flat().map(p => p[1])
    expect(close(Math.min(...ys), 0)).toBe(true)
    expect(close(Math.max(...ys), 1)).toBe(true)
    for (const p of h.segments.flat()) expect(close(p[0], 0.5)).toBe(true)
  })

  test('openKind swings it open', () => {
    const f = opened()
    expect(f.edges_foldAngle.every(a => a === 0)).toBe(true)
    const mid = f.edges_vertices.findIndex(([u, v]) => close(f.vertices_coords[u][0], 0.5) && close(f.vertices_coords[v][0], 0.5))
    expect(mid).toBeGreaterThanOrEqual(0)
    expect(f.edges_assignment[mid]).toBe('F')
  })

  test('second of two folds', () => {
    const f = ok(
      commit(
        halfFolded(),
        fold({ crease: { origin: [0, 0.5], vector: [1, 0] }, grab: [0.25, 0.9], target: [0.25, 0.9], layers: 2, progress: 1 }),
      ),
    ).frame
    const hs = hingesAt(f, [0.25, 0.1], 2)
    const h = hs.find(c => Math.abs(c.line.vector[1]) < 1e-9 && close(c.line.origin[1], 0.5))
    expect(h).toBeDefined()
    expect(h!.faces).toHaveLength(2)
    expect(close(h!.rangeDeg, 180)).toBe(true)
  })

  test('flat sheet: none', () => {
    expect(hingesAt(makeSheet({ width: 1, height: 1 }), [0.5, 0.5], 1)).toEqual([])
  })

  test('open crease is not a hinge', () => {
    expect(hingesAt(opened(), [0.1, 0.5], 1)).toEqual([])
  })

  test('grab on the hinge line: none for that line', () => {
    let hs: ReturnType<typeof hingesAt> = []
    expect(() => (hs = hingesAt(halfFolded(), [0.5, 0.5], 1))).not.toThrow()
    expect(hs.some(h => Math.abs(h.line.vector[0]) < 1e-9 && close(h.line.origin[0], 0.5))).toBe(false)
  })

  test('cached per frame', () => {
    const f = accordion(40)
    const a = hingesAt(f, [0.01, 0.5], 1)
    const t0 = performance.now()
    const b = hingesAt(f, [0.01, 0.5], 1)
    const dt = performance.now() - t0
    expect(b).toEqual(a)
    expect(dt).toBeLessThan(1)
    // and on a frame with a candidate (the accordion's chained flap has none)
    const h = halfFolded()
    const c = hingesAt(h, [0.1, 0.5], 1)
    expect(c).toHaveLength(1)
    expect(hingesAt(h, [0.1, 0.5], 1)).toEqual(c)
  })
})
