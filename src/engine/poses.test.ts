import { describe, expect, test } from 'vitest'
import { applyPose, poses } from './poses'
import { BASE_NAMES, baseFrame, foldThrough, foldedCoords, makeSheet } from './rabbit'
import { halfFolded } from './testkit'
import type { Frame, Line, Vec2 } from './types'

const vertical = (x: number): Line => ({ origin: [x, 0], vector: [0, 1] })
const sheet = () => makeSheet({ width: 1, height: 1 })
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

/** The face whose crease-pattern polygon contains `p` (strictly inside). */
function faceAt(frame: Frame, p: Vec2): number {
  return frame.faces_vertices.findIndex(vs => {
    const pts = vs.map(v => frame.vertices_coords[v])
    let sign = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
      if (Math.abs(c) < 1e-12) return false
      if (sign === 0) sign = Math.sign(c)
      else if (Math.sign(c) !== sign) return false
    }
    return true
  })
}

/** World position of crease-pattern vertex `v` as carried by face `f`. */
const world = (frame: Frame, f: number, v: number, swing?: Parameters<typeof poses>[1]) =>
  applyPose(poses(frame, swing)[f].matrix, frame.vertices_coords[v])

const vertexAt = (frame: Frame, p: Vec2) =>
  frame.vertices_coords.findIndex(q => close(q[0], p[0]) && close(q[1], p[1]))

