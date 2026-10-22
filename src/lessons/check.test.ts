import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, commit, createPaper, turnOver, type Frame, type Gesture, type Vec2 } from '@engine'
import { PRESETS, runPreset } from '../presets'
import { canonical, checkStep } from './check'

const fold = (grab: Vec2, target: Vec2, kind: Gesture['kind'] = 'valley', layers = 1): Gesture => ({
  tool: 'fold',
  grab,
  target,
  layers,
  kind,
  progress: 1,
  snapAngle: false,
})

function apply(f: Frame, ...gs: Gesture[]): Frame {
  for (const g of gs) {
    const r = commit(f, g)
    if (!r.ok) throw new Error(r.reason)
    f = r.frame
  }
  return f
}

const flip = (f: Frame) => turnOver(f).frame
const square = () => createPaper(PAPER_SIZES.square)
const strict = { allowMirror: false }
const loose = { allowMirror: true }

/** Every coordinate nudged by up to ±d (deterministic). */
function drift(f: Frame, d: number): Frame {
  let seed = 7
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * d
  return { ...f, vertices_coords: f.vertices_coords.map(([x, y]) => [x + r(), y + r()] as Vec2) }
}

// the half fold, right half over the left, and the same crease made by grabbing the left half
const halfRight = () => apply(square(), fold([0.9, 0.5], [0.1, 0.5]))
const halfLeft = () => apply(square(), fold([0.1, 0.5], [0.9, 0.5]))

describe('canonical', () => {
  test('a blank sheet has no creases and no layers', () => {
    const c = canonical(square())
    expect(c.creases).toEqual([])
    expect(c.layers).toEqual([])
    expect(c.facets).toHaveLength(1)
  })

  test('creases are in the reference placement, sorted and quantised', () => {
    const c = canonical(halfRight())
    expect(c.creases).toEqual([{ a: [0.5, 0], b: [0.5, 1], assignment: 'V', flat: true }])
    expect(c.facets.map(f => f.centroid)).toEqual([
      [0.25, 0.5],
      [0.75, 0.5],
    ])
  })

  test('a turned-over frame canonicalises like the original (mirror undone, V/M restored)', () => {
    const a = canonical(halfRight())
    const b = canonical(flip(halfRight()))
    expect(b.creases).toEqual(a.creases)
    expect(b.layers).toEqual(a.layers)
  })
})

