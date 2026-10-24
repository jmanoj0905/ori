// Crease-pattern file formats for the designer (spec 07 "Import and export";
// Plan 5 Task 4). Pure TypeScript: these read files into line segments and
// write crease patterns out; the designer builds its pattern from the
// segments (designer/cp.ts buildCp). Rabbit Ear 0.9.41's `convert` module has
// no .cp reader or writer (it converts .opx, .obj and SVG), so .cp is handled
// here.
//
// .cp (ORIPA / Oriedita): one line per segment, `type x1 y1 x2 y2`, with
// type 1 cut / boundary, 2 mountain, 3 valley; anything else (0 or 4: aux /
// unassigned) imports as unassigned ('U'). Written in ORIPA's convention: a
// 400-unit sheet centred on the origin, y down. Unassigned and flat ('F')
// creases are written as type 4 and read back as unassigned.
//
// .fold: the FOLD file's frame (its top level, or its first file_frame) via
// frameFromFold; 'F', 'U' and other non-M/V creases import as unassigned.
import { frameFromFold, type Result, type Vec2 } from '@engine'

/** Larger files are refused before parsing (a hostile or accidental drop must not hang the tab). */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024

export type CpSegment = { a: Vec2; b: Vec2; assignment: 'B' | 'M' | 'V' | 'U' }
export type CpGeometry = {
  vertices_coords: readonly Vec2[]
  edges_vertices: readonly (readonly [number, number])[]
  edges_assignment: readonly string[]
}

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })
const TYPE_IN: Record<string, CpSegment['assignment']> = { '1': 'B', '2': 'M', '3': 'V' }
const TYPE_OUT: Record<string, number> = { B: 1, M: 2, V: 3 }

const asAssignment = (a: string): CpSegment['assignment'] => (a === 'B' || a === 'M' || a === 'V' ? a : 'U')

/** Parse a .cp file into segments. */
export function parseCp(text: string): Result<{ segments: CpSegment[] }> {
  if (text.length > MAX_IMPORT_BYTES) return fail('That file is too large to import.')
  const segments: CpSegment[] = []
  const lines = text.split(/\r?\n/)
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim()
    if (line === '') continue
    const f = line.split(/\s+/)
    const n = f.slice(1).map(Number)
    if (f.length !== 5 || !/^\d+$/.test(f[0]!) || !n.every(Number.isFinite)) return fail(`Line ${i + 1} of the .cp file is not "type x1 y1 x2 y2".`)
    // ORIPA's y axis points down: flip it so "up" stays up
    segments.push({ a: [n[0]!, -n[1]!], b: [n[2]!, -n[3]!], assignment: TYPE_IN[f[0]!] ?? 'U' })
  }
  if (segments.length === 0) return fail('The .cp file has no lines.')
  return { ok: true, segments }
}

/** A FOLD file (JSON text) → segments, every edge with its assignment. */
export function parseFold(text: string): Result<{ segments: CpSegment[] }> {
  if (text.length > MAX_IMPORT_BYTES) return fail('That file is too large to import.')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return fail('That .fold file is not valid JSON.')
  }
  // a crease pattern needs no faces: tolerate files that leave them out
  const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
  const src = obj(json) && !Array.isArray(json.vertices_coords) && Array.isArray(json.file_frames) ? json.file_frames[0] : json
  const f = frameFromFold(obj(src) ? { faces_vertices: [], ...src } : src)
  if (!f.ok) return f
  const { vertices_coords: v, edges_vertices: e, edges_assignment: a } = f.frame
  return { ok: true, segments: e.map(([i, j], k) => ({ a: v[i]!, b: v[j]!, assignment: asAssignment(a[k]!) })) }
}

const bounds = (v: readonly Vec2[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of v) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  return { x0, y0, x1, y1 }
}

/** The pattern as a .cp file (ORIPA convention: 400 units wide, centred, y down). */
export function toCp(cp: CpGeometry): string {
  const { x0, y0, x1, y1 } = bounds(cp.vertices_coords)
  const k = 400 / Math.max(x1 - x0, y1 - y0 || 1)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const X = (x: number) => +((x - cx) * k).toPrecision(15)
  const Y = (y: number) => +(-(y - cy) * k).toPrecision(15) || 0
  return cp.edges_vertices
    .map(([i, j], e) => {
      const p = cp.vertices_coords[i]!
      const q = cp.vertices_coords[j]!
      return `${TYPE_OUT[cp.edges_assignment[e]!] ?? 4} ${X(p[0])} ${Y(p[1])} ${X(q[0])} ${Y(q[1])}`
    })
    .join('\n') + '\n'
}

/** The pattern as a single-frame FOLD file (a crease pattern: unfolded coordinates). */
export function toFold(cp: CpGeometry & { faces_vertices?: readonly (readonly number[])[] }): string {
  return JSON.stringify({
    file_spec: 1.2,
    file_creator: 'Ori',
    file_classes: ['singleModel'],
    frame_title: 'Crease pattern',
    frame_classes: ['creasePattern'],
    vertices_coords: cp.vertices_coords,
    edges_vertices: cp.edges_vertices,
    edges_assignment: cp.edges_assignment,
    edges_foldAngle: cp.edges_assignment.map(a => (a === 'V' ? 180 : a === 'M' ? -180 : 0)),
    faces_vertices: cp.faces_vertices ?? [],
  })
}
