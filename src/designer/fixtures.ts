// Classic crease patterns for the designer's tests (spec 07 Tests): the
// waterbomb and bird bases, as Rabbit Ear 0.9.41 defines them ('F' creases
// are flat: they stay unfolded).
import type { CP } from './cp'

const pattern = (vertices_coords: [number, number][], edges_vertices: [number, number][], edges_assignment: string[]): CP => ({
  vertices_coords,
  edges_vertices,
  edges_assignment,
  edges_foldAngle: edges_assignment.map(a => (a === 'V' ? 180 : a === 'M' ? -180 : 0)),
  faces_vertices: [],
  faceOrders: [],
})

export const waterbombBase = (): CP =>
  pattern(
    [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5], [0.5, 0.5]],
    [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0], [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8]],
    ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'V', 'F', 'V', 'M', 'V', 'F', 'V', 'M'],
  )

const S = 0.20710678118654757
const T = 0.7928932188134524
export const birdBase = (): CP =>
  pattern(
    [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5], [0.5, 0.5], [0.5, S], [T, 0.5], [0.5, T], [S, 0.5],
      [0.3535533905932738, 0.3535533905932738], [0.6464466094067263, 0.6464466094067263]],
    [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0], [0, 9], [9, 2], [2, 10], [10, 4], [4, 11], [11, 6], [6, 12], [12, 0],
      [1, 9], [9, 8], [3, 10], [10, 8], [5, 11], [11, 8], [7, 12], [12, 8], [2, 8], [6, 8], [0, 13], [13, 8], [13, 9], [13, 12], [4, 14], [14, 8], [14, 10], [14, 11]],
    ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'V', 'V', 'V', 'V', 'V', 'V', 'V', 'V', 'M', 'V', 'M', 'V', 'M', 'V', 'M', 'V', 'M', 'M',
      'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F'],
  )
