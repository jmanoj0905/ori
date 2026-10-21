import ear from 'rabbit-ear'
import { describe, expect, test } from 'vitest'
import {
  BASE_NAMES,
  baseFrame,
  firstSolution,
  foldThrough,
  foldedCoords,
  layerOrders,
  makeSheet,
  windings,
} from './rabbit'
import { area, footprintWidth, halfFolded } from './testkit'
import { PRESETS, runPreset } from '../presets'

// Step 1 spike: confirm the namespace paths recorded at the top of rabbit.ts.
describe('rabbit-ear 0.9.41 namespace (spike)', () => {
  const re = ear as unknown as Record<string, Record<string, unknown>>
  test.each([
    'rectangle',
    'square',
    'simpleFoldLine',
    'foldGraph',
    'foldGraphIntoSubgraph',
    'reverseFold',
    'simpleSquashFold',
    'makeVerticesCoordsFolded',
    'makeFacesWinding',
    'waterbomb',
  ])('ear.graph.%s is a function', name => {
    expect(typeof re.graph[name]).toBe('function')
  })
  test('ear.layer is a callable solver', () => {
    expect(typeof re.layer).toBe('function')
  })
  test('reverseFold and simpleSquashFold are unfinished stubs in 0.9.41', () => {
    const quiet = console.warn
    console.warn = () => {}
    try {
      const g = (re.graph.square as () => object)()
      const line = { origin: [0.5, 0.5], vector: [1, 1] }
      expect((re.graph.reverseFold as (...a: unknown[]) => unknown)(g, line)).toEqual({})
      expect((re.graph.simpleSquashFold as (...a: unknown[]) => unknown)(g, 0, 1)).toEqual({})
    } finally {
      console.warn = quiet
    }
  })
})

test('makeSheet builds a 1×√2 rectangle', () => {
  const f = makeSheet({ width: 1, height: Math.SQRT2 })
  expect(f.faces_vertices).toHaveLength(1)
  expect(area(f)).toBeCloseTo(Math.SQRT2)
})

test('makeSheet: origin corner at [0,0], all fields present, empty faceOrders', () => {
  const f = makeSheet({ width: 2, height: 1 })
  expect(f.vertices_coords).toContainEqual([0, 0])
  expect(f.vertices_coords).toContainEqual([2, 1])
  expect(f.edges_assignment.every(a => a === 'B')).toBe(true)
  expect(f.edges_foldAngle).toHaveLength(f.edges_vertices.length)
  expect(f.faceOrders).toEqual([])
})

test('foldThrough on all faces, valley 180, halves the footprint', () => {
  const f = makeSheet({ width: 1, height: 1 })
  const g = foldThrough(f, { origin: [0.5, 0], vector: [0, 1] }, [0], 'valley', 180)!
  expect(g.faces_vertices).toHaveLength(2)
  expect(footprintWidth(foldedCoords(g))).toBeCloseTo(0.5)
  expect(g.edges_assignment).toContain('V')
})

test('layerOrders returns orders for a half-folded square', () => {
  expect(layerOrders(halfFolded())).not.toBeNull()
})

describe('foldThrough contract', () => {
  const line = { origin: [0.5, 0], vector: [0, 1] } as const

  test('valley maps to V / +angle, mountain to M / −angle', () => {
    const f = makeSheet({ width: 1, height: 1 })
    const v = foldThrough(f, line, [0], 'valley', 90)!
    const m = foldThrough(f, line, [0], 'mountain', 90)!
    const crease = (g: typeof v) => g.edges_assignment.findIndex(a => a !== 'B')
    expect(v.edges_assignment[crease(v)]).toBe('V')
    expect(v.edges_foldAngle[crease(v)]).toBe(90)
    expect(m.edges_assignment[crease(m)]).toBe('M')
    expect(m.edges_foldAngle[crease(m)]).toBe(-90)
  })

  test('never mutates its input', () => {
    const f = makeSheet({ width: 1, height: 1 })
    const before = JSON.stringify(f)
    foldThrough(f, line, [0], 'valley', 180)
    expect(JSON.stringify(f)).toBe(before)
  })

  test('returns null when the line misses the paper', () => {
    const f = makeSheet({ width: 1, height: 1 })
    expect(foldThrough(f, { origin: [5, 0], vector: [0, 1] }, [0], 'valley', 180)).toBeNull()
  })

  test('returns null when the line only runs along existing boundary', () => {
    const f = makeSheet({ width: 1, height: 1 })
    expect(foldThrough(f, { origin: [0, 0], vector: [0, 1] }, [0], 'valley', 180)).toBeNull()
  })

  test('a flat result carries solved faceOrders', () => {
    const g = halfFolded()
    expect(g.faceOrders.length).toBeGreaterThan(0)
    expect(layerOrders(g)).toEqual(expect.arrayContaining(g.faceOrders.map(o => [...o])))
  })

  test('a partial fold still carries a faceOrders field', () => {
    const f = makeSheet({ width: 1, height: 1 })
    const g = foldThrough(f, line, [0], 'valley', 90)!
    expect(Array.isArray(g.faceOrders)).toBe(true)
    expect(layerOrders(g)).toBeNull()
  })

  test('area is conserved', () => {
    expect(area(halfFolded())).toBeCloseTo(1)
  })

  test('a face subset folds only those layers', () => {
    // half-folded square: both layers lie over x ∈ [0, 0.5]. Fold only the
    // moved layer's (face 1's) corner at folded [0, 1] and check the other
    // layer is not creased.
    const h = halfFolded()
    const across = { origin: [0, 0.75], vector: [1, 1] } as const
    const all = foldThrough(h, across, [0, 1], 'valley', 180)!
    const one = foldThrough(h, across, [1], 'valley', 180)!
    const folds = (g: typeof h) => g.edges_assignment.filter(a => a === 'V' || a === 'M').length
    expect(folds(all)).toBe(folds(h) + 2)
    expect(folds(one)).toBe(folds(h) + 1)
    expect(area(one)).toBeCloseTo(1)
    expect(one.faces_vertices).toHaveLength(3)
    // the moved layer's corner (paper [1,1]) reflects across the line to
    // [0.25, 0.75]; the other layer's corner (paper [0,1]) stays put
    const at = (p: readonly number[]) =>
      foldedCoords(one)[one.vertices_coords.findIndex(q => q[0] === p[0] && q[1] === p[1])]
    expect(at([1, 1])[0]).toBeCloseTo(0.25)
    expect(at([1, 1])[1]).toBeCloseTo(0.75)
    expect(at([0, 1])).toEqual([0, 1])
    expect(windings(one)[0]).toBe(windings(h)[0])
    expect(layerOrders(one)).not.toBeNull()
    expect(JSON.stringify(h)).toBe(JSON.stringify(halfFolded()))
  })

  test('returns null when no listed face is crossed', () => {
    const f = makeSheet({ width: 1, height: 1 })
    expect(foldThrough(f, line, [], 'valley', 180)).toBeNull()
    expect(foldThrough(halfFolded(), { origin: [0, 0.5], vector: [1, 0] }, [7], 'valley', 180)).toBeNull()
  })
})

