import { describe, expect, test } from 'vitest'
import { containsPoint, layerAt, layerRanks, selectFlap, withLayerOrder } from './layers'
import { BASE_NAMES, baseFrame, foldThrough, foldedCoords, makeSheet } from './rabbit'
import { accordion, base, doubleTriangle, halfFolded, preliminary } from './testkit'
import type { Frame, Line } from './types'

const vertical = (x: number): Line => ({ origin: [x, 0], vector: [0, 1] })
const sheet = () => makeSheet({ width: 1, height: 1 })
const halfMountain = (): Frame =>
  foldThrough(sheet(), vertical(0.5), [0], 'mountain', 180)!

describe('layerAt', () => {
  test('half fold: 2 faces at the centre of the folded half, the moved face first', () => {
    const f = halfFolded()
    // pins the fixture: face 0 is the stationary left half, face 1 the moved right half
    expect(f.faceOrders).toEqual([[0, 1, 1]])
    expect(layerAt(f, [0.25, 0.5])).toEqual([1, 0])
  })
  test('mountain half fold: the moved face goes underneath', () => {
    expect(layerAt(halfMountain(), [0.25, 0.5])).toEqual([0, 1])
  })
  test('a point off the folded paper has no layers', () => {
    expect(layerAt(halfFolded(), [0.75, 0.5])).toEqual([])
    expect(layerAt(sheet(), [2, 2])).toEqual([])
  })
  test('the flat sheet has one layer', () => expect(layerAt(sheet(), [0.5, 0.5])).toEqual([0]))
  test('boundary points count as inside', () => {
    expect(layerAt(halfFolded(), [0.5, 0.5])).toEqual([1, 0]) // on the hinge
    expect(layerAt(halfFolded(), [0, 0])).toEqual([1, 0]) // on a corner
  })
  test('unordered faces tie-break to the lowest face id', () => {
    const f = { ...halfFolded(), faceOrders: [] }
    expect(layerAt(f, [0.25, 0.5])).toEqual([0, 1])
  })
})

describe('containsPoint', () => {
  test('a polygon seen edge-on (zero-length sides) contains only its own boundary', () => {
    const edgeOn: [number, number][] = [[0.5, 0], [0.5, 0], [0.5, 1], [0.5, 1]]
    expect(containsPoint(edgeOn, [0.1, 0.5])).toBe(false)
    expect(containsPoint(edgeOn, [0.5, 0.5])).toBe(true)
    expect(containsPoint(edgeOn, [0.5, 0])).toBe(true)
  })
})

describe('selectFlap', () => {
  const grab: [number, number] = [0.1, 0.5]
  const crease = vertical(0.25)
  test('k=1 moves the top face only', () =>
    expect(selectFlap(halfFolded(), grab, 1, crease)).toEqual({ faces: [1], k: 1 }))
  test('k=2 moves both faces', () =>
    expect(selectFlap(halfFolded(), grab, 2, crease)).toEqual({ faces: [0, 1], k: 2 }))
  test('k=9 is clamped to the 2 available layers', () =>
    expect(selectFlap(halfFolded(), grab, 9, crease)).toEqual({ faces: [0, 1], k: 2 }))
  test('k below 1 is raised to 1', () =>
    expect(selectFlap(halfFolded(), grab, 0, crease)).toEqual({ faces: [1], k: 1 }))
  test('grab off the paper selects nothing', () =>
    expect(selectFlap(halfFolded(), [0.9, 0.5], 1, vertical(0.7))).toEqual({ faces: [], k: 0 }))
  test('a grab exactly on a vertex is deterministic and does not throw', () => {
    const a = selectFlap(halfFolded(), [0, 0], 1, { origin: [0.2, 0], vector: [-1, 1] })
    const b = selectFlap(halfFolded(), [0, 0], 1, { origin: [0.2, 0], vector: [-1, 1] })
    expect(a).toEqual(b)
    expect(a).toEqual({ faces: [1], k: 1 })
  })
  test('a grab exactly on a crease is deterministic and does not throw', () => {
    const a = selectFlap(halfFolded(), [0.5, 0.5], 1, vertical(0.4))
    expect(a).toEqual(selectFlap(halfFolded(), [0.5, 0.5], 1, vertical(0.4)))
    // the grab is on the hinge, which lies on the moving side: both layers come
    expect(a).toEqual({ faces: [0, 1], k: 1 })
  })
  test('a hinged layer straddling the crease comes along when the hinge is on the moving side', () => {
    // fold the folded edge (hinge at x = 0.5) over a crease at x = 0.25
    const h = halfFolded()
    const flap = selectFlap(h, [0.4, 0.5], 1, vertical(0.25))
    expect(flap).toEqual({ faces: [0, 1], k: 1 })
    expect(foldThrough(h, vertical(0.25), flap.faces, 'valley', 180)!.faces_vertices).toHaveLength(4)
  })
  test('a hinge on the stationary side keeps the lower layer put', () =>
    expect(selectFlap(halfFolded(), [0.1, 0.5], 1, vertical(0.25))).toEqual({ faces: [1], k: 1 }))
  test('a crease missing the folded paper moves everything hinged to the grab', () =>
    expect(selectFlap(halfFolded(), [0.25, 0.5], 1, vertical(0.6))).toEqual({ faces: [0, 1], k: 1 }))
  test('flood fill never crosses the crease line itself', () => {
    // crease on the hinge: grabbing the top layer unfolds it alone
    expect(selectFlap(halfFolded(), [0.25, 0.5], 1, vertical(0.5))).toEqual({ faces: [1], k: 1 })
  })
})

