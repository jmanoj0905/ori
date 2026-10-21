/*
 * Rabbit Ear adapter — the ONLY engine module allowed to import `rabbit-ear`.
 *
 * Confirmed namespace paths in rabbit-ear 0.9.41 (spike in rabbit.test.ts):
 *   ear.graph.rectangle(w, h), ear.graph.square(s)        sheet constructors
 *   ear.graph.simpleFoldLine(g, line, { assignment, foldAngle, vertices_coordsFolded })
 *   ear.graph.foldGraph(g, line, domain, { … })            (simpleFoldLine's core)
 *   ear.graph.foldGraphIntoSubgraph(cp, folded, line, …)
 *   ear.graph.reverseFold, ear.graph.simpleSquashFold     STUBS in 0.9.41: they
 *       console.warn("DO NOT USE. This method is in progress...") and return {}.
 *       `reverse`/`squash` are therefore INTENTIONALLY ABSENT from this
 *       adapter (controller ruling, Option B): Task 8 composes reverse,
 *       squash and petal from `foldThrough` on face subsets.
 *   ear.layer(graph)                                      layer solver; graph must
 *       carry FOLDED vertices_coords; returns { faceOrders(), count(), … }
 *   ear.graph.makeVerticesCoordsFolded(g, rootFaces)      2D if all angles are
 *       0/±180, else 3D
 *   ear.graph.makeFacesWinding(g)
 *   ear.graph.populate(g)                                 rebuild adjacency
 *   ear.graph.{blintz,waterbomb,kite,fish,bird,frog,windmill,squareFish}()
 *       crease-pattern bases on the unit square (no faceOrders; we solve them)
 * Everything is under `ear.graph.*` except the solver at `ear.layer`.
 *
 * Folded space: always computed with root face 0 fixed (as RE does for the
 * flat-folded sheet). `line` arguments are in folded space. For a non-flat
 * frame the 3D folded form is projected to z = 0, so `foldThrough` /
 * `foldedCoords` are only meaningful for faces still lying in the plane.
 * The side of the crease away from face 0 is the one that moves.
 *
 * Face-subset approach (foldThrough): `foldGraphIntoSubgraph` can't restrict a
 * fold to a set of faces (it splits every face under the line and only returns
 * segments), so we run `simpleFoldLine` on a clone of the whole graph with an
 * explicit root-face-0 folded form, then, for every new/reassigned crease
 * whose adjacent faces don't descend from the requested `faces`:
 *   - new creases are dissolved again (the two halves are merged back into one
 *     face, keeping the lower face index), and degree-2 vertices left behind on
 *     a straight run of edges are removed;
 *   - collinear creases RE re-assigned are restored to their old values.
 * Face orders for kept flat creases follow RE's simple-fold rule (V → +1,
 * M → −1); inherited orders between a re-joined face and the split halves of
 * moving faces are dropped. A flat result is then re-solved with `ear.layer` (falling back to
 * the propagated orders if the solver rejects it — the caller re-solves and
 * refuses). Non-flat results keep the propagated (last solved) orders (R2).
 * `opts.solve: false` skips that solve even for a flat result (ops.ts uses it
 * for the 0° "edited" preview frame, and solves flat commits itself once).
 */
import ear from 'rabbit-ear'
import type { FOLD, FoldKind, Frame, Line, PaperSize, Vec2 } from './types'

// ---- the untyped surface of rabbit-ear we use, contained here ----
type REGraph = Record<string, unknown> & {
  vertices_coords: number[][]
  edges_vertices: [number, number][]
  edges_assignment: string[]
  edges_foldAngle: number[]
  faces_vertices: number[][]
  edges_faces?: (number | null | undefined)[][]
  faceOrders?: [number, number, number][]
}
type FoldEvent = {
  edges: { map: number[][]; new: number[]; reassigned: number[] }
  faces: { map: number[][] }
}
type RE = {
  graph: {
    rectangle(w: number, h: number): REGraph
    simpleFoldLine(
      g: REGraph,
      line: { origin: number[]; vector: number[] },
      opts: { assignment: string; foldAngle: number; vertices_coordsFolded: number[][] },
    ): FoldEvent
    makeVerticesCoordsFolded(g: REGraph, roots: number[]): number[][]
    makeFacesWinding(g: { vertices_coords: number[][]; faces_vertices: number[][] }): boolean[]
    populate(g: REGraph): REGraph
  } & Record<BaseName, () => REGraph>
  layer(g: REGraph): SolverNode
}
/**
 * Rabbit Ear's layer-solver result tree (module/layer/solver.js, solve.js):
 * `orders` hold at this node; `branches` are independent groups (AND), each a
 * list of alternative choices (OR) — 0, 1 or 2 of them, each itself a node.
 * A group with no choices is a dead end.
 */
