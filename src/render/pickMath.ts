// Pure picking maths (no WebGL): pointer position → paper plane, and the
// pixels-per-paper-unit scale at the plane. Both read the element's *current*
// rect and camera on every call, so a resize or devicePixelRatio change
// mid-drag cannot leave a stale mapping behind (nothing is cached).
import * as THREE from 'three'
import type { Vec2 } from '@engine'

export type RectLike = { left: number; top: number; width: number; height: number }

const PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

/** Client coords → normalised device coords for `rect`. */
export function toNdc(clientX: number, clientY: number, rect: RectLike): THREE.Vector2 {
  return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1))
}

/** View ray through a client point intersected with z = 0; null if the ray misses the plane. */
export function clientToPlane(camera: THREE.Camera, rect: RectLike, clientX: number, clientY: number): Vec2 | null {
  camera.updateMatrixWorld()
  const ray = new THREE.Raycaster()
  ray.setFromCamera(toNdc(clientX, clientY, rect), camera)
  const p = new THREE.Vector3()
  return ray.ray.intersectPlane(PLANE, p) ? [p.x, p.y] : null
}

/** Paper-plane point → client coords (inverse of clientToPlane). */
export function planeToClient(camera: THREE.Camera, rect: RectLike, p: Vec2): Vec2 {
  camera.updateMatrixWorld()
  const v = new THREE.Vector3(p[0], p[1], 0).project(camera)
  return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]
}

/**
 * Screen pixels per paper unit at `at` on the paper plane: the mean length of
 * one unit step along x and along y (they differ under tilt). CSS pixels, so
 * it is independent of devicePixelRatio.
 */
export function pxPerUnit(camera: THREE.Camera, rect: RectLike, at: Vec2): number {
  const o = planeToClient(camera, rect, at)
  const x = planeToClient(camera, rect, [at[0] + 1, at[1]])
  const y = planeToClient(camera, rect, [at[0], at[1] + 1])
  return (Math.hypot(x[0] - o[0], x[1] - o[1]) + Math.hypot(y[0] - o[0], y[1] - o[1])) / 2
}

/** A snap radius in CSS pixels → paper units at the current zoom. */
export function snapRadiusPaper(px: number, pxPerPaperUnit: number): number {
  return pxPerPaperUnit > 0 ? px / pxPerPaperUnit : 0
}
