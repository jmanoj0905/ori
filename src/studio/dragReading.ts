// Drag reading policy: per pointer move, does a drag on folded paper mean
// "swing the flap on its existing hinge" or "make a new fold"? Pure, with
// hysteresis so the reading does not flicker near the cone edges.
import { progressToAngle } from '@engine'
import type { HingeCandidate, Vec2 } from '@engine'

export type Reading = { mode: 'new' } | { mode: 'swing'; hinge: number }

export const SWING_ENTER = Math.cos(Math.PI / 6) // <= 30 degrees off the hinge normal
export const SWING_EXIT = Math.cos(Math.PI / 4) // stays a swing until > 45 degrees off
export const SWITCH_MARGIN = 0.15
export const SETTLE_OPEN_DEG = 10

const NEW: Reading = { mode: 'new' }

/** cos of the angle between the drag and the normal from grab toward the hinge (grab is left of line.vector). */
function score(h: HingeCandidate, dir: Vec2): number {
  const [vx, vy] = h.line.vector
  const len = Math.hypot(vx, vy)
  return (dir[0] * vy - dir[1] * vx) / len
}

export function readDrag(a: {
  grab: Vec2
  cursor: Vec2
  hinges: readonly HingeCandidate[]
  prev: Reading
  forceNew: boolean
  minDrag: number
}): Reading {
  if (a.forceNew) return NEW
  const dx = a.cursor[0] - a.grab[0]
  const dy = a.cursor[1] - a.grab[1]
  const d = Math.hypot(dx, dy)
  if (d < a.minDrag) return a.prev
  const dir: Vec2 = [dx / d, dy / d]
  const scores = a.hinges.map(h => score(h, dir))
  let best = -1
  scores.forEach((s, i) => {
    if (best < 0 || s > scores[best]!) best = i
  })
  if (best < 0) return NEW
  if (a.prev.mode === 'new') return scores[best]! >= SWING_ENTER ? { mode: 'swing', hinge: best } : NEW
  const cur = a.prev.hinge
  const sc = scores[cur]
  if (sc === undefined) return scores[best]! >= SWING_ENTER ? { mode: 'swing', hinge: best } : NEW
  if (best !== cur && scores[best]! - sc >= SWITCH_MARGIN) return { mode: 'swing', hinge: best }
  return sc >= SWING_EXIT ? a.prev : NEW
}

/** Release close to fully open settles open; otherwise progress is unchanged. */
export function settleOpen(progress: number, rangeDeg: number): number {
  return rangeDeg - progressToAngle(progress) <= SETTLE_OPEN_DEG ? 1 : progress
}
