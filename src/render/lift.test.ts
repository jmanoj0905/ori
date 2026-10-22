// The release lift (spec 03 step 4, R55): render-only.
import { describe, expect, test } from 'vitest'
import { FLAP_LIFT, LAND_MS, flapLift } from './lift'

describe('flap lift', () => {
  test('a dragged valley (or compound) flap rides a small lift toward the viewer', () => {
    expect(FLAP_LIFT).toBeGreaterThan(0)
    expect(FLAP_LIFT).toBeLessThan(0.05) // a few hundredths of the sheet: a hover, not a jump
    expect(flapLift({ kind: 'valley', tool: 'fold' }, false)).toBe(FLAP_LIFT)
    expect(flapLift({ tool: 'squash' }, false)).toBe(FLAP_LIFT)
  })

  test('a mountain flap swings under the paper: no lift (it would sink into the desk)', () => {
    expect(flapLift({ kind: 'mountain', tool: 'fold' }, false)).toBe(0)
  })

  test('reduced motion: no lift, so nothing eases on release', () => {
    expect(flapLift({ kind: 'valley', tool: 'fold' }, true)).toBe(0)
  })

  test('it lands over the settle time, 250 ms', () => {
    expect(LAND_MS).toBe(250)
  })
})
