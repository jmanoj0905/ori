// Sculpted steps (spec 08 "Hand-off between rigid and soft"; Plan 6 Task 5):
// leaving soft mode with a shape that is no longer a rigid folded state keeps
// it as a mesh snapshot. A sculpted frame is the rigid frame it came from plus
// that snapshot (`ori_sculpt`), drawn from the snapshot; it is excluded from
// the layer solver and from further rigid folds (undo back to the exact frame
// to fold again).
import type { Step } from './history'
import type { Frame, Result } from './types'

/** World positions (xyz), triangles and paper coordinates (xy) of the soft mesh. */
export type SculptSnapshot = { positions: number[]; tris: number[]; uv: number[] }
export type SculptParams = { snapshot: SculptSnapshot }

export const SCULPTED = 'This model is sculpted (soft paper). Undo to the folded step to fold it again.'
export const BAD_SNAPSHOT = 'The sculpted mesh is damaged.'

/** The frame's snapshot, when it is a sculpted frame. */
export const sculptOf = (f: Frame): SculptSnapshot | null => (f.ori_sculpt as SculptSnapshot | undefined) ?? null

const finiteArray = (a: unknown): a is number[] => Array.isArray(a) && a.every(x => typeof x === 'number' && Number.isFinite(x))

/** A snapshot checked for shape: positions xyz, uv xy for the same particles, triangles of known particles. */
export function validSnapshot(s: unknown): s is SculptSnapshot {
  if (typeof s !== 'object' || s === null) return false
  const { positions, tris, uv } = s as Record<string, unknown>
  if (!finiteArray(positions) || !finiteArray(tris) || !finiteArray(uv)) return false
  const n = positions.length / 3
  if (!Number.isInteger(n) || n === 0 || uv.length !== 2 * n || tris.length === 0 || tris.length % 3 !== 0) return false
  return tris.every(t => Number.isInteger(t) && t >= 0 && t < n)
}

/** The sculpted step on top of `base` (a rigid frame), or a refusal for a damaged snapshot. */
export function sculpt(base: Frame, snapshot: SculptSnapshot): Result<{ frame: Frame; step: Step }> {
  if (!validSnapshot(snapshot)) return { ok: false, reason: BAD_SNAPSHOT }
  const frozen = Object.freeze({ positions: [...snapshot.positions], tris: [...snapshot.tris], uv: [...snapshot.uv] })
  const { ori_sculpt: _drop, ...rigid } = base as Frame & { ori_sculpt?: unknown }
  const frame: Frame = Object.freeze({ ...rigid, ori_sculpt: frozen }) as Frame
  const params: SculptParams = { snapshot: frozen }
  return { ok: true, frame, step: { kind: 'sculpted', params, label: 'Sculpted (soft paper)', at: Date.now() } }
}
