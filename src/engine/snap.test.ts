import { describe, expect, test } from 'vitest'
import { landmarks, snapCreaseLine, snapPoint, type Landmark } from './snap'
import { makeSheet, rebuildAdjacency } from './rabbit'
import { commit, type Gesture } from './ops'
import { halfFolded, openedHalf } from './testkit'
import type { Vec2 } from './types'

const sheet = () => makeSheet({ width: 1, height: 1 })
const key = (l: Landmark) => `${l.kind} ${l.p[0].toFixed(6)} ${l.p[1].toFixed(6)}`
const keys = (ls: Landmark[]) => ls.map(key).sort()
const lm = (kind: Landmark['kind'], p: Vec2): Landmark => ({ kind, p })

describe('landmarks', () => {
  test('a fresh square: exactly 4 corners and 4 edge midpoints', () => {
    expect(keys(landmarks(sheet()))).toEqual(
      [
        lm('corner', [0, 0]),
        lm('corner', [1, 0]),
        lm('corner', [1, 1]),
        lm('corner', [0, 1]),
        lm('midpoint', [0.5, 0]),
        lm('midpoint', [1, 0.5]),
        lm('midpoint', [0.5, 1]),
        lm('midpoint', [0, 0.5]),
      ].map(key).sort(),
    )
  })

  test('A4: corners and midpoints of a 1 × √2 sheet', () => {
    const ls = landmarks(makeSheet({ width: 1, height: Math.SQRT2 }))
    expect(ls).toHaveLength(8)
    expect(keys(ls)).toContain(key(lm('midpoint', [1, Math.SQRT1_2])))
  })

  test('a half fold: in folded space, duplicates removed', () => {
    const ls = landmarks(halfFolded())
    const corners = keys(ls.filter(l => l.kind === 'corner'))
    expect(corners).toEqual(
      [lm('corner', [0, 0]), lm('corner', [0.5, 0]), lm('corner', [0.5, 1]), lm('corner', [0, 1])].map(key).sort(),
    )
    expect(keys(ls)).toContain(key(lm('midpoint', [0.25, 0])))
    expect(keys(ls)).toContain(key(lm('midpoint', [0.5, 0.5])))
    // no two landmarks within 1e-6 of each other
    for (let i = 0; i < ls.length; i++)
      for (let j = i + 1; j < ls.length; j++)
        expect(Math.hypot(ls[i].p[0] - ls[j].p[0], ls[i].p[1] - ls[j].p[1])).toBeGreaterThan(1e-6)
  })

  test('a crease crossing folded onto the footprint outline stays an intersection', () => {
    // fold the half fold in half again (both layers): footprint [0, 0.5]²
    const g: Gesture = { tool: 'fold', grab: [0.25, 0.9], target: [0.25, 0.1], layers: 2, kind: 'valley', progress: 1, snapAngle: false }
    const c = commit(halfFolded(), g)
    if (!c.ok) throw new Error(c.reason)
    const ls = landmarks(c.frame)
    // boundary vertices where the folded outline turns are corners
    expect(keys(ls.filter(l => l.kind === 'corner'))).toEqual(
      [lm('corner', [0, 0]), lm('corner', [0.5, 0]), lm('corner', [0, 0.5])].map(key).sort(),
    )
    // the paper centre, where the creases x = 0.5 and y = 0.5 cross, is interior paper:
    // a crease–crease intersection, even though it is a corner of the footprint
    expect(keys(ls)).toContain(key(lm('intersection', [0.5, 0.5])))
  })

  test('open creases: crease–crease and crease–boundary crossings are intersections', () => {
    // the unit square with open (F) creases x = 0.5 and y = 0.5
    const vertices_coords: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0.5]]
    const edges_vertices: [number, number][] = [[0, 4], [4, 1], [1, 5], [5, 2], [2, 6], [6, 3], [3, 7], [7, 0], [4, 8], [5, 8], [6, 8], [7, 8]]
    const edges_assignment = [...Array(8).fill('B'), 'F', 'F', 'F', 'F']
    const f = rebuildAdjacency({
      vertices_coords,
      edges_vertices,
      edges_assignment,
      edges_foldAngle: edges_assignment.map(() => 0),
      faces_vertices: [[0, 4, 8, 7], [4, 1, 5, 8], [8, 5, 2, 6], [7, 8, 6, 3]],
      faceOrders: [],
    })
    const ls = landmarks(f)
    expect(keys(ls.filter(l => l.kind === 'intersection'))).toEqual(
      [[0.5, 0.5], [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]].map(p => key(lm('intersection', p as unknown as Vec2))).sort(),
    )
    expect(ls.filter(l => l.kind === 'corner')).toHaveLength(4)
    expect(keys(ls)).toContain(key(lm('midpoint', [0.25, 0])))
    expect(keys(ls)).toContain(key(lm('midpoint', [0.5, 0.25])))
  })

  test('an open crease: its ends on the boundary are crease–boundary intersections', () => {
    // valley-fold then unfold the right half: a flat crease x = 0.5 on an open sheet
    const g: Gesture = { tool: 'fold', grab: [0.1, 0.5], target: [0.9, 0.5], layers: 1, kind: 'valley', progress: 1, snapAngle: false }
    const c = commit(halfFolded(), g)
    if (!c.ok) throw new Error(c.reason)
    expect(c.frame.edges_foldAngle.every(a => a === 0)).toBe(true)
    const ls = landmarks(c.frame)
    expect(keys(ls)).toContain(key(lm('intersection', [0.5, 0])))
    expect(keys(ls)).toContain(key(lm('intersection', [0.5, 1])))
    expect(ls.filter(l => l.kind === 'corner')).toHaveLength(4)
  })

  test('edge landmarks only when asked for, one per distinct folded edge', () => {
    const ls = landmarks(sheet(), { edges: true })
    expect(ls.filter(l => l.kind === 'edge')).toHaveLength(4)
    expect(ls.filter(l => l.kind !== 'edge')).toHaveLength(8)
    // a half fold's stacked boundary halves are one folded edge each
    const hf = landmarks(halfFolded(), { edges: true }).filter(l => l.kind === 'edge')
    expect(hf).toHaveLength(4) // [0,0]–[.5,0], [.5,0]–[.5,1] (the crease), [.5,1]–[0,1], [0,1]–[0,0]
  })
})

