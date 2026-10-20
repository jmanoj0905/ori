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

/** The unit square's corners, counter-clockwise from the origin. */
export const unitSquare: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]]

/**
 * A unit square accordion-folded (alternating V/M ±180°) into `n` vertical
 * strips: a fully stacked flat model of `n` faces, built directly (no layer
 * solve, so it is cheap at any size). Face i is strip [i/n, (i+1)/n]; face 0
 * is the root. faceOrders are the per-crease simple orders (V → +1, M → −1),
 * which with transitivity give the stack n−1 (top) … 0 (bottom).
 */
export function accordion(n: number): Frame {
  const vertices_coords: Vec2[] = []
  const edges_vertices: [number, number][] = []
  const edges_assignment: string[] = []
  const edges_foldAngle: number[] = []
  const faces_vertices: number[][] = []
  const faceOrders: [number, number, number][] = []
  for (let i = 0; i <= n; i++) vertices_coords.push([i / n, 0], [i / n, 1])
  for (let i = 0; i < n; i++) {
    edges_vertices.push([2 * i, 2 * i + 2], [2 * i + 1, 2 * i + 3])
    edges_assignment.push('B', 'B')
    edges_foldAngle.push(0, 0)
    faces_vertices.push([2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1])
  }
  for (let i = 0; i <= n; i++) {
    edges_vertices.push([2 * i, 2 * i + 1])
    const boundary = i === 0 || i === n
    const valley = i % 2 === 1
    edges_assignment.push(boundary ? 'B' : valley ? 'V' : 'M')
    edges_foldAngle.push(boundary ? 0 : valley ? 180 : -180)
    if (!boundary) faceOrders.push([i - 1, i, valley ? 1 : -1])
  }
  return { vertices_coords, edges_vertices, edges_assignment, edges_foldAngle, faces_vertices, faceOrders }
}
