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
// Narrow the legs (kite folds). Work in a frame along the axis: origin T,
// "up" the axis toward the petal tips, x across it (the side corners are at
// x = ∓(√½ − ½), y = ½):
//  9–10. Fold each lower edge of the diamond onto the axis (a crease from T,
//        11.25° off the axis), grabbing the leg below the petal's hinge. A
//        leg's four layers are joined along that lower edge, so the fold
//        takes all of them: one kite fold narrows the whole leg, front and
//        back, to eight layers.
// Neck, tail and head (inside reverse folds):
// 11. Neck: inside reverse the left leg (8 layers) up and across the axis,
//     45° off it, along a crease through the axis 0.4 above T. The leg is
//     open along the axis side (its halves join along its outer edge), so
//     "inside" swings the point toward the axis, between the wing layers; it
//     comes out on the right.
// 12. Tail: the right leg the same way, mirrored (out on the left; it passes
//     the neck inside the body).
// 13. Head: inside reverse the neck's last 0.1 down and outward.
//
// Deviation from the classic diagram: the classic narrows the legs with four
// kite folds, two in front and two behind. Here each leg's front and back
// layers are joined along its lower edge, so a front kite fold cannot leave
// the back layers behind: it narrows the whole leg, and the "repeat behind"
// folds would narrow the legs a second time. The legs are narrowed once, with
// two folds.
import type { Vec2 } from '@engine'
import { TURN_OVER, across, gesture } from './gestures'
import type { Preset } from './types'

const S = Math.SQRT1_2

// ---- local frame along the bird base's axis (steps 9–13) ----
const T: Vec2 = [0.5 + S, 0] // the legs' point
/** Local (x across, y up the axis) → folded space: up = (−√½, √½), x = (√½, √½). */
const local = (x: number, y: number): Vec2 => [T[0] + x * S - y * S, x * S + y * S]
const side = S - 0.5 // the side corners' distance from the axis (at y = ½)
const edge = Math.hypot(side, 0.5) // |T – side corner|
const onAxis = local(0, edge) // where a lower edge's far end lands

// ---- neck, tail, head ----
const at = 0.4 // the reverse creases cross the axis this far above T
const out = Math.PI / 4 // neck and tail swing 45° off the axis
const neckTip = local(at * Math.sin(out), at + at * Math.cos(out)) // the left leg, out on the right
const tailTip = local(-at * Math.sin(out), at + at * Math.cos(out)) // the right leg, out on the left
const headLen = 0.1
const headBase: Vec2 = [(at - headLen) * Math.sin(out), at + (at - headLen) * Math.cos(out)] // local, on the neck
const headTip = local(headBase[0] + headLen * S, headBase[1] - headLen * S) // down and outward
const headGrab = local(headBase[0] + (headLen - 0.02) * Math.sin(out), headBase[1] + (headLen - 0.02) * Math.cos(out))

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
    // narrow the legs
    across('fold', local(-0.14, 0.4), local(-side, 0.5), onAxis, 4),
    across('fold', local(0.14, 0.4), local(side, 0.5), onAxis, 4),
    // neck and tail (the legs), then the head: inside reverse folds
    across('reverse', local(-0.01, 0.15), T, neckTip, 8),
    across('reverse', local(0.01, 0.15), T, tailTip, 8),
    across('reverse', headGrab, neckTip, headTip, 8),
  ],
}
