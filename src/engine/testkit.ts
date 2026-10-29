// Test helpers shared by engine tests. Not a test file, so it must not import
// rabbit-ear: fixtures are built through the rabbit.ts adapter.
import { hingesAt } from './hinges'
import { commit, type Gesture } from './ops'
import { baseFrame, foldThrough, layerOrders, makeSheet, rebuildAdjacency } from './rabbit'
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

/** A Rabbit Ear base (crease pattern on the unit square, layer order solved), via the adapter (R1). */
export function base(name: 'waterbomb' | 'kite' | 'bird'): Frame {
  return baseFrame(name)
}

/**
 * A unit square folded on its diagonal and then in half again, through the
 * public `commit`: corner [0,1] onto [1,0] (crease y = x), then both layers,
 * corner [0,0] onto [1,1] (crease x + y = 1). The result is the right
 * isosceles triangle C = [0.5,0.5] (right angle), P = [1,0], Q = [1,1], four
 * layers everywhere: two halves of two layers each, joined along the second
 * crease C–P (the spine), each half folded along C–Q, open along P–Q.
 * Faces: 0 = paper triangle [1,0],[1,1],C (bottom layer); the top layer is
 * paper [0,0],[1,0],C.
 */
export function doubleTriangle(): Frame {
  const g = (grab: Vec2, target: Vec2, layers: number) =>
    ({ tool: 'fold', grab, target, layers, kind: 'valley', progress: 1, snapAngle: false }) as const
  const one = commit(makeSheet({ width: 1, height: 1 }), g([0, 1], [1, 0], 1))
  if (!one.ok) throw new Error(`doubleTriangle fixture: ${one.reason}`)
  const two = commit(one.frame, g([0, 0], [1, 1], 2))
  if (!two.ok) throw new Error(`doubleTriangle fixture: ${two.reason}`)
  return two.frame
}

/**
 * The preliminary base (R4: Rabbit Ear 0.9.41 has none, so it is built here
 * as a crease pattern and its layer order solved by the adapter). Midlines
 * mountain, the diagonal [1,0]–[0,1] valley, the diagonal [0,0]–[1,1] flat:
 * the bottom-left quadrant (faces 0 and 7) is the front panel and stays put,
 * so the base is the square [0,0.5]² with the closed point C = [0.5,0.5]
 * (the paper centre), the open point W = [0,0] (all four corners) and the
 * axis y = x. At [0.3,0.1] the stack is faces 0, 1, 2, 3 (top to bottom).
 */
export function preliminary(): Frame {
  const vertices_coords: Vec2[] = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5], [0.5, 0.5]]
  const edges_vertices: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0],
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8],
  ]
  const edges_assignment = ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'F', 'M', 'V', 'M', 'F', 'M', 'V', 'M']
  const edges_foldAngle = edges_assignment.map(a => (a === 'V' ? 180 : a === 'M' ? -180 : 0))
  const faces_vertices = [[0, 1, 8], [1, 2, 8], [2, 3, 8], [3, 4, 8], [4, 5, 8], [5, 6, 8], [6, 7, 8], [7, 0, 8]]
  const f = rebuildAdjacency({ vertices_coords, edges_vertices, edges_assignment, edges_foldAngle, faces_vertices, faceOrders: [] })
  const orders = layerOrders(f)
  if (!orders) throw new Error('preliminary fixture has no layer order')
  return { ...f, faceOrders: orders }
}

/**
 * A flat unit square pre-creased into a `cols` × `rows` grid of square-ish
 * cells by flat ('F', 0°) creases: `cols · rows` faces, nothing folded. Face
 * c + r·cols is cell column c, row r; face 0 is the root at the origin.
 */
export function grid(cols: number, rows: number = cols): Frame {
  const vertices_coords: Vec2[] = []
  const id = (c: number, r: number) => r * (cols + 1) + c
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) vertices_coords.push([c / cols, r / rows])
  const edges_vertices: [number, number][] = []
  const edges_assignment: string[] = []
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c < cols; c++) {
      edges_vertices.push([id(c, r), id(c + 1, r)])
      edges_assignment.push(r === 0 || r === rows ? 'B' : 'F')
    }
  for (let c = 0; c <= cols; c++)
    for (let r = 0; r < rows; r++) {
      edges_vertices.push([id(c, r), id(c, r + 1)])
      edges_assignment.push(c === 0 || c === cols ? 'B' : 'F')
    }
  const faces_vertices: number[][] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) faces_vertices.push([id(c, r), id(c + 1, r), id(c + 1, r + 1), id(c, r + 1)])
  return rebuildAdjacency({
    vertices_coords,
    edges_vertices,
    edges_assignment,
    edges_foldAngle: edges_assignment.map(() => 0),
    faces_vertices,
    faceOrders: [],
  })
}

/**
 * halfFolded() swung open along its hinge: flat again, with an 'F' crease at x = 0.5.
 * Built as the gesture does: commit a fold on the hinge line with its openKind.
 */
export function openedHalf(): Frame {
  const f = halfFolded()
  const [h] = hingesAt(f, [0.1, 0.5], 1)
  const g: Gesture = {
    tool: 'fold', grab: [0.1, 0.5], target: [0.1, 0.5], layers: 1, kind: h.openKind,
    progress: 1, snapAngle: false, crease: h.line,
  }
  const r = commit(f, g)
  if (!r.ok) throw new Error(`openedHalf fixture refused: ${r.reason}`)
  return r.frame
}

/**
 * A square pre-creased with the waterbomb's four lines (both diagonals, both
 * midlines), each folded and swung back open: flat, with four 'F' creases.
 */
export function waterbombCreases(): Frame {
  let f = makeSheet({ width: 1, height: 1 })
  const lines: [Vec2, Vec2][] = [[[1, 1], [0, 0]], [[0, 1], [1, 0]], [[0.5, 1], [0.5, 0]], [[1, 0.5], [0, 0.5]]]
  for (const [from, to] of lines) {
    const g: Gesture = { tool: 'fold', grab: from, target: to, layers: 1, kind: 'valley', progress: 1, snapAngle: false }
    const folded = commit(f, g)
    if (!folded.ok) throw new Error(`waterbombCreases fold refused: ${folded.reason}`)
    const [h] = hingesAt(folded.frame, to, 1)
    const opened = commit(folded.frame, { ...g, grab: to, kind: h.openKind, crease: h.line })
    if (!opened.ok) throw new Error(`waterbombCreases swing refused: ${opened.reason}`)
    f = opened.frame
  }
  return f
}
