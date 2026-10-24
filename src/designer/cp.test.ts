import { describe, expect, test } from 'vitest'
import { GRID_PRESETS, addCrease, creaseEdges, emptyCP, flip, removeCrease, setAssignment, snapToGrid, type CP } from './cp'

const interior = (cp: CP) =>
  cp.vertices_coords.filter(([x, y]) => x > 1e-9 && x < 1 - 1e-9 && y > 1e-9 && y < 1 - 1e-9).length
const len = (cp: CP, e: number) => {
  const [u, v] = cp.edges_vertices[e]!
  const p = cp.vertices_coords[u]!
  const q = cp.vertices_coords[v]!
  return Math.hypot(p[0] - q[0], p[1] - q[1])
}

describe('the crease pattern model', () => {
  test('a blank sheet is its four boundary edges', () => {
    const cp = emptyCP({ width: 1, height: 1 })
    expect(cp.vertices_coords).toHaveLength(4)
    expect(cp.edges_assignment).toEqual(['B', 'B', 'B', 'B'])
    expect(creaseEdges(cp)).toEqual([])
  })

  test('two crossing creases make 4 edges and 1 interior vertex', () => {
    let cp = emptyCP({ width: 1, height: 1 })
    cp = addCrease(cp, [0, 0], [1, 1], 'V')
    cp = addCrease(cp, [1, 0], [0, 1], 'M')
    expect(creaseEdges(cp)).toHaveLength(4)
    expect(interior(cp)).toBe(1)
    expect(cp.edges_assignment.filter(a => a === 'V')).toHaveLength(2)
    expect(cp.edges_assignment.filter(a => a === 'M')).toHaveLength(2)
    // the boundary is untouched (the diagonals end on corners)
    expect(cp.edges_assignment.filter(a => a === 'B')).toHaveLength(4)
  })

  test('a crease ending on a boundary edge splits it there', () => {
    const cp = addCrease(emptyCP({ width: 1, height: 1 }), [0.5, 0], [0.5, 1], 'V')
    expect(cp.edges_assignment.filter(a => a === 'B')).toHaveLength(6)
    expect(creaseEdges(cp)).toHaveLength(1)
  })

  test('a crease running past the paper is clipped to it', () => {
    const cp = addCrease(emptyCP({ width: 1, height: 1 }), [-1, 0.5], [2, 0.5], 'M')
    const [e] = creaseEdges(cp)
    expect(len(cp, e!)).toBeCloseTo(1, 12)
  })

  describe('near-coincident creases (Review Focus 1)', () => {
    test('adding a crease within 1e-6 of an existing one leaves the edge count unchanged', () => {
      const a = addCrease(emptyCP({ width: 1, height: 1 }), [0, 0], [1, 1], 'V')
      const b = addCrease(a, [0, 4e-7], [1, 1 - 3e-7], 'V')
      expect(b.edges_vertices).toHaveLength(a.edges_vertices.length)
      expect(b.vertices_coords).toHaveLength(a.vertices_coords.length)
      // a near-duplicate with another assignment re-assigns, it does not add
      const c = addCrease(a, [5e-7, 0], [1, 1], 'M')
      expect(c.edges_vertices).toHaveLength(a.edges_vertices.length)
      expect(c.edges_assignment.filter(x => x === 'M')).toHaveLength(1)
    })

    test('endpoints within 1e-6 of a vertex or an edge snap to it: no zero-length edges', () => {
      let cp = emptyCP({ width: 1, height: 1 })
      cp = addCrease(cp, [0, 0.5], [1, 0.5], 'V')
      cp = addCrease(cp, [0.5, 0], [0.5, 0.5 + 6e-7], 'M') // ends a hair past the horizontal crease
      cp = addCrease(cp, [0.5 + 4e-7, 0.5 - 5e-7], [0.5, 1], 'M') // starts a hair off the crossing
      cp = addCrease(cp, [0.25, 0.5 + 9e-7], [0.25, 1], 'V') // T-junction a hair above the crease
      for (const e of cp.edges_vertices.keys()) expect(len(cp, e)).toBeGreaterThan(1e-6)
      expect(interior(cp)).toBe(2)
      // the horizontal crease is split at x = 0.25 and 0.5; the vertical one at y = 0.5
      expect(creaseEdges(cp)).toHaveLength(3 + 2 + 1)
      const keys = cp.vertices_coords.map(([x, y]) => `${x.toFixed(9)} ${y.toFixed(9)}`)
      expect(new Set(keys).size).toBe(keys.length)
    })

    test('a vertex 1e-6 apart from another is merged into it, even far from the origin', () => {
      const big = emptyCP({ width: 100, height: 100 })
      const a = addCrease(big, [0, 50], [100, 50], 'V')
      const b = addCrease(a, [50, 50 + 5e-7], [50, 100], 'M')
      expect(b.vertices_coords.filter(([x, y]) => Math.abs(x - 50) < 1e-3 && Math.abs(y - 50) < 1e-3)).toHaveLength(1)
    })
  })

  test('set, flip and remove', () => {
    let cp = addCrease(emptyCP({ width: 1, height: 1 }), [0, 0.5], [1, 0.5], 'V')
    const [e] = creaseEdges(cp)
    cp = flip(cp, e!)
    expect(cp.edges_assignment[e!]).toBe('M')
    expect(cp.edges_foldAngle[e!]).toBe(-180)
    cp = setAssignment(cp, e!, 'U')
    expect(cp.edges_assignment[e!]).toBe('U')
    expect(flip(cp, e!).edges_assignment[e!]).toBe('U')
    // the boundary is not a crease: it cannot be reassigned or removed
    const b = cp.edges_assignment.indexOf('B')
    expect(setAssignment(cp, b, 'V')).toBe(cp)
    expect(removeCrease(cp, b)).toBe(cp)
    // removing the crease merges the split boundary edges back
    const gone = removeCrease(cp, e!)
    expect(creaseEdges(gone)).toEqual([])
    expect(gone.edges_vertices).toHaveLength(4)
    expect(gone.vertices_coords).toHaveLength(4)
  })

  test('removing one of two crossing creases merges the other back into one edge', () => {
    let cp = emptyCP({ width: 1, height: 1 })
    cp = addCrease(cp, [0, 0], [1, 1], 'V')
    cp = addCrease(cp, [1, 0], [0, 1], 'M')
    const m = cp.edges_assignment.indexOf('M')
    const one = removeCrease(cp, m)
    // one half of the M diagonal goes; the V diagonal is still split at the centre by the other M half
    expect(creaseEdges(one)).toHaveLength(3)
    const two = removeCrease(one, one.edges_assignment.indexOf('M'))
    expect(creaseEdges(two)).toHaveLength(1)
    expect(two.vertices_coords).toHaveLength(4)
  })
})

