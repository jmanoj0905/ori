import { describe, expect, test } from 'vitest'
import { frameFromFold } from '@engine'
import { createPaper, PAPER_SIZES } from '@engine'
import { halfFolded } from './testkit'

const sheet = () => JSON.parse(JSON.stringify(createPaper(PAPER_SIZES.square)))

describe('frameFromFold', () => {
  test('accepts a frame and keeps faces, assignments, angles and orders', () => {
    const f = halfFolded()
    const r = frameFromFold(JSON.parse(JSON.stringify(f)))
    if (!r.ok) throw new Error(r.reason)
    expect(r.frame.faces_vertices).toEqual(f.faces_vertices)
    expect(r.frame.edges_assignment).toEqual(f.edges_assignment)
    expect(r.frame.edges_foldAngle).toEqual(f.edges_foldAngle)
    expect(r.frame.faceOrders).toEqual(f.faceOrders)
    expect(r.frame.vertices_coords).toEqual(f.vertices_coords)
  })

  test('fills missing edges_foldAngle from assignments (V +180, M -180, else 0)', () => {
    const j = sheet()
    j.vertices_coords = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0], [0.5, 1]]
    j.edges_vertices = [[0, 4], [4, 1], [1, 2], [2, 5], [5, 3], [3, 0], [4, 5]]
    j.edges_assignment = ['B', 'B', 'B', 'B', 'B', 'B', 'V']
    j.faces_vertices = [[0, 4, 5, 3], [4, 1, 2, 5]]
    delete j.edges_foldAngle
    delete j.faceOrders
    let r = frameFromFold(j)
    if (!r.ok) throw new Error(r.reason)
    expect(r.frame.edges_foldAngle).toEqual([0, 0, 0, 0, 0, 0, 180])
    expect(r.frame.faceOrders).toEqual([])
    j.edges_assignment[6] = 'M'
    r = frameFromFold(j)
    if (!r.ok) throw new Error(r.reason)
    expect(r.frame.edges_foldAngle[6]).toBe(-180)
  })

  test('reads the first frame of a file with no top-level geometry', () => {
    const inner = sheet()
    const r = frameFromFold({ file_spec: 1.2, file_frames: [inner] })
    expect(r.ok).toBe(true)
  })

  test('prefers top-level geometry over file_frames', () => {
    const top = sheet()
    top.file_frames = [{ vertices_coords: [] }]
    expect(frameFromFold(top).ok).toBe(true)
  })

  test('drops invalid faceOrders but keeps the frame', () => {
    const j = sheet()
    j.faceOrders = [[0, 9, 1]]
    const r = frameFromFold(j)
    if (!r.ok) throw new Error(r.reason)
    expect(r.frame.faceOrders).toEqual([])
  })

  test('refuses malformed input with a reason', () => {
    const bad: [string, (j: any) => void][] = [
      ['not an object', () => {}],
      ['missing vertices', j => delete j.vertices_coords],
      ['missing edges', j => delete j.edges_vertices],
      ['missing faces', j => delete j.faces_vertices],
      ['missing assignment', j => delete j.edges_assignment],
      ['non-finite coordinate', j => (j.vertices_coords[0][0] = null)],
      ['NaN-ish string', j => (j.vertices_coords[0][1] = 'x')],
      ['edge index out of range', j => (j.edges_vertices[0][1] = 99)],
      ['degenerate edge', j => (j.edges_vertices[0] = [1, 1])],
      ['fractional index', j => (j.edges_vertices[0][0] = 0.5)],
      ['assignment length mismatch', j => j.edges_assignment.pop()],
      ['unknown assignment', j => (j.edges_assignment[0] = 'Q')],
      ['foldAngle length mismatch', j => (j.edges_foldAngle = [0])],
      ['non-finite foldAngle', j => (j.edges_foldAngle[0] = 'a')],
      ['face with 2 vertices', j => (j.faces_vertices[0] = [0, 1])],
      ['face vertex out of range', j => (j.faces_vertices[0][0] = 40)],
      ['3D coordinates', j => (j.vertices_coords[0] = [0, 0, 1])],
    ]
    for (const [name, mutate] of bad) {
      const j = sheet()
      mutate(j)
      const r = frameFromFold(name === 'not an object' ? 42 : j)
      expect(r.ok, name).toBe(false)
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
    }
  })

  test('flat z = 0 coordinates are accepted and flattened', () => {
    const j = sheet()
    j.vertices_coords = j.vertices_coords.map((p: number[]) => [...p, 0])
    const r = frameFromFold(j)
    if (!r.ok) throw new Error(r.reason)
    expect(r.frame.vertices_coords[2]).toEqual([1, 1])
  })

  test('does not alias the input', () => {
    const j = sheet()
    const r = frameFromFold(j)
    if (!r.ok) throw new Error(r.reason)
    j.vertices_coords[0][0] = 5
    expect(r.frame.vertices_coords[0][0]).toBe(0)
  })
})
