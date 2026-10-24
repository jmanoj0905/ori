import { describe, expect, test } from 'vitest'
import { foldPattern, patternFrame, PATTERN_DANGLING, PATTERN_NO_ORDER } from './pattern'
import { aboveGraph, facesAt, foldedPolygons } from './layers'
import { baseFrame } from './rabbit'
import { area } from './testkit'
import type { Frame } from './types'

/** A crease pattern: the geometry and assignments only (no faces, no orders). */
const cpOf = (f: Frame): Frame => ({
  vertices_coords: f.vertices_coords,
  edges_vertices: f.edges_vertices,
  edges_assignment: f.edges_assignment,
  edges_foldAngle: f.edges_assignment.map(() => 0),
  faces_vertices: [],
  faceOrders: [],
})

function ok<T>(r: ({ ok: true } & T) | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r
}

/** Every pair of faces stacked at a face's folded centroid is ordered, directly or transitively. */
function stacksOrdered(frame: Frame): boolean {
  const above = aboveGraph(frame)
  const reach = (a: number, b: number) => {
    const seen = new Set([a])
    const todo = [a]
    while (todo.length) {
      for (const n of above.get(todo.pop()!) ?? []) {
        if (n === b) return true
        if (!seen.has(n)) seen.add(n), todo.push(n)
      }
    }
    return false
  }
  const { polys } = foldedPolygons(frame)
  return polys.every(poly => {
    const c = poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length], [0, 0])
    const stack = facesAt(frame, c as [number, number])
    return stack.every((f, i) => stack.slice(i + 1).every(g => reach(f, g) || reach(g, f)))
  })
}

describe('crease patterns in the engine', () => {
  test('patternFrame builds the faces of an unfolded pattern', () => {
    const f = ok(patternFrame(cpOf(baseFrame('waterbomb')))).frame
    expect(f.faces_vertices.length).toBe(baseFrame('waterbomb').faces_vertices.length)
    expect(area(f)).toBeCloseTo(1, 12)
    expect(f.edges_foldAngle.every(a => a === 0)).toBe(true)
    expect(f.faceOrders).toEqual([])
  })

  test.each(['waterbomb', 'bird'] as const)('foldPattern collapses the %s base with a valid layer order', name => {
    const f = ok(foldPattern(cpOf(baseFrame(name)))).frame
    expect(f.faceOrders.length).toBeGreaterThan(0)
    expect(f.edges_foldAngle.every((a, e) => (f.edges_assignment[e] === 'V' ? a === 180 : f.edges_assignment[e] === 'M' ? a === -180 : a === 0))).toBe(true)
    expect(stacksOrdered(f)).toBe(true)
  })

  test('unassigned creases stay unfolded and keep their assignment', () => {
    const cp: Frame = {
      vertices_coords: [[0, 0], [0.5, 0], [1, 0], [1, 1], [0.5, 1], [0, 1]],
      edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [1, 4]],
      edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'U'],
      edges_foldAngle: [0, 0, 0, 0, 0, 0, 0],
      faces_vertices: [],
      faceOrders: [],
    }
    const f = ok(foldPattern(cp)).frame
    expect(f.faces_vertices).toHaveLength(2)
    expect(f.edges_assignment.filter(a => a === 'U')).toHaveLength(1)
    expect(f.edges_foldAngle.every(a => a === 0)).toBe(true)
  })

  test('a pattern with no layer order is refused', () => {
    // four valleys meeting at the centre: no flat folded state exists
    const cross: Frame = {
      vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]],
      edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]],
      edges_assignment: ['B', 'B', 'B', 'B', 'V', 'V', 'V', 'V'],
      edges_foldAngle: [0, 0, 0, 0, 0, 0, 0, 0],
      faces_vertices: [],
      faceOrders: [],
    }
    expect(foldPattern(cross)).toEqual({ ok: false, reason: PATTERN_NO_ORDER })
  })

  test('a crease ending inside a face is refused', () => {
    // a single valley ending in the middle of the sheet cannot fold flat
    const cp: Frame = {
      vertices_coords: [[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]],
      edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [1, 5]],
      edges_assignment: ['B', 'B', 'B', 'B', 'B', 'V'],
      edges_foldAngle: [0, 0, 0, 0, 0, 0],
      faces_vertices: [],
      faceOrders: [],
    }
    expect(foldPattern(cp)).toEqual({ ok: false, reason: PATTERN_DANGLING })
  })
})
