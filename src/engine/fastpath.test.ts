// The preview fast path (ops.ts `cutFlat`) must show exactly what the full
// foldThrough path shows: same refusals, crease, k, angle, blocked and
// validity, and the same frame up to numbering — the same faces (paper
// polygons), edges, face orders and world-space poses, and the same moving
// faces. Compared here gesture by gesture on a spread of fixtures.
import { describe, expect, test } from 'vitest'
import { applyPose } from './poses'
import { commit, preview, withoutFastPath, type Gesture, type Preview } from './ops'
import { foldedCoords, makeSheet } from './rabbit'
import { accordion, base, doubleTriangle, grid, halfFolded, preliminary } from './testkit'
import type { Frame, Vec2 } from './types'

const r9 = (x: number) => (Math.abs(x) < 5e-8 ? 0 : Math.round(x * 1e7) / 1e7)
const pt = (p: readonly number[]) => p.map(r9).join(',')
const polyKey = (pts: readonly (readonly number[])[]) => pts.map(pt).sort().join(' ')

function canonical(pv: Preview) {
  const f = pv.frame
  const paper = f.faces_vertices.map(vs => polyKey(vs.map(v => f.vertices_coords[v])))
  const world = f.faces_vertices.map((vs, i) =>
    polyKey(vs.map(v => applyPose(pv.poses[i].matrix, f.vertices_coords[v]))),
  )
  const edges = f.edges_vertices
    .map(([u, v], e) => `${[pt(f.vertices_coords[u]), pt(f.vertices_coords[v])].sort().join(' ')} ${f.edges_assignment[e]} ${r9(f.edges_foldAngle[e])}`)
    .sort()
  const orders = f.faceOrders
    .map(([a, b, s]) => (paper[a] < paper[b] ? `${paper[a]}|${paper[b]}|${s}` : `${paper[b]}|${paper[a]}|${-s}`))
    .sort()
  return {
    crease: pv.crease.map(([a, b]) => [pt(a), pt(b)].sort().join(' ')).sort(),
    layers: pv.layers,
    angleDeg: r9(pv.angleDeg),
    blocked: pv.blocked,
    valid: pv.valid,
    counts: [f.vertices_coords.length, f.edges_vertices.length, f.faces_vertices.length],
    faces: paper.map((p, i) => `${p} -> ${world[i]}`).sort(),
    moving: pv.moving.map(m => paper[m]).sort(),
    edges,
    orders,
    folded: [...foldedCoords(f)].map(pt).sort(),
  }
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gestures(frame: Frame, n: number, seed: number): Gesture[] {
  const rand = rng(seed)
  const xs = foldedCoords(frame).map(p => p[0])
  const ys = foldedCoords(frame).map(p => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const at = (): Vec2 => [x0 + (x1 - x0) * (rand() * 1.1 - 0.05), y0 + (y1 - y0) * (rand() * 1.1 - 0.05)]
  const corners: Vec2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  const out: Gesture[] = []
  for (let i = 0; i < n; i++) {
    // every 5th: corner to corner (a crease through vertices)
    const grab = i % 5 === 0 ? corners[i % 4] : at()
    const target = i % 5 === 0 ? corners[(i + 2) % 4] : at()
    out.push({
      tool: 'fold',
      grab,
      target,
      layers: 1 + Math.floor(rand() * 4),
      kind: rand() < 0.5 ? 'valley' : 'mountain',
      progress: i % 3 === 0 ? 1 : rand(),
      snapAngle: i % 4 === 1,
    })
  }
  return out
}

const committedGrid = () => {
  const c = commit(grid(4), { tool: 'fold', grab: [0.9, 0.6], target: [0.2, 0.4], layers: 1, kind: 'valley', progress: 1, snapAngle: false })
  if (!c.ok) throw new Error(c.reason)
  return c.frame
}

const fixtures: [string, () => Frame][] = [
  ['sheet', () => makeSheet({ width: 1, height: 1 })],
  ['a4 sheet', () => makeSheet({ width: 1, height: Math.SQRT2 })],
  ['half fold', halfFolded],
  ['grid 4×4', () => grid(4)],
  ['grid 5×3', () => grid(5, 3)],
  ['a folded grid', committedGrid],
  ['accordion 6', () => accordion(6)],
  ['preliminary', preliminary],
  ['double triangle', doubleTriangle],
  ['waterbomb', () => base('waterbomb')],
  ['kite', () => base('kite')],
  ['bird', () => base('bird')],
]

describe('the preview fast path matches the full foldThrough path', () => {
  test.each(fixtures)('%s', (_, make) => {
    const frame = make()
    for (const g of gestures(frame, 60, frame.faces_vertices.length * 7919 + frame.vertices_coords.length)) {
      const fast = preview(frame, g)
      const slow = withoutFastPath(() => preview(structuredClone(frame), g))
      const what = JSON.stringify(g)
      expect(fast.ok, what).toBe(slow.ok)
      if (!fast.ok || !slow.ok) {
        expect(fast, what).toEqual(slow)
        continue
      }
      expect(canonical(fast.preview), what).toEqual(canonical(slow.preview))
    }
  }, 120_000)

  test('a drag (the target moving every call) matches move by move', () => {
    const frame = grid(6)
    for (let i = 0; i < 20; i++) {
      const g: Gesture = { tool: 'fold', grab: [0.95, 0.55], target: [0.8 - i * 0.03, 0.5 + i * 0.004], layers: 1, kind: 'valley', progress: (i + 1) / 21, snapAngle: false }
      const fast = preview(frame, g)
      const slow = withoutFastPath(() => preview(structuredClone(frame), g))
      if (!fast.ok || !slow.ok) throw new Error('refused')
      expect(canonical(fast.preview)).toEqual(canonical(slow.preview))
    }
  })
})
