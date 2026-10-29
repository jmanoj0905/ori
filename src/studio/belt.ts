// The layer belt (spec 09): a press-and-hold on the paper opens a small circle
// at the press point showing a side view of the paper stack there, one row per
// layer, top to bottom. Sliding onto a row and dragging out of the circle picks
// that layer and every layer above it, and the fold carries on as one gesture.
// This module is the belt's geometry, shared by the gesture (useFoldGesture)
// and the island (islands/LayerBelt).
import type { StackProfile } from '@engine'

/** Hold this long (ms) without moving to open the belt. */
export const HOLD_MS = 400
/** Drift (client px) allowed during the hold; moving further is a fold, not a hold. */
export const HOLD_SLOP_PX = 4
/** The belt's radius (client px); leaving it picks the hovered layer. */
export const BELT_RADIUS_PX = 72

export type BeltState = {
  /** The belt's centre: the press point, in client px. */
  clientX: number
  clientY: number
  stack: StackProfile
  /** The row under the pointer (0 = top layer), or null before the pointer reaches one. */
  hovered: number | null
  /** Opened from the keyboard (layerPicker) rather than by a hold. */
  keyboard: boolean
}

/** Row height (px): 14, squeezed so a tall stack still fits inside the circle. */
export function rowPx(n: number): number {
  return Math.min(14, (2 * BELT_RADIUS_PX - 16) / n)
}

export function insideBelt(b: BeltState, x: number, y: number): boolean {
  return Math.hypot(x - b.clientX, y - b.clientY) <= BELT_RADIUS_PX
}

/**
 * The row at client (x, y): rows are stacked top → bottom, centred on the
 * belt's centre. Above or below the stack (but inside the circle) clamps to
 * the end rows, so sliding sideways toward the edge never loses the row.
 * Null outside the circle (or for an empty stack).
 */
export function beltRowAt(b: BeltState, x: number, y: number): number | null {
  const n = b.stack.faces.length
  if (n === 0 || !insideBelt(b, x, y)) return null
  const r = rowPx(n)
  const row = Math.floor((y - (b.clientY - (n * r) / 2)) / r)
  return Math.min(n - 1, Math.max(0, row))
}

/** "Layer 3 of 4: top flap and 2 below" (i is 1-based; layer 1 is the top flap alone). */
export function layerWords(i: number, n: number): string {
  return i === 1 ? `Layer ${i} of ${n}: top flap` : `Layer ${i} of ${n}: top flap and ${i - 1} below`
}
