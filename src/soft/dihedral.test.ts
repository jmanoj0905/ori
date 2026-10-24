import { describe, expect, test } from 'vitest'
import { dihedral, dihedralGradient } from './dihedral'

/** Two triangles on the edge a = (0,0,0) → b = (1,0,0): c on the left (y > 0), d on the right, d's half turned by `deg` about the edge. */
function hinge(deg: number): number[] {
  const t = (deg * Math.PI) / 180
  return [0, 0, 0, 1, 0, 0, 0.3, 1, 0, 0.6, -Math.cos(t), Math.sin(t)]
}

describe('dihedral', () => {
  test('0 when flat; a valley (front faces closing) is positive, a mountain negative', () => {
    expect(dihedral(hinge(0), 0, 1, 2, 3)).toBeCloseTo(0, 12)
    expect((dihedral(hinge(90), 0, 1, 2, 3) * 180) / Math.PI).toBeCloseTo(90, 9)
    expect((dihedral(hinge(-60), 0, 1, 2, 3) * 180) / Math.PI).toBeCloseTo(-60, 9)
    expect(Math.abs((dihedral(hinge(179.9), 0, 1, 2, 3) * 180) / Math.PI)).toBeCloseTo(179.9, 6)
  })

  test('the same hinge read from the other side (b, a, d, c) has the same angle', () => {
    for (const deg of [-120, -30, 45, 150]) expect(dihedral(hinge(deg), 1, 0, 3, 2)).toBeCloseTo(dihedral(hinge(deg), 0, 1, 2, 3), 12)
  })

  test('the gradient matches finite differences', () => {
    for (const deg of [-150, -45, 10, 90, 160]) {
      const p = hinge(deg)
      p[2] = 0.05 // a little off the axis plane
      const g = new Float64Array(12)
      dihedralGradient(p, 0, 1, 2, 3, g)
      for (let i = 0; i < 12; i++) {
        const q = [...p]
        const r = [...p]
        q[i]! += 1e-6
        r[i]! -= 1e-6
        expect(g[i]).toBeCloseTo((dihedral(q, 0, 1, 2, 3) - dihedral(r, 0, 1, 2, 3)) / 2e-6, 5)
      }
    }
  })

  test('a degenerate hinge has a zero gradient', () => {
    const g = new Float64Array(12).fill(7)
    dihedralGradient([0, 0, 0, 1, 0, 0, 0.5, 0, 0, 0.5, -1, 0], 0, 1, 2, 3, g)
    expect([...g]).toEqual(new Array(12).fill(0))
  })
})
