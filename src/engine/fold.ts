// FOLD import: validate and normalise an untrusted FOLD object into a Frame.
// Pure TypeScript (no rabbit-ear). Used by the .fold re-import test and by the
// designer's import (Plan 5).
import type { FaceOrder, Frame, Result, Vec2 } from './types'

const ASSIGNMENTS = new Set(['B', 'M', 'V', 'F', 'U', 'C', 'J'])
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isIdx = (x: unknown, n: number): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < n

/** The frame to read: the object itself if it carries geometry, else the first of its file_frames. */
function pickFrame(json: Record<string, unknown>): Record<string, unknown> | null {
  if (Array.isArray(json.vertices_coords)) return json
  const frames = json.file_frames
  if (Array.isArray(frames) && isObj(frames[0])) return frames[0]
  return json
}

function coords(raw: unknown): Result<{ v: Vec2[] }> {
  if (!Array.isArray(raw)) return fail('The FOLD data has no vertices_coords.')
  const v: Vec2[] = []
  for (const [i, p] of raw.entries()) {
    if (!Array.isArray(p) || (p.length !== 2 && p.length !== 3) || !p.every(isNum)) {
      return fail(`vertices_coords[${i}] is not a finite 2D point.`)
    }
    if (p.length === 3 && p[2] !== 0) return fail('Only flat (2D) crease patterns are supported.')
    v.push([p[0]!, p[1]!])
  }
  return { ok: true, v }
}

function faceOrdersOf(raw: unknown, faces: number): FaceOrder[] {
  if (!Array.isArray(raw)) return []
  const out: FaceOrder[] = []
  for (const o of raw) {
    if (!Array.isArray(o) || o.length !== 3 || !isIdx(o[0], faces) || !isIdx(o[1], faces) || o[0] === o[1] || (o[2] !== 1 && o[2] !== -1)) {
      return [] // an inconsistent order list is not trusted at all
    }
    out.push([o[0], o[1], o[2]])
  }
  return out
}

/**
 * Validate a FOLD object (or a FOLD file: its first frame is read when the top
 * level has no geometry) and return it as a Frame. Requires vertices_coords,
 * edges_vertices, edges_assignment and faces_vertices, consistent and finite;
 * a missing edges_foldAngle is filled from the assignments (V +180, M -180,
 * else 0). faceOrders are kept when every entry is valid, else dropped to [].
 * Adjacency arrays (faces_edges, …) are not carried over. Never mutates or
 * aliases the input.
 */
export function frameFromFold(json: unknown): Result<{ frame: Frame }> {
  if (!isObj(json)) return fail('That is not a FOLD object.')
  const src = pickFrame(json)
  if (!src) return fail('That is not a FOLD object.')

  const c = coords(src.vertices_coords)
  if (!c.ok) return c
  const n = c.v.length

  const ev = src.edges_vertices
  if (!Array.isArray(ev)) return fail('The FOLD data has no edges_vertices.')
  const edges: [number, number][] = []
  for (const [i, e] of ev.entries()) {
    if (!Array.isArray(e) || e.length !== 2 || !isIdx(e[0], n) || !isIdx(e[1], n) || e[0] === e[1]) {
      return fail(`edges_vertices[${i}] is not two distinct vertices.`)
    }
    edges.push([e[0], e[1]])
  }

  const asg = src.edges_assignment
  if (!Array.isArray(asg)) return fail('The FOLD data has no edges_assignment.')
  if (asg.length !== edges.length) return fail('edges_assignment does not match edges_vertices.')
  for (const [i, a] of asg.entries()) {
    if (typeof a !== 'string' || !ASSIGNMENTS.has(a)) return fail(`edges_assignment[${i}] is not a FOLD assignment.`)
  }
  const assignment = asg as string[]

  let angles: number[]
  if (src.edges_foldAngle === undefined) {
    angles = assignment.map(a => (a === 'V' ? 180 : a === 'M' ? -180 : 0))
  } else {
    const fa = src.edges_foldAngle
    if (!Array.isArray(fa) || fa.length !== edges.length || !fa.every(isNum)) {
      return fail('edges_foldAngle does not match edges_vertices.')
    }
    angles = [...fa]
  }

  const fv = src.faces_vertices
  if (!Array.isArray(fv)) return fail('The FOLD data has no faces_vertices.')
  const faces: number[][] = []
  for (const [i, f] of fv.entries()) {
    if (!Array.isArray(f) || f.length < 3 || !f.every(v => isIdx(v, n))) {
      return fail(`faces_vertices[${i}] is not a polygon of known vertices.`)
    }
    faces.push([...(f as number[])])
  }

  const frame: Frame = {
    vertices_coords: c.v,
    edges_vertices: edges,
    edges_assignment: [...assignment],
    edges_foldAngle: angles,
    faces_vertices: faces,
    faceOrders: faceOrdersOf(src.faceOrders, faces.length),
  }
  return { ok: true, frame }
}
