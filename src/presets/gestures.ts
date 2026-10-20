// Small builders for preset gestures. Every builder returns a plain engine
// Gesture (flat: progress 1, no angle snap); the arithmetic only chooses its
// grab and target points, so each step is exactly what a user's drag from
// `grab` to `target` would produce.
import type { FoldKind, Gesture, Tool, Vec2 } from '@engine'
import type { TurnOverStep } from './types'

export const TURN_OVER: TurnOverStep = Object.freeze({ tool: 'turnOver' }) as TurnOverStep

export const gesture = (tool: Tool, grab: Vec2, target: Vec2, layers: number, kind: FoldKind = 'valley'): Gesture => ({
  tool,
  grab,
  target,
  layers,
  kind,
  progress: 1,
  snapAngle: false,
})

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/**
 * Bring paper point `from` onto `to` (the crease is their perpendicular
 * bisector): the drag runs along from→to, starting just inside the paper at
 * `from` and ending the same distance short of `to` (its mirror image).
 */
export const bring = (tool: Tool, from: Vec2, to: Vec2, layers: number, kind: FoldKind = 'valley'): Gesture =>
  gesture(tool, lerp(from, to, 0.05), lerp(from, to, 0.95), layers, kind)

/** Mirror `p` across the line through `origin` along `dir`. */
export function mirror(p: Vec2, origin: Vec2, dir: Vec2): Vec2 {
  const l = Math.hypot(dir[0], dir[1])
  const n: Vec2 = [-dir[1] / l, dir[0] / l]
  const d = (p[0] - origin[0]) * n[0] + (p[1] - origin[1]) * n[1]
  return [p[0] - 2 * d * n[0], p[1] - 2 * d * n[1]]
}

/** Grab at `grab` and fold along the line through `origin` along `dir`: the target is grab's mirror image. */
export const along = (tool: Tool, grab: Vec2, origin: Vec2, dir: Vec2, layers: number, kind: FoldKind = 'valley'): Gesture =>
  gesture(tool, grab, mirror(grab, origin, dir), layers, kind)

/** Grab at `grab` and fold along the crease that brings `from` onto `to`. */
export function across(tool: Tool, grab: Vec2, from: Vec2, to: Vec2, layers: number, kind: FoldKind = 'valley'): Gesture {
  const mid: Vec2 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
  const dir: Vec2 = [-(to[1] - from[1]), to[0] - from[0]]
  return along(tool, grab, mid, dir, layers, kind)
}