describe('Rabbit Ear bases', () => {
  test.each(BASE_NAMES)('%s: layers and flaps at every face centroid are well-formed', name => {
    const f = baseFrame(name)
    const coords = foldedCoords(f)
    f.faces_vertices.forEach((vs, face) => {
      const c: [number, number] = [
        vs.reduce((s, v) => s + coords[v][0], 0) / vs.length,
        vs.reduce((s, v) => s + coords[v][1], 0) / vs.length,
      ]
      const stack = layerAt(f, c)
      expect(stack).toContain(face)
      expect(new Set(stack).size).toBe(stack.length)
      const flap = selectFlap(f, c, 1, { origin: [c[0] + 0.01, c[1]], vector: [0, 1] })
      expect(flap.k).toBe(1)
      expect(flap.faces).toContain(stack[0])
    })
  })
})

describe('Rabbit Ear kite base', () => {
  // folded kite: faces 0/1 are the upper flap and the sheet under it (y ≥ 0),
  // hinged by the V diagonal; faces 2/3 mirror them below y = 0, joined to
  // face 1 by the flat centre line y = 0.
  test('a crease above the centre line moves only the upper flap and its hinged layer', () =>
    expect(selectFlap(baseFrame('kite'), [1, 0.2], 1, { origin: [0, 0.1], vector: [1, 0] })).toEqual({
      faces: [0, 1],
      k: 1,
    }))
  test('a crease across the tip takes both tip layers (joined at the centre line), not the flaps', () =>
    expect(selectFlap(baseFrame('kite'), [1.2, 0.05], 1, vertical(1.1))).toEqual({ faces: [1, 2], k: 1 }))
})

describe('withLayerOrder', () => {
  test('re-solves a flat frame without mutating it', () => {
    const f = { ...halfFolded(), faceOrders: [] }
    const r = withLayerOrder(f)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.frame.faceOrders).toEqual([[0, 1, 1]])
    expect(f.faceOrders).toEqual([])
    expect(r.frame).not.toBe(f)
  })
  test('refuses a frame with no valid layer order', () => {
    const partial = foldThrough(sheet(), vertical(0.5), [0], 'valley', 90)!
    expect(withLayerOrder(partial)).toEqual({ ok: false, reason: 'No valid layer order exists for this fold.' })
  })
})

describe('layerRanks (final review 4a)', () => {
  test('per face, 0 = bottom: the half fold has the moved face on top', () => {
    expect(layerRanks(halfFolded())).toEqual([0, 1])
    expect(layerRanks(halfMountain())).toEqual([1, 0])
    expect(layerRanks(sheet())).toEqual([0])
  })
  test('an accordion stacks n−1 (top) … 0 (bottom)', () => {
    expect(layerRanks(accordion(6))).toEqual([0, 1, 2, 3, 4, 5])
  })
  test('a permutation of 0 … n−1, cached per frame', () => {
    const f = base('bird')
    const r = layerRanks(f)
    expect([...r].sort((a, b) => a - b)).toEqual(f.faces_vertices.map((_, i) => i))
    expect(layerRanks(f)).toBe(r)
  })
  test("agrees with layerAt's top-to-bottom order at every point", () => {
    const frames: Frame[] = [halfFolded(), doubleTriangle(), preliminary(), base('waterbomb'), base('bird'), base('frog')]
    for (const f of frames) {
      const r = layerRanks(f)
      for (let i = 0; i <= 20; i++)
        for (let j = 0; j <= 20; j++) {
          const stack = layerAt(f, [i / 20, j / 20])
          for (let k = 1; k < stack.length; k++) expect(r[stack[k - 1]]).toBeGreaterThan(r[stack[k]])
        }
    }
  })
  test('unordered faces tie-break like layerAt: the lowest face id is on top', () => {
    expect(layerRanks({ ...halfFolded(), faceOrders: [] })).toEqual([1, 0])
  })
})
