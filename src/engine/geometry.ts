// Pure 2D geometry helpers. No dependencies beyond types.
import type { Line, Vec2 } from './types'

const EPS = 1e-9

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k]
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1]
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0]
export const length = (a: Vec2): number => Math.hypot(a[0], a[1])

/** Reflect point `p` across the (infinite) line `l`. */
export function reflect(p: Vec2, l: Line): Vec2 {
  const len2 = dot(l.vector, l.vector)
  const d = sub(p, l.origin)
  const proj = scale(l.vector, dot(d, l.vector) / len2)
  const foot = add(l.origin, proj)
  return sub(scale(foot, 2), p)
}

/** Direction of a vector in degrees, in (-180, 180]. */
export function angleDeg(v: Vec2): number {
  return (Math.atan2(v[1], v[0]) * 180) / Math.PI
}

/**
 * Intersect an infinite line with a simple convex polygon. Returns the two
 * extreme intersection points, or null when the line misses or only touches
 * at a single point. Non-convex polygons are not handled (only the outermost
 * two crossings are returned).
 */
export function clipLineToPolygon(line: Line, poly: readonly Vec2[]): [Vec2, Vec2] | null {
  const ts: number[] = []
  const d = line.vector
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const e = sub(poly[(i + 1) % poly.length], a)
    const denom = cross(d, e)
    if (Math.abs(denom) < EPS) continue // parallel edge: neighbours supply its endpoints
    const w = sub(a, line.origin)
    const t = cross(w, e) / denom // along the line
    const s = cross(w, d) / denom // along the edge
    if (s >= -EPS && s <= 1 + EPS) ts.push(t)
  }
  if (ts.length < 2) return null
  const lo = Math.min(...ts)
  const hi = Math.max(...ts)
  if ((hi - lo) * length(d) < 1e-7) return null
  return [add(line.origin, scale(d, lo)), add(line.origin, scale(d, hi))]
}