describe('poses', () => {
  test('one pose per face, column-major 4x4 with a homogeneous last row', () => {
    const f = halfFolded()
    const ps = poses(f)
    expect(ps.map(p => p.face)).toEqual(f.faces_vertices.map((_, i) => i))
    for (const { matrix } of ps) {
      expect(matrix).toHaveLength(16)
      expect([matrix[3], matrix[7], matrix[11], matrix[15]]).toEqual([0, 0, 0, 1])
    }
  })

  test('root face 0 has the identity pose', () => {
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for (const f of [sheet(), halfFolded(), baseFrame('bird')])
      poses(f)[0].matrix.forEach((x, i) => expect(close(x, id[i])).toBe(true))
  })

  test('every vertex of a flat sheet lies at z = 0', () => {
    const f = sheet()
    for (const { face, matrix } of poses(f))
      for (const v of f.faces_vertices[face]) expect(close(applyPose(matrix, f.vertices_coords[v])[2], 0)).toBe(true)
  })

  test('valley 90° on a half: the moved far corner rises to z ≈ +0.5 at the crease x', () => {
    const f = foldThrough(sheet(), vertical(0.5), [0], 'valley', 90)!
    const moved = faceAt(f, [0.75, 0.5])
    expect(moved).not.toBe(0)
    const [x, , z] = world(f, moved, vertexAt(f, [1, 0]))
    expect(close(x, 0.5)).toBe(true)
    expect(close(z, 0.5)).toBe(true)
  })

  test('mountain 90° on a half: the moved far corner drops to z ≈ −0.5', () => {
    const f = foldThrough(sheet(), vertical(0.5), [0], 'mountain', 90)!
    const moved = faceAt(f, [0.75, 0.5])
    const [x, , z] = world(f, moved, vertexAt(f, [1, 0]))
    expect(close(x, 0.5)).toBe(true)
    expect(close(z, -0.5)).toBe(true)
  })

  const partial = () => {
    const a = foldThrough(sheet(), vertical(0.5), [0], 'valley', 90)!
    const b = foldThrough(a, { origin: [0, 0.3], vector: [1, 0.2] }, [faceAt(a, [0.25, 0.5])], 'mountain', 45)!
    expect(b.edges_foldAngle).toContain(-45)
    return b
  }
  const fixtures: [string, () => Frame][] = [
    ['sheet', sheet],
    ['half folded', halfFolded],
    ['partial 90° + 45°', partial],
    ...BASE_NAMES.map(n => [n, () => baseFrame(n)] as [string, () => Frame]),
  ]

  test.each(fixtures)('edge lengths are preserved to 1e-9: %s', (_, make) => {
    const f = make()
    const ps = poses(f)
    f.faces_vertices.forEach((vs, face) => {
      vs.forEach((u, i) => {
        const v = vs[(i + 1) % vs.length]
        const [a, b] = [u, v].map(x => f.vertices_coords[x])
        const [p, q] = [a, b].map(x => applyPose(ps[face].matrix, x))
        const paper = Math.hypot(b[0] - a[0], b[1] - a[1])
        const space = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
        expect(Math.abs(space - paper)).toBeLessThan(1e-9)
      })
    })
  })

  test.each(fixtures)('adjacent faces agree on shared vertices (the paper stays connected): %s', (_, make) => {
    const f = make()
    const ps = poses(f)
    const at = new Map<number, number[]>()
    f.faces_vertices.forEach((vs, face) =>
      vs.forEach(v => {
        const p = applyPose(ps[face].matrix, f.vertices_coords[v])
        const seen = at.get(v)
        if (!seen) at.set(v, p)
        else seen.forEach((c, i) => expect(Math.abs(c - p[i])).toBeLessThan(1e-9))
      }),
    )
  })

  test.each(BASE_NAMES.map(n => [n, () => baseFrame(n)] as [string, () => Frame]).concat([['half folded', halfFolded]]))(
    'flat 180° poses agree with foldedCoords in x/y, at z = 0: %s',
    (_, make) => {
      const f = make()
      const folded = foldedCoords(f)
      for (const { face, matrix } of poses(f))
        for (const v of f.faces_vertices[face]) {
          const [x, y, z] = applyPose(matrix, f.vertices_coords[v])
          expect(Math.abs(x - folded[v][0])).toBeLessThan(1e-9)
          expect(Math.abs(y - folded[v][1])).toBeLessThan(1e-9)
          expect(Math.abs(z)).toBeLessThan(1e-9)
        }
    },
  )

  describe('swing', () => {
    test('positive angle lifts points LEFT of axis.vector toward +z (right-hand rule)', () => {
      const f = sheet()
      const axis = vertical(0.5) // vector +y: left is −x
      const left = world(f, 0, vertexAt(f, [0, 0]), { faces: [0], axis, angleDeg: 90 })
      const right = world(f, 0, vertexAt(f, [1, 0]), { faces: [0], axis, angleDeg: 90 })
      ;[0.5, 0, 0.5].forEach((c, i) => expect(close(left[i], c)).toBe(true))
      ;[0.5, 0, -0.5].forEach((c, i) => expect(close(right[i], c)).toBe(true))
    })

    test('reversing the axis vector reverses the swing', () => {
      const f = sheet()
      const p = world(f, 0, vertexAt(f, [0, 0]), {
        faces: [0],
        axis: { origin: [0.5, 1], vector: [0, -1] },
        angleDeg: 90,
      })
      expect(close(p[2], -0.5)).toBe(true)
    })

    test('only the listed faces move, on top of their tree pose', () => {
      const f = halfFolded()
      // face 1 (moved half) lies folded over x ∈ [0, 0.5]; swinging it back by 180° unfolds it
      const swing = { faces: [1], axis: vertical(0.5), angleDeg: 180 }
      const ps = poses(f, swing)
      const corner = vertexAt(f, [1, 0])
      const [x, y, z] = applyPose(ps[1].matrix, f.vertices_coords[corner])
      expect([close(x, 1), close(y, 0), close(z, 0)]).toEqual([true, true, true])
      expect(ps[0].matrix).toEqual(poses(f)[0].matrix)
    })

    test('swing by 0° is the tree pose', () => {
      const f = halfFolded()
      expect(poses(f, { faces: [0, 1], axis: vertical(0.2), angleDeg: 0 })).toEqual(poses(f))
    })
  })
})