type SolverNode = {
  orders: [number, number, number][]
  branches?: SolverNode[][]
}
const re = ear as unknown as RE

export const BASE_NAMES = [
  'blintz',
  'waterbomb',
  'kite',
  'fish',
  'bird',
  'frog',
  'windmill',
  'squareFish',
] as const
export type BaseName = (typeof BASE_NAMES)[number]

const EPS = 1e-6
const DERIVED = [
  'vertices_vertices',
  'vertices_edges',
  'vertices_faces',
  'edges_faces',
  'faces_edges',
  'faces_faces',
] as const

const clone = (f: Frame | REGraph): REGraph => structuredClone(f) as unknown as REGraph
const isFlatAngle = (a: number) => Math.abs(a) < EPS || Math.abs(Math.abs(a) - 180) < EPS
const allFlat = (g: { edges_foldAngle: readonly number[] }) => g.edges_foldAngle.every(isFlatAngle)

/** Rebuild adjacency from vertices_coords / edges_vertices / faces_vertices. */
function repopulate(g: REGraph): REGraph {
  for (const k of DERIVED) delete g[k]
  re.graph.populate(g)
  if (!g.faceOrders) g.faceOrders = []
  return g
}

function toFrame(g: REGraph): Frame {
  if (!g.faceOrders) g.faceOrders = []
  return g as unknown as FOLD
}

function folded2D(g: REGraph): number[][] {
  return re.graph.makeVerticesCoordsFolded(g, [0]).map(p => [p[0], p[1]])
}

/**
 * One complete layer order from the solver tree, or null if none exists:
 * depth-first, the first choice of each group that itself completes.
 * Rabbit Ear's own `faceOrders()` always takes choice 0 and throws when that
 * choice dead-ends further down, even though a sibling choice completes (seen
 * on the paper plane's frames 6 and 8 with their orders cleared). Groups are
 * independent, so any completing choice per group combines into a valid
 * order. Where choice 0 completes everywhere this is exactly `faceOrders()`.
 */
export function firstSolution(node: SolverNode): [number, number, number][] | null {
  const out: [number, number, number][][] = [node.orders]
  for (const group of node.branches ?? []) {
    let found: [number, number, number][] | null = null
    for (const choice of group) if ((found = firstSolution(choice))) break
    if (!found) return null
    out.push(found)
  }
  return out.flat()
}

function solveOrders(g: REGraph): [number, number, number][] | null {
  if (!allFlat(g)) return null
  let tree: SolverNode
  try {
    tree = re.layer({ ...g, vertices_coords: folded2D(g) })
  } catch {
    return null // the solver itself found no order
  }
  return firstSolution(tree)
}

const quiet = <T>(fn: () => T): T => {
  const warn = console.warn
  console.warn = () => {}
  try {
    return fn()
  } finally {
    console.warn = warn
  }
}

// ---- public adapter ----

export function makeSheet(size: PaperSize): Frame {
  const g = re.graph.rectangle(size.width, size.height)
  g.faceOrders = []
  return toFrame(g)
}

export function baseFrame(name: BaseName): Frame {
  const g = repopulate(re.graph[name]())
  const orders = solveOrders(g)
  if (!orders) throw new Error(`Rabbit Ear base "${name}" has no layer order`)
  g.faceOrders = orders
  return toFrame(g)
}

export function foldedCoords(frame: Frame): Vec2[] {
  return re.graph
    .makeVerticesCoordsFolded(clone(frame), [0])
    .map(p => [p[0], p[1]] as Vec2)
}

export function windings(frame: Frame): boolean[] {
  return re.graph.makeFacesWinding({
    vertices_coords: foldedCoords(frame).map(p => [p[0], p[1]]),
    faces_vertices: frame.faces_vertices,
  })
}

/** A full layer solve of a flat frame; null if non-flat or unsolvable. */
export function layerOrders(frame: Frame): [number, number, number][] | null {
  return solveOrders(clone(frame))
}

