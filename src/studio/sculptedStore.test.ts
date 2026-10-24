import { describe, expect, test } from 'vitest'
import { SCULPTED, current, sculpt } from '@engine'
import { createStudioStore } from './store'
import { inProcessCommitter } from './committer'

const snap = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0.2], tris: [0, 1, 2], uv: [0, 0, 1, 0, 0, 1] }

describe('a sculpted step in the studio (spec 08)', () => {
  test('pushStep adds it; folds and turn over are refused on it; undo is back on the exact frame', async () => {
    const s = createStudioStore({ committer: inProcessCommitter })
    s.getState().begin([0.95, 0.5])
    s.getState().drag([0.05, 0.5], 1)
    expect(await s.getState().release()).toBe(true)
    const rigid = current(s.getState().history)
    const r = sculpt(rigid, snap)
    if (!r.ok) throw new Error(r.reason)
    expect(s.getState().pushStep(r.step, r.frame)).toBe(true)
    expect(s.getState().history.steps.map(x => x.kind)).toEqual(['fold', 'sculpted'])
    // a fold on the sculpted shape is refused with the reason
    s.getState().begin([0.3, 0.9])
    s.getState().drag([0.3, 0.1], 1)
    expect(s.getState().refusal).toBe(SCULPTED)
    s.getState().cancel()
    expect(await s.getState().turnOver()).toBe(false)
    expect(s.getState().refusal).toBe(SCULPTED)
    // undo across the boundary: the exact rigid frame, foldable again
    s.getState().undo()
    expect(current(s.getState().history)).toBe(rigid)
    s.getState().begin([0.3, 0.9])
    s.getState().drag([0.3, 0.1], 1)
    expect(s.getState().refusal).toBeNull()
  })
})
