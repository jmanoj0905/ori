// Crease-pattern operations for the designer (Plan 5): the Huzita–Justin
// axioms. Rabbit Ear is reached through rabbit.ts only.
import { axiomLines as reAxiomLines } from './rabbit'
import type { Line, Vec2 } from './types'

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