describe('grid snapping', () => {
  test('8×8 and 16×16 snap to the nearest grid point', () => {
    expect(snapToGrid([0.13, 0.49], GRID_PRESETS['8x8'])).toEqual([0.125, 0.5])
    expect(snapToGrid([0.09, 0.97], GRID_PRESETS['16x16'])).toEqual([0.0625, 1])
    expect(snapToGrid([0.3, 0.3], { kind: 'square', divisions: 3 })).toEqual([1 / 3, 1 / 3])
    // A4: the grid spans the sheet
    expect(snapToGrid([0.5, 1.3], GRID_PRESETS['8x8'], { size: { width: 1, height: Math.SQRT2 } })[1]).toBeCloseTo((Math.SQRT2 * 7) / 8, 12)
  })

  test('the 22.5° grid snaps the direction to the nearest multiple', () => {
    const anchor = [0, 0] as const
    const p = snapToGrid([1, 0.35], GRID_PRESETS['22.5'], { anchor }) // ~19.3° → 22.5°
    const ang = (Math.atan2(p[1] - anchor[1], p[0] - anchor[0]) * 180) / Math.PI
    expect(ang).toBeCloseTo(22.5, 9)
    // the length along the direction is kept (projection)
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(Math.hypot(1, 0.35) * Math.cos(((22.5 - 19.290046219188735) * Math.PI) / 180), 9)
    const q = snapToGrid([0.2, 0.9], GRID_PRESETS['22.5'], { anchor: [0, 0] }) // ~77.5° → 67.5°
    expect((Math.atan2(q[1], q[0]) * 180) / Math.PI).toBeCloseTo(67.5, 9)
    // without an anchor there is no direction to snap
    expect(snapToGrid([0.2, 0.9], GRID_PRESETS['22.5'])).toEqual([0.2, 0.9])
  })
})
