// Drag-specific mappings: crease from a drag, angle snap, progress → angle.
import { add, angleDeg, length, scale, sub } from './geometry'
import type { Line, Vec2 } from './types'

/** Perpendicular bisector of grab→target; null for a (near) zero-length drag. */
export function creaseFromDrag(grab: Vec2, target: Vec2): Line | null {
  const d = sub(target, grab)
  if (length(d) < 1e-4) return null
  return { origin: scale(add(grab, target), 0.5), vector: [-d[1], d[0]] }
}

/**
 * Rotate the crease about `pivot` to the nearest multiple of `stepDeg`.
 * Direction is taken modulo 180° (a crease has no orientation). The result
 * passes through `pivot` and keeps the original vector length.
 */
export function snapAngle(line: Line, pivot: Vec2, stepDeg = 22.5): Line {
  const snapped = Math.round(angleDeg(line.vector) / stepDeg) * stepDeg
  const rad = (snapped * Math.PI) / 180
  const len = length(line.vector)
  return { origin: pivot, vector: [Math.cos(rad) * len, Math.sin(rad) * len] }
}

/** Drag progress [0,1] → fold angle [0,180] degrees, ease-out. */
export function progressToAngle(progress: number): number {
  if (progress >= 1) return 180
  const p = Math.max(0, progress)
  return 180 * (1 - (1 - p) ** 2)
}
