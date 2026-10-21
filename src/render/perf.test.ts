// Render-side cost at 300 faces (spec 02: 60 fps while dragging a 300-face
// model; target: the per-move rebuild well under 8 ms). Worst case for the
// layer walk: a fully stacked accordion, every face over every other.
import { describe, expect, test } from 'vitest'
import { poses } from '@engine'
import type { Frame, Vec2 } from '@engine'
import { buildCreaseLines, buildCreaseShade, buildLiveCrease } from './creases'
import { buildPaperGeometry, LAYER_GAP, layerOffsets } from './paperMesh'

/** A unit square accordion-folded into n strips (built directly, no layer solve). */
function accordion(n: number): Frame {
  const vertices_coords: Vec2[] = []
  const edges_vertices: [number, number][] = []
  const edges_assignment: string[] = []
  const edges_foldAngle: number[] = []
  const faces_vertices: number[][] = []
  const faceOrders: [number, number, number][] = []
  for (let i = 0; i <= n; i++) vertices_coords.push([i / n, 0], [i / n, 1])
  for (let i = 0; i < n; i++) {
    edges_vertices.push([2 * i, 2 * i + 2], [2 * i + 1, 2 * i + 3])
    edges_assignment.push('B', 'B')
    edges_foldAngle.push(0, 0)
    faces_vertices.push([2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1])
  }
  for (let i = 0; i <= n; i++) {
    edges_vertices.push([2 * i, 2 * i + 1])
    const boundary = i === 0 || i === n
    const valley = i % 2 === 1
    edges_assignment.push(boundary ? 'B' : valley ? 'V' : 'M')
    edges_foldAngle.push(boundary ? 0 : valley ? 180 : -180)
    if (!boundary) faceOrders.push([i - 1, i, valley ? 1 : -1])
  }
  return { vertices_coords, edges_vertices, edges_assignment, edges_foldAngle, faces_vertices, faceOrders }
}

const time = (f: () => void, runs = 5): number => {
  f() // warm
  const t0 = performance.now()
  for (let i = 0; i < runs; i++) f()
  return (performance.now() - t0) / runs
}

describe('render build cost at 300 faces', () => {
  const frame = accordion(300)
  const ps = poses(frame)

  test('the stack is levelled 0..299 (every strip over the one below)', () => {
    const lo = layerOffsets(frame, ps)
    expect([...lo.levels].sort((a, b) => a - b)).toEqual(Array.from({ length: 300 }, (_, i) => i))
  })

  test('committed build and per-move preview rebuild', () => {
    const committed = time(() => {
      const lo = layerOffsets(frame, ps, LAYER_GAP)
      buildPaperGeometry(frame, ps, LAYER_GAP, { offsets: lo.offsets })
      buildCreaseShade(frame, ps, { offsets: lo.offsets })
      buildCreaseLines(frame, ps, { offsets: lo.offsets, levels: lo.levels })
    })
    const moving = Array.from({ length: 150 }, (_, i) => 150 + i)
    const perMove = time(() => {
      const lo = layerOffsets(frame, ps, LAYER_GAP, { moving, above: true })
      buildPaperGeometry(frame, ps, LAYER_GAP, { offsets: lo.offsets, faces: moving })
      buildCreaseLines(frame, ps, { offsets: lo.offsets, levels: lo.levels, faces: moving })
      buildLiveCrease([[[0, 0.5], [1, 0.5]]], 'valley', '#B23A22')
    })
    // A drag usually changes the crease, so Preview.frame is a new object on
    // most moves: nothing cached, stationary part rebuilt too.
    const stationary = Array.from({ length: 150 }, (_, i) => i)
    const perMoveNewFrame = time(() => {
      const f = { ...frame }
      const lo = layerOffsets(f, ps, LAYER_GAP, { moving, above: true })
      buildPaperGeometry(f, ps, LAYER_GAP, { offsets: lo.offsets, faces: stationary })
      buildCreaseShade(f, ps, { offsets: lo.offsets, faces: stationary })
      buildCreaseLines(f, ps, { offsets: lo.offsets, levels: lo.levels, faces: stationary })
      buildPaperGeometry(f, ps, LAYER_GAP, { offsets: lo.offsets, faces: moving })
      buildCreaseLines(f, ps, { offsets: lo.offsets, levels: lo.levels, faces: moving })
      buildLiveCrease([[[0, 0.5], [1, 0.5]]], 'valley', '#B23A22')
    })
    console.log(
      `300 faces: committed build ${committed.toFixed(2)} ms, per-move preview ${perMove.toFixed(2)} ms (same frame), ` +
        `${perMoveNewFrame.toFixed(2)} ms (new Preview.frame)`,
    )
    // Generous bounds for CI machines; the measured numbers are in the log.
    expect(committed).toBeLessThan(40)
    expect(perMove).toBeLessThan(20)
    expect(perMoveNewFrame).toBeLessThan(40)
  })
})
