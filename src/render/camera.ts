// Pure camera maths (no WebGL). Convention: the paper lies in z = 0 and +z is
// "up"; the camera sits on the +z side looking down at the paper, with +y as
// screen-up. `tilt` is the polar angle from +z, `azimuth` rotates about z.

export type Bounds = { width: number; height: number }
export type Vec3T = readonly [number, number, number]

/** Fraction of extra room around the sheet. */
export const FRAME_MARGIN = 0.15
export const FOV_DEG = 35
/** Default slight tilt of the studio view, in radians (~25 degrees). */
export const DEFAULT_TILT = (25 * Math.PI) / 180
/** Max polar angle: never look from below or edge-on. */
export const MAX_TILT = (80 * Math.PI) / 180

/** Distance at which a width x height sheet fits the view, with a 15% margin. */
export function frameBounds(bounds: Bounds, fovDeg: number, aspect: number): { distance: number } {
  const t = Math.tan((fovDeg * Math.PI) / 360)
  const m = 1 + FRAME_MARGIN
  const byHeight = (bounds.height / 2) * m / t
  const byWidth = (bounds.width / 2) * m / (t * aspect)
  return { distance: Math.max(byHeight, byWidth) }
}

/** Offset of the camera from its target, as a unit vector. */
export function offsetFor(tilt: number, azimuth: number): Vec3T {
  return [Math.sin(tilt) * Math.sin(azimuth), -Math.sin(tilt) * Math.cos(azimuth), Math.cos(tilt)]
}

/** Direction the camera looks (from camera toward target), a unit vector. */
export function viewDirection(name: 'top' | 'reset'): Vec3T {
  const [x, y, z] = offsetFor(name === 'top' ? 0 : DEFAULT_TILT, 0)
  return [-x + 0, -y + 0, -z + 0]
}
