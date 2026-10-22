// Crease-pattern geometry shared by the on-screen MiniCP and the SVG export.
// The unfolded sheet (a frame's paper-space vertices) is bounds-fitted, padded,
// and y-flipped so "up" on the sheet is up in the SVG. The bounds come from the
// vertices themselves, so a re-rooted or mirrored frame still fits.
import type { Frame } from '@engine'

/** Yoshizawa–Randlett dash patterns (the same as render/creases DASH). */
export const DASH = { valley: '6 4', mountain: '6 3 1.5 3' } as const

export type CpKind = 'boundary' | 'valley' | 'mountain'
export type CpSegment = { kind: CpKind; x1: number; y1: number; x2: number; y2: number }
export type CpLayout = {
  /** Total drawing size, padding included. */
  width: number
  height: number
  /** The paper's own box inside the drawing. */
  paper: { x: number; y: number; width: number; height: number }
  segments: CpSegment[]
}

const PAD = 0.04
const KIND: Record<string, CpKind | undefined> = { B: 'boundary', V: 'valley', M: 'mountain' }

/**
 * Lay the frame's crease pattern out. `scale` multiplies paper units (1 keeps
 * them; the SVG export scales so dashes have a sensible size). Flat (F),
 * unassigned and other creases are not drawn.
 */
export function creasePatternLayout(frame: Frame, scale = 1): CpLayout {
  const v = frame.vertices_coords ?? []
  const e = frame.edges_vertices ?? []
  const a = frame.edges_assignment ?? []
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of v) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0])
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1])
  }
  if (!v.length) { x0 = y0 = 0; x1 = y1 = 1 }
  const w = (x1 - x0 || 1) * scale
  const h = (y1 - y0 || 1) * scale
  const pad = Math.max(w, h) * PAD
  const X = (x: number) => (x - x0) * scale + pad
  const Y = (y: number) => (y1 - y) * scale + pad
  const segments: CpSegment[] = []
  e.forEach(([i, j], k) => {
    const p = v[i]
    const q = v[j]
    const kind = KIND[a[k] ?? '']
    if (!p || !q || !kind) return
    segments.push({ kind, x1: X(p[0]), y1: Y(p[1]), x2: X(q[0]), y2: Y(q[1]) })
  })
  return { width: w + 2 * pad, height: h + 2 * pad, paper: { x: pad, y: pad, width: w, height: h }, segments }
}
