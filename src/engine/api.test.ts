import { describe, expect, test } from 'vitest'
import * as api from '@engine'
import type { Frame, Gesture } from '@engine'
import { applyPose } from './poses'
import { foldedCoords, windings } from './rabbit'
import { halfFolded } from './testkit'

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps
const near = (p: readonly number[], q: readonly number[], eps = 1e-9) => p.every((x, i) => close(x, q[i], eps))

function ok<T>(r: ({ ok: true } & T) | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r
}

describe('the @engine public API', () => {
  test('exports exactly the runtime surface (R5)', async () => {
    const keys = Object.keys(await import('@engine')).sort()
    expect(keys).toEqual(
      [
        'createPaper',
        'preview',
        'commit',
        'turnOver',
        'poses',
        'landmarks',
        'snapPoint',
        'snapCreaseLine',
        'layerAt',
        'layerRanks',
        'PAPER_SIZES',
        'startHistory',
        'push',
        'undo',
        'redo',
        'jumpTo',
        'current',
        'canUndo',
        'canRedo',
        'frameFromFold',
        'axiomLines',
        'patternFrame',
        'foldPattern',
        'commitPattern',
        'sculpt',
        'sculptOf',
        'validSnapshot',
        'SCULPTED',
        'branch',
        'patternStep',
        'hingesAt',
      ].sort(),
    )
  })

  test('PAPER_SIZES and createPaper', () => {
    expect(api.PAPER_SIZES).toEqual({ square: { width: 1, height: 1 }, a4: { width: 1, height: Math.SQRT2 } })
    const a4 = api.createPaper(api.PAPER_SIZES.a4)
    const xs = a4.vertices_coords.map(p => p[0])
    const ys = a4.vertices_coords.map(p => p[1])
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 1, 0, Math.SQRT2])
    expect(a4.faces_vertices).toHaveLength(1)
    expect(a4.faceOrders).toEqual([])
  })

  test('a fold through the public API', () => {
    const g: Gesture = { tool: 'fold', grab: [0.9, 0.5], target: [0.1, 0.5], layers: 1, kind: 'valley', progress: 1, snapAngle: false }
    const sheet = api.createPaper(api.PAPER_SIZES.square)
    expect(ok(api.preview(sheet, g)).preview.moving.length).toBeGreaterThan(0)
    const { frame, step } = ok(api.commit(sheet, g))
    let h = api.push(api.startHistory(sheet), step, frame)
    expect(api.layerAt(api.current(h), [0.25, 0.5])).toHaveLength(2)
    h = api.undo(h)
    expect(api.current(h)).toBe(sheet)
    expect(api.canRedo(h)).toBe(true)
  })
})

describe('turnOver', () => {
  test('mirrors the folded form about the vertical axis through its bounding-box centre', () => {
    const f = halfFolded() // folded footprint x ∈ [0, 0.5]: centre 0.25
    const before = foldedCoords(f)
    const { frame } = ok(api.turnOver(f))
    const after = foldedCoords(frame)
    before.forEach((p, v) => expect(near(after[v], [0.5 - p[0], p[1]])).toBe(true))
  })

  test('reverses the layer order: the former bottom layer is on top', () => {
    const f = halfFolded()
    const stack = api.layerAt(f, [0.25, 0.5])
    expect(stack).toHaveLength(2)
    const { frame } = ok(api.turnOver(f))
    expect(api.layerAt(frame, [0.25, 0.5])).toEqual([...stack].reverse())
    // and on a model with several layers at the point
    const g: Gesture = { tool: 'fold', grab: [0.25, 0.9], target: [0.25, 0.1], layers: 2, kind: 'valley', progress: 1, snapAngle: false }
    const four = ok(api.commit(f, g)).frame
    const s4 = api.layerAt(four, [0.25, 0.25])
    expect(s4).toHaveLength(4)
    expect(api.layerAt(ok(api.turnOver(four)).frame, [0.25, 0.25])).toEqual([...s4].reverse())
  })

  test('keeps root face 0 at the identity and faces counter-clockwise', () => {
    const { frame } = ok(api.turnOver(halfFolded()))
    const c = foldedCoords(frame)
    frame.faces_vertices[0].forEach(v => expect(near(c[v], frame.vertices_coords[v])).toBe(true))
    // paper-space polygons stay counter-clockwise
    for (const vs of frame.faces_vertices) {
      let a = 0
      vs.forEach((v, i) => {
        const [x0, y0] = frame.vertices_coords[v]
        const [x1, y1] = frame.vertices_coords[vs[(i + 1) % vs.length]]
        a += x0 * y1 - x1 * y0
      })
      expect(a).toBeGreaterThan(0)
    }
  })

  test('returns a turnOver step', () => {
    const { step } = ok(api.turnOver(halfFolded()))
    expect(step.kind).toBe('turnOver')
    expect(step.label).toBe('Turn over')
  })

  test('twice gives the same faceOrders and windings as the original, exactly (Review Focus 4)', () => {
    for (const f of [halfFolded(), api.createPaper(api.PAPER_SIZES.square)]) {
      const twice = ok(api.turnOver(ok(api.turnOver(f)).frame)).frame
      expect(twice.faceOrders).toEqual(f.faceOrders)
      expect(windings(twice)).toEqual(windings(f))
      expect(twice.faces_vertices).toEqual(f.faces_vertices)
      expect(twice.edges_assignment).toEqual(f.edges_assignment)
      expect(twice.edges_foldAngle).toEqual(f.edges_foldAngle)
      twice.vertices_coords.forEach((p, v) => expect(near(p, f.vertices_coords[v], 1e-12)).toBe(true))
    }
  })

  test('undoing a turnOver in history restores the original frame', () => {
    const f = halfFolded()
    const { frame, step } = ok(api.turnOver(f))
    const h = api.undo(api.push(api.startHistory(f), step, frame))
    expect(api.current(h)).toBe(f)
    expect(api.current(h).faceOrders).toEqual(halfFolded().faceOrders)
    expect(windings(api.current(h))).toEqual(windings(halfFolded()))
  })

  test('a partial fold turns over physically: world x mirrored about the centre, z negated', () => {
    const g: Gesture = { tool: 'fold', grab: [0.05, 0.5], target: [0.25, 0.5], layers: 1, kind: 'valley', progress: 1 - Math.SQRT1_2, snapAngle: false }
    const partial: Frame = ok(api.commit(halfFolded(), g)).frame
    expect(partial.edges_foldAngle.some(a => close(Math.abs(a), 90, 1e-6))).toBe(true)
    const proj = foldedCoords(partial).map(p => p[0])
    const cx = (Math.min(...proj) + Math.max(...proj)) / 2
    const { frame } = ok(api.turnOver(partial))
    // world position of each (face, vertex id); turnOver reverses faces' vertex lists, so key by id
    const world = (fr: Frame) => {
      const ps = api.poses(fr)
      return fr.faces_vertices.map((vs, f) => new Map(vs.map(v => [v, applyPose(ps[f].matrix, fr.vertices_coords[v])])))
    }
    const a = world(partial)
    const b = world(frame)
    a.forEach((face, f) =>
      face.forEach(([x, y, z], v) => expect(near(b[f].get(v)!, [2 * cx - x, y, -z], 1e-9), `face ${f} vertex ${v}`).toBe(true)),
    )
    // the swung flap stood up toward +z; turned over, it hangs toward −z
    expect(Math.max(...a.flatMap(m => [...m.values()].map(q => q[2])))).toBeGreaterThan(0.1)
    expect(Math.min(...b.flatMap(m => [...m.values()].map(q => q[2])))).toBeLessThan(-0.1)
  })
})