export function foldThrough(
  frame: Frame,
  line: Line,
  faces: number[],
  kind: FoldKind,
  angleDeg: number,
  opts: { solve?: boolean } = {},
): Frame | null {
  const assignment = kind === 'valley' ? 'V' : 'M'
  const foldAngle = kind === 'valley' ? angleDeg : -angleDeg
  const faceCount = frame.faces_vertices.length
  const subset = new Set(faces.filter(f => Number.isInteger(f) && f >= 0 && f < faceCount))
  if (subset.size === 0) return null

  const before = clone(frame)
  const g = clone(frame)
  if (!g.faceOrders) g.faceOrders = []
  let ev: FoldEvent
  try {
    ev = quiet(() =>
      re.graph.simpleFoldLine(
        g,
        { origin: [...line.origin], vector: [...line.vector] },
        { assignment, foldAngle, vertices_coordsFolded: folded2D(g) },
      ),
    )
  } catch {
    return null
  }
  if (!ev?.edges) return null

  // For a flat fold RE appended one simple order per new/reassigned V/M edge
  // with two faces (after pruning invalidated prior orders); strip those and
  // recompute them below for the kept creases only.
  const flatFold = Math.abs(Math.abs(foldAngle) - 180) < EPS
  const twoFacedVM = (e: number) =>
    (g.edges_faces?.[e] ?? []).length === 2 && /^[VMvm]$/.test(g.edges_assignment[e])
  if (flatFold) {
    const appended = [...ev.edges.new, ...ev.edges.reassigned].filter(twoFacedVM).length
    g.faceOrders = g.faceOrders.slice(0, g.faceOrders.length - appended)
  }

  const inSubset = new Set<number>()
  ev.faces.map.forEach((news, old) => {
    if (subset.has(old)) for (const f of [news].flat()) inSubset.add(f)
  })
  const touchesSubset = (e: number) =>
    (g.edges_faces?.[e] ?? []).some(f => f != null && inSubset.has(f))

  const oldOf: number[] = []
  ev.edges.map.forEach((news, old) => {
    for (const e of [news].flat()) oldOf[e] = old
  })
  const kept: number[] = []
  for (const e of ev.edges.reassigned) {
    if (touchesSubset(e)) kept.push(e)
    else {
      g.edges_assignment[e] = before.edges_assignment[oldOf[e]]
      g.edges_foldAngle[e] = before.edges_foldAngle[oldOf[e]]
    }
  }
  const dissolve: number[] = []
  for (const e of ev.edges.new) (touchesSubset(e) ? kept : dissolve).push(e)
  if (kept.length === 0) return null

  // simple-fold orders for kept flat creases (RE's rule: V → +1, M → −1)
  if (flatFold) {
    for (const e of kept) {
      const fs = (g.edges_faces?.[e] ?? []).filter((f): f is number => f != null)
      const a = g.edges_assignment[e]
      if (fs.length === 2 && (a === 'V' || a === 'M')) g.faceOrders.push([fs[0], fs[1], a === 'V' ? 1 : -1])
    }
  }

  // A dissolved split re-joins a non-moving face that now straddles the
  // crease; its halves' inherited orders against the split halves of moving
  // faces no longer hold, so drop them and let the solver decide.
  const splitMoving = new Set(
    ev.faces.map.filter((news, old) => subset.has(old) && [news].flat().length > 1).flat(),
  )
  const rejoined = new Set(dissolve.flatMap(e => (g.edges_faces?.[e] ?? []).filter(f => f != null)))
  g.faceOrders = g.faceOrders.filter(
    ([a, b]) => !((rejoined.has(a) && splitMoving.has(b)) || (rejoined.has(b) && splitMoving.has(a))),
  )

  const firstNewVertex = before.vertices_coords.length
  dissolveEdges(g, dissolve)
  removeStraightVertices(g, firstNewVertex)
  repopulate(g)

  if (opts.solve !== false && allFlat(g)) g.faceOrders = solveOrders(g) ?? g.faceOrders
  return toFrame(g)
}

/**
 * A copy of `frame` with its adjacency arrays (vertices_vertices, edges_faces,
 * faces_edges, …) rebuilt from vertices_coords / edges_vertices /
 * faces_vertices. Use after renumbering faces or vertices.
 */
