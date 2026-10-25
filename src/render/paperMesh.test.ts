import { describe, expect, test } from 'vitest'
import { commit, createPaper, layerRanks, PAPER_SIZES, poses, preview } from '@engine'
import type { FacePose, Frame, Gesture, Vec2 } from '@engine'
import { buildPaperGeometry, LAYER_GAP, layerOffsets } from './paperMesh'

const fold = (frame: Frame, grab: Vec2, target: Vec2, kind: 'valley' | 'mountain' = 'valley'): Frame => {
  const g: Gesture = { tool: 'fold', grab, target, layers: 1, kind, progress: 1, snapAngle: false }
  const r = commit(frame, g)
  if (!r.ok) throw new Error(r.reason)
  return r.frame
}

/** Unit square folded in half twice: four stacked layers. */
const quartered = () => fold(fold(createPaper(PAPER_SIZES.square), [0.9, 0.5], [0.1, 0.5]), [0.25, 0.95], [0.25, 0.05])

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Two unit squares side by side, joined by a flat edge, no layer order. */
function sideBySide(): Frame {
  return {
    vertices_coords: [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [1, 4]],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'F'],
    edges_foldAngle: [0, 0, 0, 0, 0, 0, 0],
    faces_vertices: [[0, 1, 4, 5], [1, 2, 3, 4]],
    faceOrders: [],
  }
}

/** z of the posed vertices of face `f` (geometry built non-indexed per face). */
function faceZ(frame: Frame, ps: FacePose[], f: number): number[] {
  const g = buildPaperGeometry(frame, ps)
  const tri = g.userData.triFace as Int32Array
  const pos = g.getAttribute('position')
  const zs: number[] = []
  tri.forEach((face, t) => {
    if (face === f) for (let k = 0; k < 3; k++) zs.push(pos.getZ(3 * t + k))
  })
  return zs
}

