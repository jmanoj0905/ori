// Where the sheet may sit: the free area of the viewport between the floating
// islands. Pure measuring (rects in, insets out) so it is testable without a
// browser; App feeds the result to Stage.setInsets, which centres the camera
// framing on that area.
import { NO_INSETS, type Insets } from '../render/insets'

export { NO_INSETS, sameInsets, type Insets } from '../render/insets'

/** Below this viewport width the islands collapse into the bottom sheet. */
export const NARROW_PX = 720

/** Air kept between an island and the paper, CSS px. */
const GAP = 16
/** Room for the fold bar and hint line above the bottom sheet (they come and go, so it is constant). */
export const BAR_RESERVE_PX = 110

type R = { left: number; right: number; top: number; bottom: number }

export function measureInsets(
  viewport: { width: number; height: number },
  rects: { tools?: R | null; steps?: R | null; dock?: R | null },
): Insets {
  if (viewport.width < NARROW_PX) {
    const top = rects.dock?.top
    return { ...NO_INSETS, bottom: top === undefined ? 0 : Math.max(0, viewport.height - top) + BAR_RESERVE_PX }
  }
  return {
    ...NO_INSETS,
    left: rects.tools ? Math.max(0, rects.tools.right) + GAP : 0,
    right: rects.steps ? Math.max(0, viewport.width - rects.steps.left) + GAP : 0,
  }
}
