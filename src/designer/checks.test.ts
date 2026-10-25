import { describe, expect, test } from 'vitest'
import { addCrease, emptyCP, type CP } from './cp'
import { kawasaki, maekawa, vertexIssues } from './checks'
import { birdBase, waterbombBase } from './fixtures'

const at = (cp: CP, x: number, y: number) => cp.vertices_coords.findIndex(p => Math.abs(p[0] - x) < 1e-9 && Math.abs(p[1] - y) < 1e-9)

describe('flat-foldability checks', () => {
  test('the waterbomb and bird base patterns pass both checks', () => {
    for (const cp of [waterbombBase(), birdBase()]) {
      expect(kawasaki(cp)).toEqual([])
      expect(maekawa(cp)).toEqual([])
      expect(vertexIssues(cp)).toEqual([])
    }
  })

  test('the waterbomb drawn in the editor passes too (flat midline left unassigned)', () => {
    let cp = emptyCP({ width: 1, height: 1 })
    cp = addCrease(cp, [0, 0], [1, 1], 'V')
    cp = addCrease(cp, [1, 0], [0, 1], 'V')
    cp = addCrease(cp, [0, 0.5], [1, 0.5], 'M')
    cp = addCrease(cp, [0.5, 0], [0.5, 1], 'U')
    expect(kawasaki(cp)).toEqual([])
    expect(maekawa(cp)).toEqual([])
  })

  test('a single crease ending in the interior fails Maekawa at that vertex', () => {
    const cp = addCrease(emptyCP({ width: 1, height: 1 }), [0, 0.5], [0.6, 0.5], 'V')
    expect(maekawa(cp)).toEqual([at(cp, 0.6, 0.5)])
  })

  test('a perturbed 30° angle fails Kawasaki', () => {
    // a degree-4 vertex at the centre with sectors 30°, 60°, 150°, 120° (flat-foldable), then the 30° crease nudged
    const build = (nudge: number) => {
      const d = (deg: number): [number, number] => [0.5 + Math.cos((deg * Math.PI) / 180), 0.5 + Math.sin((deg * Math.PI) / 180)]
      let cp = emptyCP({ width: 1, height: 1 })
      for (const [deg, a] of [[0, 'M'], [30 + nudge, 'M'], [90, 'M'], [240, 'V']] as const) cp = addCrease(cp, [0.5, 0.5], d(deg), a)
      return cp
    }
    const good = build(0)
    expect(kawasaki(good)).toEqual([])
    expect(maekawa(good)).toEqual([])
    const bad = build(0.5)
    expect(kawasaki(bad)).toEqual([at(bad, 0.5, 0.5)])
    expect(maekawa(bad)).toEqual([])
    const [issue] = vertexIssues(bad)
    expect(issue).toMatchObject({ vertex: at(bad, 0.5, 0.5), kinds: ['kawasaki'] })
    expect(issue!.text).toMatch(/Kawasaki: alternating angles sum to 180\.5° and 179\.5°, not 180°/)
  })

  test('unassigned and flat creases are excluded from the checks (Review Focus 2)', () => {
    const cp = addCrease(emptyCP({ width: 1, height: 1 }), [0, 0.5], [0.6, 0.5], 'U')
    expect(maekawa(cp)).toEqual([])
    expect(kawasaki(cp)).toEqual([])
    const f: CP = { ...cp, edges_assignment: cp.edges_assignment.map(a => (a === 'U' ? 'F' : a)) }
    expect(maekawa(f)).toEqual([])
  })

  test('vertices on the sheet boundary are not checked', () => {
    const cp = addCrease(emptyCP({ width: 1, height: 1 }), [0, 0.25], [1, 0.75], 'V')
    expect(kawasaki(cp)).toEqual([])
    expect(maekawa(cp)).toEqual([])
  })
})
