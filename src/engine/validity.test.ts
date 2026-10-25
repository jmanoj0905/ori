// Preview.valid (final review 3): whether committing the same gesture would
// pass the layer-order check.
import { describe, expect, test } from 'vitest'
import { commit, preview, type Gesture } from './ops'
import { makeSheet } from './rabbit'
import { accordion, base, doubleTriangle, halfFolded, preliminary } from './testkit'
import type { Frame, Vec2 } from './types'

const sheet = () => makeSheet({ width: 1, height: 1 })
const NO_ORDER = 'No valid layer order exists for this fold.'

const fold = (over: Partial<Gesture> & Pick<Gesture, 'grab' | 'target'>): Gesture => ({
  tool: 'fold',
  layers: 1,
  kind: 'valley',
  progress: 1,
  snapAngle: false,
  ...over,
})

function ok<T>(r: ({ ok: true } & T) | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r
}

describe('Preview.valid', () => {
  test('a flat fold with a layer order is valid', () => {
    expect(ok(preview(sheet(), fold({ grab: [0.9, 0.5], target: [0.1, 0.5] }))).preview.valid).toBe(true)
    expect(ok(preview(halfFolded(), fold({ grab: [0.25, 0.9], target: [0.25, 0.1], layers: 2 }))).preview.valid).toBe(true)
  })

  test('a partial fold is valid: its commit takes no layer solve', () => {
    const pv = ok(preview(sheet(), fold({ grab: [0.9, 0.5], target: [0.1, 0.5], progress: 0.4 }))).preview
    expect(pv.angleDeg).toBeLessThan(180)
    expect(pv.valid).toBe(true)
  })

  test('a flat fold that has no layer order previews invalid, and its commit is refused', () => {
    // one layer of the doubly folded triangle folded through the others
    const g = fold({ grab: [0.9, 0.1], target: [0.8, 0.6] })
    expect(ok(preview(doubleTriangle(), g)).preview.valid).toBe(false)
    expect(commit(doubleTriangle(), g)).toEqual({ ok: false, reason: NO_ORDER })
    // the same fold left partial is fine
    expect(ok(preview(doubleTriangle(), { ...g, progress: 0.3 })).preview.valid).toBe(true)
  })

  test('a reverse fold with no layer order previews invalid (R15: previously never checked)', () => {
    const g: Gesture = { ...fold({ grab: [0.5, 0.1], target: [0.55, 0.6] }), tool: 'reverse', kind: 'mountain' }
    expect(ok(preview(preliminary(), g)).preview.valid).toBe(false)
    expect(commit(preliminary(), g)).toEqual({ ok: false, reason: NO_ORDER })
  })

  test('compound folds that commit preview valid', () => {
    const g: Gesture = { ...fold({ grab: [0.95, 0.1], target: [0.95, 0.4] }), tool: 'reverse', layers: 4 }
    expect(ok(preview(doubleTriangle(), g)).preview.valid).toBe(true)
    expect(commit(doubleTriangle(), g).ok).toBe(true)
  })

  test('unfolding over a hinge (landing flat) is checked; a partial hinge swing is valid', () => {
    const g = fold({ grab: [0.1, 0.5], target: [0.9, 0.5] })
    const flat = ok(preview(halfFolded(), g)).preview
    expect(flat.moving).toEqual([1])
    expect(flat.valid).toBe(true)
    expect(ok(preview(halfFolded(), { ...g, progress: 0.3 })).preview.valid).toBe(true)
  })

  test("a large model's flat preview is 'unknown': no full layer solve per pointer move", () => {
    const big = accordion(24)
    const pv = ok(preview(big, fold({ grab: [0.02, 0.2], target: [0.02, 0.8], layers: 24 }))).preview
    expect(pv.frame.faces_vertices.length).toBeGreaterThan(24)
    expect(pv.valid).toBe('unknown')
    // a partial fold of it needs no solve, so it is still known
    expect(ok(preview(big, fold({ grab: [0.02, 0.2], target: [0.02, 0.8], layers: 24, progress: 0.3 }))).preview.valid).toBe(true)
  })

  test('valid agrees with commit on random gestures over small models', () => {
    let seed = 11
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const pt = (): Vec2 => [Math.round(rnd() * 20) / 20, Math.round(rnd() * 20) / 20]
    const frames: Frame[] = [halfFolded(), doubleTriangle(), preliminary(), base('waterbomb')]
    let checked = 0
    let invalid = 0
    for (const f of frames)
      for (const tool of ['fold', 'reverse'] as const)
        for (let i = 0; i < 60; i++) {
          const g: Gesture = {
            ...fold({ grab: pt(), target: pt() }),
            tool,
            layers: 1 + Math.floor(rnd() * 4),
            kind: rnd() < 0.5 ? 'valley' : 'mountain',
          }
          const p = preview(f, g)
          if (!p.ok) continue
          const c = commit(f, g)
          expect(p.preview.valid, JSON.stringify(g)).not.toBe('unknown')
          if (p.preview.valid) expect(c.ok ? 'ok' : c.reason, JSON.stringify(g)).not.toBe(NO_ORDER)
          else expect(c.ok ? 'ok' : c.reason, JSON.stringify(g)).toBe(NO_ORDER)
          checked++
          if (!p.preview.valid) invalid++
        }
    expect(checked).toBeGreaterThan(100)
    expect(invalid).toBeGreaterThan(5)
  })
})
