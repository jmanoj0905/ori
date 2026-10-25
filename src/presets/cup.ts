// The cup, on a square (the classic paper cup).
//
// The square is folded on its diagonal into a triangle whose open point is
// at (1, 1) and whose folded edge (the cup's bottom) runs (1,0)–(0,1); its
// axis is the line y = x. With h = 2 − √2:
//  1. Fold corner (0,0) onto (1,1): the triangle (valley).
//  2. Fold the right corner (1,0) across to the opposite edge at (h, 1),
//     both layers: the flap's top edge ends parallel to the bottom.
//  3. Fold the left corner (0,1) across to (1, h), both layers, on top.
//  4. Fold the front top flap (the open point's top layer) down over the
//     corner flaps (valley along x + y = 3 − √2: (1,1) onto (h,h)).
//  5. Turn over (mirrored about x = √½, the footprint's centre).
//  6. Fold the other top flap down to match ((√2 − 1, 1) onto (2√2 − 2, h)).
// The result is the cup's isosceles trapezoid.
//
// Deviation: the classic tucks the top flaps into the corner flaps' pocket;
// here they are folded down flat over them (a tuck is not a single gesture).
import { TURN_OVER, bring } from './gestures'
import type { Preset } from './types'

const h = 2 - Math.SQRT2

export const cup: Preset = {
  id: 'cup',
  name: 'Cup',
  paper: 'square',
  steps: [
    bring('fold', [0, 0], [1, 1], 1),
    bring('fold', [1, 0], [h, 1], 2),
    bring('fold', [0, 1], [1, h], 2),
    bring('fold', [1, 1], [h, h], 1),
    TURN_OVER,
    bring('fold', [Math.SQRT2 - 1, 1], [2 * Math.SQRT2 - 2, h], 1),
  ],
}