describe('checkStep', () => {
  test('the same fold from two different grab points matches', () => {
    expect(checkStep(halfLeft(), halfRight(), strict)).toEqual({ match: true })
    // a diagonal: either triangle grabbed
    const d1 = apply(square(), fold([0.9, 0.1], [0.1, 0.9]))
    const d2 = apply(square(), fold([0.1, 0.9], [0.9, 0.1]))
    expect(checkStep(d1, d2, strict)).toEqual({ match: true })
  })

  test('a valley where the target has a mountain fails on creases', () => {
    const mountain = apply(square(), fold([0.9, 0.5], [0.1, 0.5], 'mountain'))
    expect(checkStep(halfRight(), mountain, strict)).toEqual({ match: false, reason: 'creases' })
    expect(checkStep(halfRight(), mountain, loose)).toEqual({ match: false, reason: 'creases' })
  })

  test('the right creases with the wrong layer order fail on layers', () => {
    // creases at x = 0.3 and 0.7, the flaps overlapping on x ∈ [0.4, 0.6]: the one folded second lies on top
    const left = fold([0.1, 0.5], [0.5, 0.5])
    const right = fold([0.9, 0.5], [0.5, 0.5])
    const leftFirst = apply(square(), left, right)
    const rightFirst = apply(square(), right, left)
    expect(canonical(leftFirst).creases).toEqual(canonical(rightFirst).creases)
    expect(checkStep(leftFirst, rightFirst, strict)).toEqual({ match: false, reason: 'layers' })
    expect(checkStep(leftFirst, apply(square(), left, right), strict)).toEqual({ match: true })
  })

  test('a mirrored fold matches only with allowMirror', () => {
    const topLeft = apply(square(), fold([0.05, 0.95], [0.45, 0.55]))
    const topRight = apply(square(), fold([0.95, 0.95], [0.55, 0.55]))
    expect(checkStep(topRight, topLeft, loose)).toEqual({ match: true })
    expect(checkStep(topRight, topLeft, strict)).toEqual({ match: false, reason: 'creases' })
    // a rotated equivalent (bottom-right corner) is a symmetric equivalent too
    const bottomRight = apply(square(), fold([0.95, 0.05], [0.55, 0.45]))
    expect(checkStep(bottomRight, topLeft, loose)).toEqual({ match: true })
    expect(checkStep(bottomRight, topLeft, strict).match).toBe(false)
  })

  test('A4 symmetries are D2: a quarter turn is not an equivalent', () => {
    const a4 = () => createPaper(PAPER_SIZES.a4)
    const H = Math.SQRT2
    const cornerTL = apply(a4(), fold([0.05, H - 0.05], [0.45, H - 0.45]))
    const cornerBR = apply(a4(), fold([0.95, 0.05], [0.55, 0.45]))
    expect(checkStep(cornerBR, cornerTL, loose)).toEqual({ match: true })
    expect(checkStep(cornerBR, cornerTL, strict).match).toBe(false)
  })

  test('the same model with and without turning over in between matches', () => {
    expect(checkStep(flip(flip(halfRight())), halfRight(), strict)).toEqual({ match: true })
    // fold, turn over, turn over, fold vs fold, fold
    const a = apply(flip(flip(apply(square(), fold([0.9, 0.5], [0.1, 0.5])))), fold([0.4, 0.9], [0.4, 0.1]))
    const b = apply(square(), fold([0.9, 0.5], [0.1, 0.5]), fold([0.4, 0.9], [0.4, 0.1]))
    expect(checkStep(a, b, strict)).toEqual({ match: true })
    // turned over first: a mountain from the back is the front's valley (the paper's right half moves)
    const fromBack = apply(flip(square()), fold([0.1, 0.5], [0.9, 0.5], 'mountain'))
    expect(checkStep(fromBack, halfRight(), strict)).toEqual({ match: true })
    const wrongFromBack = apply(flip(square()), fold([0.1, 0.5], [0.9, 0.5], 'valley'))
    expect(checkStep(wrongFromBack, halfRight(), strict)).toEqual({ match: false, reason: 'creases' })
  })

  test('without corner identity (vertices renumbered) every outline placement is a candidate reading', () => {
    // move vertex ids so 0..3 are no longer the corners (as in a frame not descended from a blank sheet)
    const f = apply(square(), fold([0.05, 0.95], [0.45, 0.55]))
    const n = f.vertices_coords.length
    const id = (v: number) => (v + 2) % n
    const perm = new Array<Vec2>(n)
    f.vertices_coords.forEach((p, v) => (perm[id(v)] = p))
    const rest: Record<string, unknown> = { ...f }
    for (const k of ['faces_edges', 'edges_faces', 'vertices_vertices', 'vertices_edges', 'vertices_faces', 'faces_faces']) delete rest[k]
    const renumbered = {
      ...(rest as Frame),
      vertices_coords: perm,
      edges_vertices: f.edges_vertices.map(([a, b]) => [id(a), id(b)] as [number, number]),
      faces_vertices: f.faces_vertices.map(vs => vs.map(id)),
    }
    expect(canonical(renumbered).cornersKnown).toBe(false)
    expect(checkStep(renumbered, f, strict)).toEqual({ match: true })
    expect(checkStep(renumbered, apply(square(), fold([0.5, 0.95], [0.5, 0.55])), strict).match).toBe(false)
  })

  test('tiny numeric drift still matches', () => {
    expect(checkStep(drift(halfLeft(), 1e-6), halfRight(), strict)).toEqual({ match: true })
    // a crease moved by more than the tolerance does not
    const off = apply(square(), fold([0.9, 0.5], [0.1 + 2e-3, 0.5]))
    expect(checkStep(off, halfRight(), strict)).toEqual({ match: false, reason: 'creases' })
  })

  describe.each(PRESETS.map(p => [p.id, p] as const))('preset %s', (_, preset) => {
    const run = runPreset(preset)
    if (!run.ok) throw new Error(run.reason)
    const { frames, steps } = run.history
    const replay = runPreset(preset)
    if (!replay.ok) throw new Error(replay.reason)

    test('every frame matches its replay, its turned-over self and itself with drift', () => {
      frames.forEach((f, i) => {
        expect(checkStep(replay.history.frames[i], f, strict), `frame ${i} replay`).toEqual({ match: true })
        expect(checkStep(flip(f), f, strict), `frame ${i} turned over`).toEqual({ match: true })
        expect(checkStep(flip(flip(f)), f, strict), `frame ${i} turned over twice`).toEqual({ match: true })
        expect(checkStep(drift(f, 1e-6), f, strict), `frame ${i} drift`).toEqual({ match: true })
      })
    })

    test('frames at different steps do not match (a turn over excepted)', () => {
      // a turn over leaves the model itself unchanged: frames[i + 1] is frames[i] seen from the back
      const same = (i: number, j: number) => {
        const [lo, hi] = i < j ? [i, j] : [j, i]
        for (let k = lo; k < hi; k++) if (steps[k].kind !== 'turnOver') return false
        return true
      }
      for (let i = 0; i < frames.length; i++)
        for (let j = 0; j < frames.length; j++) {
          if (i === j) continue
          expect(checkStep(frames[i], frames[j], strict).match, `frames ${i} vs ${j}`).toBe(same(i, j))
        }
    })
  })
})