describe('snapPoint', () => {
  test('prefers a corner over a midpoint at equal distance', () => {
    const ls = [lm('midpoint', [0.5, 0]), lm('corner', [0, 0])]
    const r = snapPoint([0.25, 0], ls, 0.3)
    expect(r.p).toEqual([0, 0])
    expect(r.snapped?.kind).toBe('corner')
  })

  test('priority beats distance: corner > intersection > midpoint > edge', () => {
    const ls: Landmark[] = [
      lm('midpoint', [0.11, 0]),
      lm('intersection', [0.15, 0]),
      lm('corner', [0.2, 0]),
      { kind: 'edge', p: [0.1, 0.5], seg: [[0.1, 0], [0.1, 1]] },
    ]
    expect(snapPoint([0.1, 0], ls, 0.15).snapped?.kind).toBe('corner')
    expect(snapPoint([0.1, 0], ls, 0.08).snapped?.kind).toBe('intersection')
    expect(snapPoint([0.1, 0], ls, 0.03).snapped?.kind).toBe('midpoint')
    expect(snapPoint([0.1, 0.4], ls, 0.03)).toEqual({ p: [0.1, 0.4], snapped: { kind: 'edge', p: [0.1, 0.4], seg: [[0.1, 0], [0.1, 1]] } })
  })

  test('within a kind, the nearest wins', () => {
    const ls = [lm('corner', [0, 0]), lm('corner', [1, 0]), lm('corner', [0.4, 0])]
    expect(snapPoint([0.3, 0], ls, 1).p).toEqual([0.4, 0])
  })

  test('an edge snaps to the nearest point on its segment', () => {
    const ls = landmarks(sheet(), { edges: true })
    const r = snapPoint([0.3, 0.02], ls, 0.05)
    expect(r.snapped?.kind).toBe('edge')
    expect(r.p[0]).toBeCloseTo(0.3, 12)
    expect(r.p[1]).toBeCloseTo(0, 12)
  })

  test('returns the raw point when nothing is within the radius', () => {
    const p: Vec2 = [0.3, 0.3]
    const r = snapPoint(p, landmarks(sheet(), { edges: true }), 0.1)
    expect(r).toEqual({ p })
    expect(r.snapped).toBeUndefined()
  })
})

