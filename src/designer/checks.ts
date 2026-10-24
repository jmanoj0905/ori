// Local flat-foldability checks (spec 07 "Flat-foldability checks"; Plan 5
// Task 3), at every interior vertex of a crease pattern:
//   - Kawasaki: the alternating sums of the angles between consecutive
//     folded creases are each 180°;
//   - Maekawa: |M − V| = 2.
// Only mountain and valley creases count. Unassigned ('U') and flat ('F')
// creases stay unfolded, so they are excluded from both (Review Focus 2); a
// vertex with no folded crease has nothing to check. Vertices on the sheet's
// boundary (touching a 'B' edge) are not interior. Pure: runs in the check
// worker (check.worker.ts) for big patterns.
import type { Vec2 } from '@engine'
import type { CP } from './cp'

/** Angle tolerance (radians) for Kawasaki's sums. */
export const KAWASAKI_EPS = 1e-6

export type IssueKind = 'kawasaki' | 'maekawa'
export type VertexIssue = { vertex: number; at: Vec2; kinds: IssueKind[]; text: string }

type Fan = { angles: number[]; m: number; v: number }

/** The folded creases around each interior vertex (null: boundary or nothing folded). */
function fans(cp: CP): (Fan | null)[] {
  const out: (Fan | null)[] = cp.vertices_coords.map(() => ({ angles: [], m: 0, v: 0 }))
  cp.edges_vertices.forEach(([a, b], e) => {
    const asg = cp.edges_assignment[e]
    if (asg === 'B') {
      out[a] = null
      out[b] = null
      return
    }
    if (asg !== 'M' && asg !== 'V') return
    for (const [u, w] of [[a, b], [b, a]] as const) {
      const f = out[u]
      if (!f) continue
      const p = cp.vertices_coords[u]!
      const q = cp.vertices_coords[w]!
      f.angles.push(Math.atan2(q[1] - p[1], q[0] - p[0]))
      if (asg === 'M') f.m++
      else f.v++
    }
  })
  return out.map(f => (f && f.angles.length > 0 ? f : null))
}

/** The two alternating sector sums (radians), or null for an odd number of creases. */
function alternating(angles: number[]): [number, number] | null {
  if (angles.length % 2 === 1) return null
  const s = [...angles].sort((x, y) => x - y)
  const sums: [number, number] = [0, 0]
  s.forEach((a, i) => {
    const next = i + 1 < s.length ? s[i + 1]! : s[0]! + 2 * Math.PI
    sums[i % 2] += next - a
  })
  return sums
}

const failsKawasaki = (f: Fan) => {
  const s = alternating(f.angles)
  return !s || Math.abs(s[0] - Math.PI) > KAWASAKI_EPS
}
const failsMaekawa = (f: Fan) => Math.abs(f.m - f.v) !== 2

/** Interior vertices where Kawasaki's theorem fails, in index order. */
export function kawasaki(cp: CP): number[] {
  return fans(cp).flatMap((f, i) => (f && failsKawasaki(f) ? [i] : []))
}

/** Interior vertices where Maekawa's theorem fails, in index order. */
export function maekawa(cp: CP): number[] {
  return fans(cp).flatMap((f, i) => (f && failsMaekawa(f) ? [i] : []))
}

const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1)
const count = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Every failing vertex with what fails and why (the issues panel and the vertex tooltips). */
export function vertexIssues(cp: CP): VertexIssue[] {
  const out: VertexIssue[] = []
  fans(cp).forEach((f, vertex) => {
    if (!f) return
    const kinds: IssueKind[] = []
    const words: string[] = []
    if (failsKawasaki(f)) {
      kinds.push('kawasaki')
      const s = alternating(f.angles)
      words.push(
        s
          ? `Kawasaki: alternating angles sum to ${deg(Math.max(...s))}° and ${deg(Math.min(...s))}°, not 180°.`
          : `Kawasaki: an odd number of folded creases (${f.angles.length}) meet here.`,
      )
    }
    if (failsMaekawa(f)) {
      kinds.push('maekawa')
      words.push(`Maekawa: ${count(f.m, 'mountain')} and ${count(f.v, 'valley')}; |M − V| must be 2.`)
    }
    if (kinds.length) out.push({ vertex, at: cp.vertices_coords[vertex]!, kinds, text: words.join(' ') })
  })
  return out
}