export function rebuildAdjacency(frame: Frame): Frame {
  return toFrame(repopulate(clone(frame)))
}

// ---- topology helpers for the face-subset path ----

/** Remove `edges`, merging the two faces each one separates. */
function dissolveEdges(g: REGraph, edges: number[]) {
  // process highest index first so lower edge ids stay valid
  for (const e of [...edges].sort((a, b) => b - a)) {
    const [u, v] = g.edges_vertices[e]
    const owners = g.faces_vertices
      .map((vs, f) => (hasSide(vs, u, v) ? f : -1))
      .filter(f => f >= 0)
    removeEdge(g, e)
    if (owners.length !== 2) continue
    const [keep, drop] = owners
    g.faces_vertices[keep] = mergeFaces(g.faces_vertices[keep], g.faces_vertices[drop], u, v)
    removeFace(g, drop, keep)
  }
}

function hasSide(vs: number[], u: number, v: number) {
  return vs.some((x, i) => {
    const y = vs[(i + 1) % vs.length]
    return (x === u && y === v) || (x === v && y === u)
  })
}

const rotate = (vs: number[], start: number) => {
  const i = vs.indexOf(start)
  return [...vs.slice(i), ...vs.slice(0, i)]
}

/**
 * Merge two faces across their shared side {u, v}, preserving orientation:
 * if `a` runs x → y along the side, `b` runs y → x.
 */
function mergeFaces(a: number[], b: number[], u: number, v: number): number[] {
  const i = a.findIndex((p, k) => {
    const q = a[(k + 1) % a.length]
    return (p === u && q === v) || (p === v && q === u)
  })
  const x = a[i]
  const y = a[(i + 1) % a.length]
  const pa = rotate(a, y) // y … x
  const pb = rotate(b, x) // x … y
  return [...pa, ...pb.slice(1, -1)]
}

function removeEdge(g: REGraph, e: number) {
  g.edges_vertices.splice(e, 1)
  g.edges_assignment.splice(e, 1)
  g.edges_foldAngle.splice(e, 1)
}

function removeFace(g: REGraph, drop: number, into: number) {
  g.faces_vertices.splice(drop, 1)
  const map = (f: number) => {
    const t = f === drop ? into : f
    return t > drop ? t - 1 : t
  }
  const seen = new Set<string>()
  g.faceOrders = (g.faceOrders ?? [])
    .map(([a, b, s]) => [map(a), map(b), s] as [number, number, number])
    .filter(([a, b]) => {
      const k = `${Math.min(a, b)} ${Math.max(a, b)}`
      if (a === b || seen.has(k)) return false
      seen.add(k)
      return true
    })
}

/**
 * Remove vertices (index ≥ `from`) of degree 2 whose two edges are collinear
 * and share an assignment: leftovers of a dissolved split.
 */
function removeStraightVertices(g: REGraph, from: number) {
  for (let v = g.vertices_coords.length - 1; v >= from; v--) {
    const es = g.edges_vertices.map((ev, e) => (ev.includes(v) ? e : -1)).filter(e => e >= 0)
    if (es.length !== 2) continue
    const [e0, e1] = es
    if (g.edges_assignment[e0] !== g.edges_assignment[e1]) continue
    if (Math.abs(g.edges_foldAngle[e0] - g.edges_foldAngle[e1]) > EPS) continue
    const a = g.edges_vertices[e0].find(x => x !== v)!
    const b = g.edges_vertices[e1].find(x => x !== v)!
    const [pa, pv, pb] = [a, v, b].map(i => g.vertices_coords[i])
    const cross = (pv[0] - pa[0]) * (pb[1] - pa[1]) - (pv[1] - pa[1]) * (pb[0] - pa[0])
    if (Math.abs(cross) > EPS) continue
    g.edges_vertices[e0] = [a, b]
    removeEdge(g, e1)
    g.faces_vertices = g.faces_vertices.map(vs => vs.filter(x => x !== v))
    removeVertex(g, v)
  }
}

function removeVertex(g: REGraph, v: number) {
  g.vertices_coords.splice(v, 1)
  const map = (x: number) => (x > v ? x - 1 : x)
  g.edges_vertices = g.edges_vertices.map(([a, b]) => [map(a), map(b)])
  g.faces_vertices = g.faces_vertices.map(vs => vs.map(map))
}
