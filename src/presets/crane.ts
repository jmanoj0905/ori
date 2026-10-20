// The crane, on a square.
//
// Preliminary base (the squash route):
//  1. Fold corner (0,1) onto (1,0): a triangle (valley).
//  2. Fold corner (0,0) onto (1,1), both layers: the right isosceles triangle
//     C = (½,½), P = (1,0), Q = (1,1), four layers.
//  3. Squash the top flap open: it presses into a square.
//  4. Turn over (mirrored about x = ¾).
//  5. Squash the other flap: the preliminary base, a square standing on its
//     open point (½,0) with the closed point at (1,½).
// Bird base:
//  6. Petal fold the front.
//  7. Turn over.
//  8. Petal fold the back: a long diamond, the petal tips at (½, √½) and the
//     legs' point T = (½ + √½, 0); the side corners are at (√½, √½ − ½) and
//     (1, ½).
// Narrow the legs (kite folds, front and back): each lower edge of the
// diamond is folded onto the axis T → petal tip (a crease from T 11.25° off
// the axis, which also takes the layers hidden under the petal with it):
//  9–10. Front: the left, then the right lower edge (valley).
// 11.    Turn over (mirrored about x = ½ + √½/2): T is now (½, 0) and the
//        axis runs up and to the right, along (√½, √½).
// 12–13. Back: the same two kite folds.
// Neck, tail and head (in a frame along the axis: origin T, "up" the axis):
// 14. Neck: the left leg (8 layers) folded up at 45° out from the axis,
//     along a crease through the axis 0.45 above T.
// 15. Tail: the right leg the same way, mirrored.
// 16. Head: the neck's last 0.1 folded down.
//
// Deviation from the classic diagram: neck, tail and head are inside
// reverse folds in the classic; here they are valley folds of the whole flap
// along the same crease. The engine's reverse fold refuses the crane's legs
// ("This flap can't reverse-fold: it isn't folded in half.", both on the bird
// base and once narrowed): it needs the flap's two halves joined along one
// spine line, and these 8-layer legs are pleated, joined along both the
// outer edge and the axis. A valley fold along the reverse fold's crease has
// the same folded outline; only the layering differs (the flap ends on top
// instead of between its halves). See the task report.
import type { Vec2 } from '@engine'
import { TURN_OVER, across, bring, gesture } from './gestures'
import type { Preset } from './types'

const S = Math.SQRT1_2

// ---- narrowing (steps 9–13) ----
const T: Vec2 = [0.5 + S, 0] // the legs' point, front view
const sideL: Vec2 = [S, S - 0.5]
const sideR: Vec2 = [1, 0.5]
const edge = Math.hypot(T[0] - sideL[0], T[1] - sideL[1]) // |T – side corner|
const up: Vec2 = [-S, S] // the axis, T → petal tip
const onAxis = (from: Vec2, axis: Vec2): Vec2 => [from[0] + axis[0] * edge, from[1] + axis[1] * edge]
// turned over: x → 2·(½ + √½/2) − x = 1 + √½ − x
const flipB = (p: Vec2): Vec2 => [1 + S - p[0], p[1]]
const T2 = flipB(T) // (½, 0)
const up2: Vec2 = [S, S]

// ---- neck, tail, head (steps 14–16): local frame, origin T2, y up the axis, x to the right ----
const local = (x: number, y: number): Vec2 => [T2[0] + x * S + y * S, T2[1] - x * S + y * S]
const neckAt = 0.45 // the crease crosses the axis this far above T
const out = Math.PI / 4 // the neck and tail swing 45° out from the axis
const neckTip = local(-neckAt * Math.sin(out), neckAt + neckAt * Math.cos(out))
const tailTip = local(neckAt * Math.sin(out), neckAt + neckAt * Math.cos(out))
const headLen = 0.1
const headBase: [number, number] = [-(neckAt - headLen) * Math.sin(out), neckAt + (neckAt - headLen) * Math.cos(out)]
const headTip = local(headBase[0] - headLen * S, headBase[1] - headLen * S) // the head points down and out
const headGrab = local(headBase[0] - (headLen - 0.02) * Math.sin(out), headBase[1] + (headLen - 0.02) * Math.cos(out))

export const crane: Preset = {
  id: 'crane',
  name: 'Crane',
  paper: 'square',
  steps: [
    // preliminary base
    gesture('fold', [0, 1], [1, 0], 1),
    gesture('fold', [0, 0], [1, 1], 2),
    gesture('squash', [0.9, 0.5], [0.6, 0.1], 1),
    TURN_OVER,
    gesture('squash', [0.6, 0.7], [0.9, 0.1], 1),
    // bird base
    gesture('petal', [0.55, 0.05], [1.1, 0.6], 1),
    TURN_OVER,
    gesture('petal', [0.45 + S, 0.05], [S - 0.1, 0.6], 1),
    // narrow the legs, front and back
    bring('fold', sideL, onAxis(T, up), 1),
    bring('fold', sideR, onAxis(T, up), 1),
    TURN_OVER,
    bring('fold', flipB(sideL), onAxis(T2, up2), 1),
    bring('fold', flipB(sideR), onAxis(T2, up2), 1),
    // neck and tail (the legs), then the head
    across('fold', local(-0.01, 0.1), T2, neckTip, 8),
    across('fold', local(0.01, 0.1), T2, tailTip, 8),
    across('fold', headGrab, neckTip, headTip, 8),
  ],
}
