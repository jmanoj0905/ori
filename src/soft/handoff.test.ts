import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, commit, createPaper, current, push, startHistory, undo, type Frame } from '@engine'
import { enterSoft, leaveSoft } from './handoff'
import { SoftSolver } from './xpbd'
import { SOFT_PARAMS } from './session'

const halfAt90 = (): Frame => {
  const r = commit(createPaper(PAPER_SIZES.square), { tool: 'fold', grab: [0.9, 0.5], target: [0.1, 0.5], layers: 1, kind: 'valley', progress: 1, snapAngle: false, angleDeg: 90 })
  if (!r.ok) throw new Error(r.reason)
  return r.frame
}

describe('rigid ↔ soft hand-off', () => {
  test('rigid to soft and back with no edits gives the identical frame', () => {
    for (const f of [createPaper(PAPER_SIZES.square), halfAt90()]) {
      const mesh = enterSoft(f)
      const out = leaveSoft(f, mesh, mesh.positions)
      expect(out.kind).toBe('exact')
      expect(out.frame).toBe(f)
    }
  })

  test('a flat sheet left to settle on the desk is still flat-foldable: it snaps back to the exact frame', () => {
    const f = createPaper(PAPER_SIZES.square)
    const mesh = enterSoft(f, 0.08)
    const s = new SoftSolver(mesh, SOFT_PARAMS)
    for (let k = 0; k < 60; k++) s.step(1 / 60)
    expect(leaveSoft(f, mesh, s.positions())).toEqual({ kind: 'exact', frame: f })
  })

  test('a shape that is no longer a rigid folded state becomes a sculpted step with a mesh snapshot', () => {
    const f = halfAt90()
    const mesh = enterSoft(f, 0.08)
    const s = new SoftSolver(mesh, { ...SOFT_PARAMS, wet: true, collide: false })
    // lift the standing flap's free edge into a curl
    for (let i = 0; i < mesh.uv.length / 2; i++)
      if (mesh.uv[2 * i]! > 0.999) s.pin(i, [mesh.positions[3 * i]! - 0.2, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]! - 0.15])
    for (let k = 0; k < 90; k++) s.step(1 / 60)
    const positions = s.positions()
    const out = leaveSoft(f, mesh, positions)
    expect(out.kind).toBe('sculpted')
    if (out.kind !== 'sculpted') return
    expect(out.step.kind).toBe('sculpted')
    const snap = out.frame.ori_sculpt as { positions: number[]; tris: number[]; uv: number[] }
    expect(snap.positions).toHaveLength(positions.length)
    snap.positions.forEach((x, i) => expect(Math.abs(x - positions[i]!)).toBeLessThan(1e-6))
    expect(snap.tris).toEqual(Array.from(mesh.tris))
    // undo across the boundary restores the exact rigid frame (Review Focus 4)
    const h = push(push(startHistory(createPaper(PAPER_SIZES.square)), { kind: 'fold', params: {}, label: 'fold', at: 0 }, f), out.step, out.frame)
    expect(current(undo(h))).toBe(f)
  })
})
