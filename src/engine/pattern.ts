// Crease-pattern operations for the designer (Plan 5): the Huzita–Justin
// axioms, building a pattern's faces, and "Fold all". Rabbit Ear is reached
// through rabbit.ts only.
import { axiomLines as reAxiomLines, layerOrders, planarFaces } from './rabbit'
import type { Frame, Line, Result, Vec2 } from './types'

/**
 * Huzita–Justin axiom `n` (1–7) as unbounded lines; [] when there is no
 * solution. Inputs, by axiom:
 *   1  points [p1, p2]: the line through both
 *   2  points [p1, p2]: the fold placing p1 onto p2 (perpendicular bisector)
 *   3  lines [l1, l2]: the folds placing l1 onto l2 (angle bisectors)
 *   4  lines [l], points [p]: the fold perpendicular to l through p
 *   5  lines [l], points [p1, p2]: through p2, placing p1 onto l
 *   6  lines [l1, l2], points [p1, p2]: placing p1 onto l1 and p2 onto l2
 *   7  lines [l1, l2], points [p]: placing p onto l1, perpendicular to l2
 */
export function axiomLines(n: number, lines: readonly Line[], points: readonly Vec2[]): Line[] {
  const [l1, l2] = lines
  const [p1, p2] = points
  switch (n) {
    case 1:
    case 2:
      return reAxiomLines(n, [p1!, p2!])
    case 3:
      return reAxiomLines(3, [l1!, l2!])
    case 4:
      return reAxiomLines(4, [l1!, p1!])
    case 5:
      return reAxiomLines(5, [l1!, p2!, p1!])
    case 6:
      return reAxiomLines(6, [l1!, l2!, p1!, p2!])
    case 7:
      return reAxiomLines(7, [l1!, l2!, p1!])
    default:
      return []
  }
}

export const PATTERN_NO_FACES = 'The crease pattern has no faces.'
export const PATTERN_NO_ORDER = 'No valid layer order exists for this crease pattern.'
export const PATTERN_DANGLING = 'A crease ends inside the paper, so it cannot fold.'

const foldAngleOf = (a: string) => (a === 'V' ? 180 : a === 'M' ? -180 : 0)

/**
 * A crease pattern as an unfolded frame: its planar faces built, every crease
 * at 0° (a pre-creased flat sheet), no layer orders. Assignments are kept.
 */
export function patternFrame(cp: Frame): Result<{ frame: Frame }> {
  const frame = planarFaces({ ...cp, edges_foldAngle: cp.edges_assignment.map(() => 0), faceOrders: [] })
  if (frame.faces_vertices.length === 0) return { ok: false, reason: PATTERN_NO_FACES }
  return { ok: true, frame }
}

/**
 * "Fold all" (spec 07): the whole pattern collapsed flat. Valleys go to +180°,
 * mountains to −180°, everything else (unassigned, flat) stays at 0°; the
 * layer order comes from the layer solver. Refused when no order exists.
 * Unassigned creases are solved as flat ('F') and keep their 'U'.
 */
export function foldPattern(cp: Frame): Result<{ frame: Frame }> {
  const angles = cp.edges_assignment.map(foldAngleOf)
  const frame = planarFaces({ ...cp, edges_foldAngle: angles, faceOrders: [] })
  if (frame.faces_vertices.length === 0) return { ok: false, reason: PATTERN_NO_FACES }
  // a folded crease must separate two faces (one with the same face on both sides is a slit)
  const dangling = frame.edges_assignment.some((a, e) => {
    if (a !== 'V' && a !== 'M') return false
    const fs = (frame.edges_faces?.[e] ?? []).filter(f => f != null)
    return fs.length !== 2 || fs[0] === fs[1]
  })
  if (dangling) return { ok: false, reason: PATTERN_DANGLING }
  const solving: Frame = { ...frame, edges_assignment: frame.edges_assignment.map(a => (a === 'V' || a === 'M' || a === 'B' ? a : 'F')) }
  const orders = layerOrders(solving)
  if (!orders) return { ok: false, reason: PATTERN_NO_ORDER }
  return { ok: true, frame: { ...frame, faceOrders: orders } }
}