describe('buildPaperGeometry', () => {
  test('the UV of every vertex is its paper coordinate divided by the paper size', () => {
    for (const size of [PAPER_SIZES.square, PAPER_SIZES.a4]) {
      const sheet = createPaper(size)
      const frame = fold(sheet, [0.9 * size.width, 0.5], [0.1 * size.width, 0.5])
      const g = buildPaperGeometry(frame, poses(frame))
      const uv = g.getAttribute('uv')
      const coords = frame.vertices_coords
      expect(uv.count).toBeGreaterThan(0)
      for (let i = 0; i < uv.count; i++) {
        const paper: Vec2 = [uv.getX(i) * size.width, uv.getY(i) * size.height]
        const match = coords.some(c => Math.abs(c[0] - paper[0]) < 1e-6 && Math.abs(c[1] - paper[1]) < 1e-6)
        expect(match).toBe(true)
      }
    }
    // Flat sheet: identity pose, so position.xy is exactly uv × size.
    const flat = createPaper(PAPER_SIZES.a4)
    const g = buildPaperGeometry(flat, poses(flat))
    const uv = g.getAttribute('uv')
    const pos = g.getAttribute('position')
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i) * PAPER_SIZES.a4.width).toBeCloseTo(pos.getX(i), 6)
      expect(uv.getY(i) * PAPER_SIZES.a4.height).toBeCloseTo(pos.getY(i), 6)
    }
  })

  test('a face at layer 2 sits higher than a face at layer 0 along the normal, by 2 × 0.0015', () => {
    const frame = quartered()
    const ps = poses(frame)
    const ranks = layerRanks(frame)
    expect(ranks).toHaveLength(4)
    const f0 = ranks.indexOf(0)
    const f2 = ranks.indexOf(2)
    const z0 = faceZ(frame, ps, f0)
    const z2 = faceZ(frame, ps, f2)
    expect(LAYER_GAP).toBe(0.0015)
    for (const z of z0) expect(z).toBeCloseTo(0, 9)
    for (const z of z2) expect(z).toBeCloseTo(2 * 0.0015, 9)
  })

  test('the stack follows the engine order: every face sits at layerGap × its rank in a full stack', () => {
    const frame = quartered()
    const ranks = layerRanks(frame)
    const off = layerOffsets(frame, poses(frame), 0.002)
    ranks.forEach((r, f) => {
      expect(off.levels[f]).toBe(r)
      expect(off.offsets[3 * f + 2]).toBeCloseTo(0.002 * r, 9)
    })
  })

  test('faces side by side that do not overlap are not lifted', () => {
    const frame = sideBySide()
    const ps: FacePose[] = [{ face: 0, matrix: identity }, { face: 1, matrix: identity }]
    expect(layerOffsets(frame, ps).levels).toEqual([0, 0])
  })

  test('triangles face their posed front normal: a flat sheet faces +z, a flipped flap faces −z', () => {
    const half = fold(createPaper(PAPER_SIZES.square), [0.9, 0.5], [0.1, 0.5])
    const g = buildPaperGeometry(half, poses(half))
    const tri = g.userData.triFace as Int32Array
    const pos = g.getAttribute('position')
    const ranks = layerRanks(half)
    tri.forEach((face, t) => {
      const [ax, ay, bx, by, cx, cy] = [0, 1, 2].flatMap(k => [pos.getX(3 * t + k), pos.getY(3 * t + k)])
      const windingZ = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      // The root (bottom) keeps its front up; the folded-over half shows its back.
      expect(Math.sign(windingZ)).toBe(ranks[face] === 0 ? 1 : -1)
    })
  })

  test('during a drag the moving flap is lifted above the whole stationary stack', () => {
    const half = fold(createPaper(PAPER_SIZES.square), [0.9, 0.5], [0.1, 0.5])
    const g: Gesture = { tool: 'fold', grab: [0.1, 0.9], target: [0.1, 0.1], layers: 2, kind: 'valley', progress: 0.999, snapAngle: false }
    const r = preview(half, g)
    if (!r.ok) throw new Error(r.reason)
    const p = r.preview
    const off = layerOffsets(p.frame, p.poses, LAYER_GAP, { moving: p.moving, above: true })
    const stationary = p.frame.faces_vertices.map((_, f) => f).filter(f => !p.moving.includes(f))
    const top = Math.max(...stationary.map(f => off.offsets[3 * f + 2]!))
    for (const f of p.moving) expect(off.offsets[3 * f + 2]!).toBeGreaterThan(top)
    const below = layerOffsets(p.frame, p.poses, LAYER_GAP, { moving: p.moving, above: false })
    for (const f of p.moving) expect(below.offsets[3 * f + 2]!).toBeLessThan(0)
  })

  test('a partly opened multi-layer flap keeps its 180° layer order in its own frame, also across 90°', () => {
    // A half-folded sheet (2 layers), then the top half of both layers folded at 180°, 120° and 60°.
    const half = fold(createPaper(PAPER_SIZES.square), [0.9, 0.5], [0.1, 0.5])
    const at = (angleDeg: number) => {
      const g: Gesture = { tool: 'fold', grab: [0.25, 0.95], target: [0.25, 0.05], layers: 2, kind: 'valley', progress: 1, snapAngle: false, angleDeg }
      const r = commit(half, g)
      if (!r.ok) throw new Error(r.reason)
      return r.frame
    }
    /** The flap's two faces (paper y > 0.5) and the sign of (a − b) along a's front normal: fixed in the flap's frame. */
    const order = (frame: Frame) => {
      const ps = poses(frame)
      const lo = layerOffsets(frame, ps)
      const flap = frame.faces_vertices
        .map((vs, f) => ({ f, y: vs.reduce((s, v) => s + frame.vertices_coords[v]![1], 0) / vs.length }))
        .filter(x => x.y > 0.5)
        .map(x => x.f)
        .sort((p, q) => p - q)
      expect(flap).toHaveLength(2)
      const [a, b] = flap as [number, number]
      const m = ps.find(p => p.face === a)!.matrix
      const n = [m[8]!, m[9]!, m[10]!]
      const d = [0, 1, 2].map(k => lo.offsets[3 * a + k]! - lo.offsets[3 * b + k]!)
      return Math.sign(d[0]! * n[0]! + d[1]! * n[1]! + d[2]! * n[2]!)
    }
    const flat = order(at(180))
    expect(flat).not.toBe(0)
    expect(order(at(120))).toBe(flat)
    expect(order(at(60))).toBe(flat)
  })
})
