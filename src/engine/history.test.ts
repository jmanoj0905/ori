import { describe, expect, it } from 'vitest'
import type { Frame } from './types'
import { branch, canRedo, canUndo, current, jumpTo, push, redo, startHistory, undo, type Step } from './history'

const frame = (n: number): Frame => ({
  vertices_coords: [[n, 0]],
  edges_vertices: [],
  edges_assignment: [],
  edges_foldAngle: [],
  faces_vertices: [],
  faceOrders: [],
})
const step = (label: string): Step => ({ kind: 'fold', params: {}, label, at: 0 })

const build = () => {
  const fs = [frame(0), frame(1), frame(2), frame(3)]
  let h = startHistory(fs[0])
  h = push(h, step('a'), fs[1])
  h = push(h, step('b'), fs[2])
  h = push(h, step('c'), fs[3])
  return { h, fs }
}

describe('history', () => {
  it('starts at the blank sheet', () => {
    const h = startHistory(frame(0))
    expect(h.cursor).toBe(0)
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })
  it('push advances the cursor', () => {
    const { h, fs } = build()
    expect(h.cursor).toBe(3)
    expect(current(h)).toBe(fs[3])
    expect(h.steps.length).toBe(3)
  })
  it('undo then redo returns the same frame', () => {
    const { h } = build()
    const u = undo(h)
    expect(u.cursor).toBe(2)
    expect(canRedo(u)).toBe(true)
    expect(current(redo(u))).toBe(current(h))
  })
  it('push after undo drops redo entries', () => {
    const { h } = build()
    const n = push(undo(undo(h)), step('d'), frame(9))
    expect(n.steps.length).toBe(2)
    expect(n.frames.length).toBe(3)
    expect(n.cursor).toBe(2)
    expect(canRedo(n)).toBe(false)
  })
  it('jumpTo selects a frame and clamps out-of-range', () => {
    const { h, fs } = build()
    expect(current(jumpTo(h, 2))).toBe(fs[2])
    expect(jumpTo(h, 99).cursor).toBe(3)
    expect(jumpTo(h, -5).cursor).toBe(0)
  })
  it('undo at 0 and redo at end are no-ops', () => {
    const h = startHistory(frame(0))
    expect(undo(h).cursor).toBe(0)
    const { h: full } = build()
    expect(redo(full).cursor).toBe(3)
  })
  it('never mutates inputs and returns frozen histories', () => {
    const { h } = build()
    const before = { frames: [...h.frames], steps: [...h.steps], cursor: h.cursor }
    const u = undo(h)
    push(u, step('x'), frame(7))
    expect(h.frames).toEqual(before.frames)
    expect(h.steps).toEqual(before.steps)
    expect(h.cursor).toBe(before.cursor)
    for (const x of [h, u, startHistory(frame(0))]) {
      expect(Object.isFrozen(x)).toBe(true)
      expect(Object.isFrozen(x.frames)).toBe(true)
      expect(Object.isFrozen(x.steps)).toBe(true)
    }
  })
})

describe('jumpTo with a non-finite index (final review 1)', () => {
  it('keeps the cursor', () => {
    const { h } = build()
    const u = undo(h)
    for (const i of [NaN, Infinity, -Infinity]) expect(jumpTo(u, i)).toBe(u)
  })
})

describe('branch (Plan 5: editing the crease pattern after folding)', () => {
  const cp = (n: number): Frame => ({ ...frame(n), edges_assignment: ['V'], edges_vertices: [[0, 0]], edges_foldAngle: [0] })

  it('continues from the cursor with a pattern step and keeps the original history whole', () => {
    const { h, fs } = build()
    const back = undo(h) // cursor 2, one redo step
    const b = branch(back, cp(9))
    expect(b.cursor).toBe(3)
    expect(b.frames.slice(0, 3)).toEqual(fs.slice(0, 3)) // earlier steps are never rewritten
    expect(b.frames[0]).toBe(fs[0])
    expect(b.steps.at(-1)).toMatchObject({ kind: 'pattern', label: 'Crease pattern', params: { folded: false } })
    expect(b.branchOf).toBe(back)
    expect(back.frames).toHaveLength(4) // the redo step of the original is still there
    expect(current(b)).toEqual(cp(9))
  })

  it('a folded pattern is labelled as Fold all', () => {
    const folded = { ...cp(9), edges_foldAngle: [180] }
    expect(branch(startHistory(frame(0)), folded).steps[0]).toMatchObject({ kind: 'pattern', label: 'Fold all', params: { folded: true } })
  })

  it('the pattern step records the crease pattern, so it can be replayed', () => {
    const b = branch(startHistory(frame(0)), cp(9))
    expect(b.steps[0]!.params).toEqual({ folded: false, cp: { vertices_coords: [[9, 0]], edges_vertices: [[0, 0]], edges_assignment: ['V'] } })
  })

  it('moving or pushing on a branch keeps the link to the original', () => {
    const { h } = build()
    const b = branch(h, cp(9))
    expect(undo(b).branchOf).toBe(h)
    expect(push(b, step('d'), frame(5)).branchOf).toBe(h)
    expect(startHistory(frame(0)).branchOf).toBeUndefined()
  })
})
