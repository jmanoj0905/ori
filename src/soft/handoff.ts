// The rigid ↔ soft hand-off (spec 08 "Hand-off between rigid and soft"; Plan 6
// Task 5).
//
//   Entering: the frame is remeshed (posed exactly as the rigid model).
//   Leaving: if the soft shape is still the rigid model's flat-foldable state
//   — every face still planar (bending hinges within BEND_TOLERANCE_DEG) and
//   every crease at its frame angle (within CREASE_TOLERANCE_DEG; a flat
//   crease's ±180° are one pose) — the model snaps back to the exact frame
//   (the history is untouched). Otherwise the shape is kept as a sculpted step
//   (engine `sculpt`): the rigid frame plus a mesh snapshot, positions rounded
//   to 1e-6 (what share links carry).
import { poses, sculpt, type Frame, type SculptSnapshot, type Step } from '@engine'
import { dihedral } from './dihedral'
import { remesh, type RemeshOptions, type SoftMesh } from './remesh'

export const BEND_TOLERANCE_DEG = 2
export const CREASE_TOLERANCE_DEG = 5
const DEG = 180 / Math.PI

export type Leave = { kind: 'exact'; frame: Frame } | { kind: 'sculpted'; frame: Frame; step: Step }

/** The soft mesh of `frame`, posed as the rigid model (edge length: 1/32 of the sheet by default). */
export function enterSoft(frame: Frame, targetEdge?: number, opts: RemeshOptions = {}): SoftMesh {
  let w = 0
  let h = 0
  for (const [x, y] of frame.vertices_coords) {
    w = Math.max(w, x)
    h = Math.max(h, y)
  }
  return remesh(frame, poses(frame), targetEdge ?? Math.sqrt(Math.max(w * h, 1e-6)) / 32, opts)
}

const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

/** Is this soft shape still the frame's rigid state (faces planar, creases at their angles)? */
export function isRigidState(mesh: SoftMesh, positions: ArrayLike<number>): boolean {
  for (const h of mesh.bendHinges) if (Math.abs(dihedral(positions, h.a, h.b, h.c, h.d) * DEG) > BEND_TOLERANCE_DEG) return false
  for (const h of mesh.creaseHinges) if (angleGap(dihedral(positions, h.a, h.b, h.c, h.d) * DEG, h.restAngle) > CREASE_TOLERANCE_DEG) return false
  return true
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6

/** Leave soft mode: back to the exact frame, or a sculpted step (see header). */
export function leaveSoft(frame: Frame, mesh: SoftMesh, positions: ArrayLike<number>): Leave {
  if (isRigidState(mesh, positions)) return { kind: 'exact', frame }
  const snapshot: SculptSnapshot = {
    positions: Array.from(positions, round6),
    tris: Array.from(mesh.tris),
    uv: Array.from(mesh.uv, round6),
  }
  const r = sculpt(frame, snapshot)
  if (!r.ok) return { kind: 'exact', frame } // cannot happen for a mesh we built; never lose the model
  return { kind: 'sculpted', frame: r.frame, step: r.step }
}

