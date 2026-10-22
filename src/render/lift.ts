// The release lift (spec 03 step 4 "the flap settles with a short eased
// animation, about 250 ms"; R55). Render-only and pure: while a fold is
// dragged the moving flap (the ghost) hovers FLAP_LIFT above its pose, and
// when the commit lands it eases back down over LAND_MS. Only a z
// translation: the flap's angle is always the previewed / committed one.
// Reduced motion: no lift, so nothing moves on release.
import type { FoldKind, Tool } from '@engine'

/** Hover height of a dragged flap, paper units (the unit sheet is 1 wide): ~13 layer gaps. */
export const FLAP_LIFT = 0.02

/** How long the flap takes to land after a release. */
export const LAND_MS = 250

/** The flap's lift for a preview drawn in `style`. */
export function flapLift(style: { kind?: FoldKind; tool?: Tool }, reduced: boolean): number {
  if (reduced) return 0
  // A mountain fold carries the flap beneath the paper: lifting it toward the
  // viewer would push it through the layer above, and down is the desk.
  if ((style.tool ?? 'fold') === 'fold' && style.kind === 'mountain') return 0
  return FLAP_LIFT
}
