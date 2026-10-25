// Axiom tools (spec 07 "Huzita–Justin axioms as tools"; Plan 5 Task 1): the
// designer's adapter around the engine's axiomLines (Rabbit Ear's axioms),
// plus clipping an axiom's unbounded line to the sheet so it can become a
// crease.
import { axiomLines, type Line, type PaperSize, type Vec2 } from '@engine'

export type AxiomNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7
export type AxiomInputs = { points?: readonly Vec2[]; lines?: readonly Line[] }

/** How many points and lines each axiom takes (the tool prompts for them in this order: lines, then points). */
export const AXIOM_INPUTS: Record<AxiomNumber, { points: number; lines: number }> = {
  1: { points: 2, lines: 0 },
  2: { points: 2, lines: 0 },
  3: { points: 0, lines: 2 },
  4: { points: 1, lines: 1 },
  5: { points: 2, lines: 1 },
  6: { points: 2, lines: 2 },
  7: { points: 1, lines: 2 },
}

/** What each axiom does, for the tool's prompt. */
export const AXIOM_TEXT: Record<AxiomNumber, string> = {
  1: 'A crease through two points',
  2: 'Fold one point onto another',
  3: 'Fold one crease onto another',
  4: 'A crease through a point, perpendicular to a crease',
  5: 'Fold the first point onto a crease, through the second point',
  6: 'Fold two points onto two creases at once',
  7: 'Fold a point onto a crease, perpendicular to another crease',
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/**
 * The lines axiom `n` makes from its inputs (0 to 3 of them). Throws when the
 * inputs are short (the tool collects them first).
 */
export function axiom(n: AxiomNumber, inputs: AxiomInputs): Line[] {
  const need = AXIOM_INPUTS[n]
  const points = inputs.points ?? []
  const lines = inputs.lines ?? []
  if (points.length < need.points || lines.length < need.lines) {
    throw new Error(`Axiom ${n} needs ${plural(need.lines, 'line')} and ${plural(need.points, 'point')}.`)
  }
  return axiomLines(n, lines.slice(0, need.lines), points.slice(0, need.points))
}

/** The chord of `line` across the sheet [0, width] × [0, height], or null when it misses (or only grazes) it. */
export function clipLine(line: Line, size: PaperSize): [Vec2, Vec2] | null {
  const [ox, oy] = line.origin
  const [vx, vy] = line.vector
  let t0 = -Infinity
  let t1 = Infinity
  const slab = (o: number, v: number, max: number) => {
    if (Math.abs(v) < 1e-15) return o >= -1e-12 && o <= max + 1e-12
    let a = (0 - o) / v
    let b = (max - o) / v
    if (a > b) [a, b] = [b, a]
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, b)
    return true
  }
  if (!slab(ox, vx, size.width) || !slab(oy, vy, size.height)) return null
  if (!(t1 - t0 > 1e-9 / Math.hypot(vx, vy))) return null
  const at = (t: number): Vec2 => [
    Math.min(size.width, Math.max(0, ox + vx * t)),
    Math.min(size.height, Math.max(0, oy + vy * t)),
  ]
  return [at(t0), at(t1)]
}
