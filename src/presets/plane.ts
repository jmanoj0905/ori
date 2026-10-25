// The paper plane: the classic dart, on A4 (1 × √2, nose at the top edge).
//
//  1–2. Fold the top corners to the centre line (valley; corner (0,√2) /
//       (1,√2) onto (½, √2 − ½)): a point at the top.
//  3–4. Fold each new slanted edge to the centre line (valley, both layers):
//       the point narrows to 45°.
//  5.   Fold in half along the centre, the folds outside (mountain: the left
//       half goes behind). The model lies on x ∈ [½, 1], spine at x = ½.
//  6.   Fold the front wing down (valley, the front half's 4 layers, grabbed
//       near the nose where all four lie): the slanted top edge onto the
//       spine, along a crease from the nose 11.25° off the spine.
//  7.   Turn over (mirrored about x = ¾: the spine is now at x = 1).
//  8.   Fold the other wing down to match (the mirror image of step 6).
//
// Deviations from the classic diagram:
//  - The opening "fold in half lengthwise and unfold" is left out: it only
//    makes a reference crease, and the gestures aim at the centre line
//    directly. That keeps the plane at 8 steps.
import type { Vec2 } from '@engine'
import { TURN_OVER, across, along, bring, gesture } from './gestures'
import type { Preset } from './types'

const H = Math.SQRT2 // A4 height
const centre: Vec2 = [0.5, H - 0.5] // where the top corners land
const slant = Math.PI / 8 // the point's half-angle after steps 1–2 (22.5°)

// Step 6: the wing crease, from the nose at half the slant. The grab sits 0.3
// from the nose between the crease and the slanted edge, where the stack is
// the front half's four layers (sheet, corner flap, edge flap) over the back
// half's four; grabbed lower down only two front layers are there, and the
// corner flap between them would be left behind.
const nose: Vec2 = [0.5, H]
const wingCreaseDir: Vec2 = [Math.sin(slant / 2), -Math.cos(slant / 2)]
const wingGrab: Vec2 = [0.5 + 0.3 * Math.sin((3 * slant) / 4), H - 0.3 * Math.cos((3 * slant) / 4)]
const wing = along('fold', wingGrab, nose, wingCreaseDir, 4)
// After the turn over the model is mirrored about x = ¾ (its footprint is x ∈ [½, 1]).
const flip = (p: Vec2): Vec2 => [1.5 - p[0], p[1]]

export const plane: Preset = {
  id: 'plane',
  name: 'Paper plane',
  paper: 'a4',
  steps: [
    bring('fold', [0, H], centre, 1),
    bring('fold', [1, H], centre, 1),
    // the slanted edge's lower end (0, √2 − ½) goes onto the centre line, √½ below the nose
    across('fold', [0.1, H - 0.45], [0, H - 0.5], [0.5, H - Math.SQRT1_2], 2),
    across('fold', [0.9, H - 0.45], [1, H - 0.5], [0.5, H - Math.SQRT1_2], 2),
    gesture('fold', [0.25, 0.1], [0.75, 0.1], 1, 'mountain'),
    wing,
    TURN_OVER,
    gesture('fold', flip(wing.grab), flip(wing.target), 4),
  ],
}