describe('cached landmarks cannot be corrupted through results (final review 5c)', () => {
  const tryMutate = (fn: () => void) => {
    try {
      fn()
    } catch {
      // frozen: a TypeError in strict mode is fine, silent corruption is not
    }
  }
  test('mutating snapPoint results leaves the per-frame cache intact', () => {
    const f = sheet()
    const before = JSON.stringify(landmarks(f, { edges: true }))
    const corner = snapPoint([0.99, 0.99], landmarks(f), 0.05)
    tryMutate(() => ((corner.p as unknown as number[])[0] = 42))
    tryMutate(() => ((corner.snapped!.p as unknown as number[])[1] = 42))
    tryMutate(() => ((corner.snapped as { kind: string }).kind = 'edge'))
    const edge = snapPoint([0.3, 0.01], landmarks(f, { edges: true }).filter(l => l.kind === 'edge'), 0.05)
    expect(edge.snapped?.kind).toBe('edge')
    tryMutate(() => ((edge.snapped!.seg![0] as unknown as number[])[0] = 42))
    expect(JSON.stringify(landmarks(f, { edges: true }))).toBe(before)
  })
  test('so does mutating the landmarks list itself', () => {
    const f = sheet()
    const before = JSON.stringify(landmarks(f, { edges: true }))
    const ls = landmarks(f, { edges: true })
    tryMutate(() => ((ls[0].p as unknown as number[])[0] = 42))
    tryMutate(() => ((ls[ls.length - 1].seg![1] as unknown as number[])[1] = 42))
    ls.length = 0
    expect(JSON.stringify(landmarks(f, { edges: true }))).toBe(before)
  })
})

describe('snapCreaseLine', () => {
  const line = { origin: [0.52, 0.3] as Vec2, vector: [0.02, 1] as Vec2 }

  test('locks onto the crease at x = 0.5', () => {
    const f = openedHalf()
    const r = snapCreaseLine(f, line, { angleDeg: 4, dist: 0.04 })
    expect(r).not.toBeNull()
    expect(r!.origin[0]).toBeCloseTo(0.5, 9)
    expect(Math.abs(r!.vector[0])).toBeLessThan(1e-9)
    expect(Math.abs(r!.vector[1])).toBeGreaterThan(0)
  })

  test('the result is a fresh, unfrozen line, not the cached one', () => {
    const f = openedHalf()
    const a = snapCreaseLine(f, line, { angleDeg: 4, dist: 0.04 })!
    const b = snapCreaseLine(f, line, { angleDeg: 4, dist: 0.04 })!
    for (const r of [a, b]) {
      expect(Object.isFrozen(r)).toBe(false)
      expect(Object.isFrozen(r.origin)).toBe(false)
      expect(Object.isFrozen(r.vector)).toBe(false)
    }
    expect(a).not.toBe(b)
    expect(a.vector).not.toBe(b.vector)
  })

  test('too far away: null', () => {
    expect(snapCreaseLine(openedHalf(), line, { angleDeg: 4, dist: 0.01 })).toBeNull()
  })

  test('too far off angle: null', () => {
    expect(snapCreaseLine(openedHalf(), line, { angleDeg: 0.5, dist: 0.04 })).toBeNull()
  })

  test('a fresh sheet has only boundary: null', () => {
    expect(snapCreaseLine(sheet(), line, { angleDeg: 4, dist: 0.04 })).toBeNull()
  })
})
