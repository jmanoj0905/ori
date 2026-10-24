import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, commit, createPaper, current, push, startHistory, turnOver, undo, type Gesture } from '.'
import { BAD_SNAPSHOT, SCULPTED, sculpt, sculptOf, validSnapshot } from './sculpt'
import { preview } from './ops'

const snap = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0.2], tris: [0, 1, 2], uv: [0, 0, 1, 0, 0, 1] }
const g: Gesture = { tool: 'fold', grab: [0.9, 0.5], target: [0.1, 0.5], layers: 1, kind: 'valley', progress: 1, snapAngle: false }

describe('sculpted steps', () => {
  test('a sculpted frame is the rigid frame plus its snapshot; undo restores the exact rigid frame', () => {
    const sheet = createPaper(PAPER_SIZES.square)
    const one = commit(sheet, g)
    if (!one.ok) throw new Error(one.reason)
    let h = push(startHistory(sheet), one.step, one.frame)
    const rigid = current(h)
    const r = sculpt(rigid, snap)
    if (!r.ok) throw new Error(r.reason)
    expect(r.step.kind).toBe('sculpted')
    expect(sculptOf(r.frame)).toEqual(snap)
    expect(r.frame.faces_vertices).toBe(rigid.faces_vertices) // the rigid frame underneath is kept
    h = push(h, r.step, r.frame)
    expect(current(undo(h))).toBe(rigid) // the very same exact frame
    expect(sculptOf(current(undo(h)))).toBeNull()
  })

  test('folds on a sculpted frame are refused; the snapshot is validated', () => {
    const r = sculpt(createPaper(PAPER_SIZES.square), snap)
    if (!r.ok) throw new Error(r.reason)
    expect(commit(r.frame, g)).toEqual({ ok: false, reason: SCULPTED })
    expect(preview(r.frame, g)).toEqual({ ok: false, reason: SCULPTED })
    expect(validSnapshot({ ...snap, tris: [0, 1, 9] })).toBe(false)
    expect(validSnapshot({ ...snap, uv: [0, 0] })).toBe(false)
    expect(validSnapshot({ ...snap, positions: [0, 0, NaN, 1, 0, 0, 0, 1, 0] })).toBe(false)
    expect(sculpt(createPaper(PAPER_SIZES.square), { ...snap, tris: [] })).toEqual({ ok: false, reason: BAD_SNAPSHOT })
    void turnOver
  })
})
