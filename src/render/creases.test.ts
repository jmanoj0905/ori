import { describe, expect, test } from 'vitest'
import { commit, createPaper, PAPER_SIZES, poses } from '@engine'
import type { Frame, Gesture, Vec2 } from '@engine'
import { buildCreaseLines, buildCreaseShade, CREASE_LIFT, DASH } from './creases'
import { LAYER_GAP } from './paperMesh'

const fold = (frame: Frame, grab: Vec2, target: Vec2, kind: 'valley' | 'mountain'): Frame => {
  const g: Gesture = { tool: 'fold', grab, target, layers: 1, kind, progress: 1, snapAngle: false }
  const r = commit(frame, g)
  if (!r.ok) throw new Error(r.reason)
  return r.frame
}

describe('buildCreaseLines', () => {
  test('a valley fold has 1 valley segment and 0 mountain segments', () => {
    const frame = fold(createPaper(PAPER_SIZES.square), [0.9, 0.5], [0.1, 0.5], 'valley')
    const { valley, mountain } = buildCreaseLines(frame, poses(frame))
    expect(valley.segments).toBe(1)
    expect(mountain.segments).toBe(0)
  })

  test('a mountain fold has 1 mountain segment and 0 valley segments', () => {
    const frame = fold(createPaper(PAPER_SIZES.square), [0.9, 0.5], [0.1, 0.5], 'mountain')
    const { valley, mountain } = buildCreaseLines(frame, poses(frame))
    expect(valley.segments).toBe(0)
    expect(mountain.segments).toBe(1)
  })

  test('the segment lies on the crease, in world space', () => {
    const frame = fold(createPaper(PAPER_SIZES.square), [0.9, 0.5], [0.1, 0.5], 'valley')
    const { valley } = buildCreaseLines(frame, poses(frame))
    const a = valley.geometry.getAttribute('aStart')
    const b = valley.geometry.getAttribute('aEnd')
    expect(a.getX(0)).toBeCloseTo(0.5, 9)
    expect(b.getX(0)).toBeCloseTo(0.5, 9)
    expect([a.getY(0), b.getY(0)].sort()).toEqual([0, 1])
  })

  test('the ribbon quad spans both sides at both ends of the segment', () => {
    const frame = fold(createPaper(PAPER_SIZES.square), [0.9, 0.5], [0.1, 0.5], 'valley')
    const { valley } = buildCreaseLines(frame, poses(frame))
    const pos = valley.geometry.getAttribute('position')
    const index = valley.geometry.getIndex()!
    const corners = new Set<string>()
    for (let i = 0; i < index.count; i++) {
      const v = index.getX(i)
      corners.add(`${pos.getX(v)},${pos.getY(v)}`)
    }
    expect([...corners].sort()).toEqual(['0,-1', '0,1', '1,-1', '1,1'])
  })

  test('creases sit 0.3 × gap above their face: over it, but under the next layer (hidden creases stay hidden at any tilt)', () => {
    const half = fold(createPaper(PAPER_SIZES.square), [0.9, 0.5], [0.1, 0.5], 'valley')
    const quartered = fold(half, [0.25, 0.95], [0.25, 0.05], 'valley')
    const { valley, mountain } = buildCreaseLines(quartered, poses(quartered))
    expect(CREASE_LIFT).toBe(0.3)
    let n = 0
    for (const set of [valley, mountain]) {
      for (const name of ['aStart', 'aEnd']) {
        const a = set.geometry.getAttribute(name)
        for (let i = 0; i < a.count; i++) {
          const layers = a.getZ(i) / LAYER_GAP // flat model: up = +z, face at level × gap
          expect(layers - Math.floor(layers)).toBeCloseTo(CREASE_LIFT, 4)
          n++
        }
      }
    }
    expect(n).toBeGreaterThan(0)
  })

  test('an unfolded sheet has no creases', () => {
    const sheet = createPaper(PAPER_SIZES.square)
    const { valley, mountain } = buildCreaseLines(sheet, poses(sheet))
    expect(valley.segments + mountain.segments).toBe(0)
  })
})

describe('DASH', () => {
  test('the two dash patterns differ (valley dashed, mountain dash-dot), in px', () => {
    expect(DASH.valley).toEqual([6, 4])
    expect(DASH.mountain).toEqual([6, 3, 1.5, 3])
    expect(DASH.valley).not.toEqual(DASH.mountain)
  })

  test('each crease material carries its own pattern, so valley and mountain differ by more than colour', () => {
    const frame = fold(createPaper(PAPER_SIZES.square), [0.9, 0.5], [0.1, 0.5], 'valley')
    const { valley, mountain } = buildCreaseLines(frame, poses(frame))
    const v = valley.material.uniforms.uDash!.value
    const m = mountain.material.uniforms.uDash!.value
    expect([v.x, v.y, v.z, v.w]).toEqual([6, 4, 0, 0])
    expect([m.x, m.y, m.z, m.w]).toEqual([6, 3, 1.5, 3])
    expect(valley.material.uniforms.uColor!.value.equals(mountain.material.uniforms.uColor!.value)).toBe(true)
  })
})

describe('buildCreaseShade', () => {
  test('one strip per side of each folded hinge; none on a flat sheet', () => {
    const sheet = createPaper(PAPER_SIZES.square)
    expect(buildCreaseShade(sheet, poses(sheet)).getAttribute('position')?.count ?? 0).toBe(0)
    const frame = fold(sheet, [0.9, 0.5], [0.1, 0.5], 'valley')
    const g = buildCreaseShade(frame, poses(frame))
    // 2 faces × 1 quad × 2 triangles × 3 vertices
    expect(g.getAttribute('position').count).toBe(12)
  })
})