test('windings: half fold has one face flipped', () => {
  expect(windings(halfFolded()).sort()).toEqual([false, true])
  expect(windings(makeSheet({ width: 1, height: 1 }))).toEqual([true])
})

test.each(BASE_NAMES)('baseFrame(%s) is a solved flat frame', name => {
  const b = baseFrame(name)
  expect(b.faces_vertices.length).toBeGreaterThan(1)
  expect(b.edges_foldAngle).toHaveLength(b.edges_vertices.length)
  expect(b.faceOrders.length).toBeGreaterThan(0)
  expect(area(b)).toBeCloseTo(1)
})

describe('layerOrders searches the solver tree when the default pick is a dead branch (final review 2)', () => {
  // Rabbit Ear's default faceOrders() takes choice 0 at every branch and throws
  // when that choice dead-ends, though another branch holds a valid order.
  const planeFrames = () => {
    const r = runPreset(PRESETS.find(p => p.id === 'plane')!)
    if (!r.ok) throw new Error(r.reason)
    return r.history.frames
  }
  for (const i of [6, 8])
    test(`plane frame ${i} with its faceOrders cleared re-solves to a valid order`, () => {
      const f = planeFrames()[i]
      const orders = layerOrders({ ...f, faceOrders: [] })
      expect(orders).not.toBeNull()
      // the order found is self-consistent: fed back as constraints it still solves, unchanged
      const again = layerOrders({ ...f, faceOrders: orders! })
      expect(again).not.toBeNull()
      const key = (o: readonly number[]) => `${Math.min(o[0], o[1])} ${Math.max(o[0], o[1])}`
      const pairs = new Set(orders!.map(key))
      for (const o of again!) expect(pairs.has(key(o))).toBe(true)
      // and it covers every overlapping pair the stored (incrementally solved) order does
      for (const o of f.faceOrders) expect(pairs.has(key(o))).toBe(true)
    })
  test('every Rabbit Ear base gets a solved order (no silent [] fallback)', () => {
    for (const name of BASE_NAMES) expect(baseFrame(name).faceOrders.length, name).toBeGreaterThan(0)
  })
})

describe('firstSolution', () => {
  test('skips a choice that dead-ends deeper down', () => {
    const dead = { orders: [[1, 2, 1]] as [number, number, number][], branches: [[]] }
    const good = { orders: [[1, 2, -1]] as [number, number, number][] }
    const tree = { orders: [[0, 1, 1]] as [number, number, number][], branches: [[dead, good], [{ orders: [[3, 4, 1]] as [number, number, number][] }]] }
    expect(firstSolution(tree)).toEqual([[0, 1, 1], [1, 2, -1], [3, 4, 1]])
    expect(firstSolution({ orders: [], branches: [[dead]] })).toBeNull()
  })
  test("matches Rabbit Ear's default pick where that pick completes", () => {
    const f = baseFrame('bird')
    const g = structuredClone(f) as unknown as Record<string, unknown>
    g.faceOrders = []
    g.vertices_coords = foldedCoords(f).map(p => [p[0], p[1]])
    const tree = (ear as any).layer(g)
    expect(firstSolution(tree)).toEqual(tree.faceOrders())
  })
})
