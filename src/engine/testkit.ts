// Test helpers shared by engine tests. Not a test file, so it must not import
// rabbit-ear: fixtures are built through the rabbit.ts adapter.
import { foldThrough, makeSheet } from './rabbit'
import type { Frame, Vec2 } from './types'

/** Total crease-pattern area: the sum of |shoelace| over faces. */
export function area(frame: Frame): number {
  return frame.faces_vertices.reduce((sum, vs) => {
    let a = 0
    vs.forEach((v, i) => {
      const [x0, y0] = frame.vertices_coords[v]
      const [x1, y1] = frame.vertices_coords[vs[(i + 1) % vs.length]]
      a += x0 * y1 - x1 * y0
    })
    return sum + Math.abs(a) / 2
  }, 0)
}

/** Width (x extent) of a set of points. */
export function footprintWidth(coords: readonly Vec2[]): number {
  const xs = coords.map(p => p[0])
  return Math.max(...xs) - Math.min(...xs)
}

/** A unit square valley-folded in half along x = 0.5 (right half over left). */
export function halfFolded(): Frame {
  const f = foldThrough(makeSheet({ width: 1, height: 1 }), { origin: [0.5, 0], vector: [0, 1] }, [0], 'valley', 180)
  if (!f) throw new Error('halfFolded fixture failed')
  return f
}
