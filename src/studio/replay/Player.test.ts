import { describe, expect, test } from 'vitest'
import type { History } from '@engine'
import { PRESETS, runPreset } from '../../presets'
import { Player, STEP_MS, type Clock, type ReplayView } from './Player'

const cupHistory = (): History => {
  const r = runPreset(PRESETS.find(p => p.id === 'cup')!)
  if (!r.ok) throw new Error(r.reason)
  return r.history
}

/** A manual clock: `advance(ms)` moves time and runs the pending frame callback. */
function fakeClock() {
  let now = 0
  let next: ((t: number) => void) | null = null
  const clock: Clock = {
    now: () => now,
    request: cb => {
      next = cb
      return 1
    },
    cancel: () => {
      next = null
    },
  }
  const advance = (ms: number, by = 16) => {
    for (let left = ms; left > 0; left -= by) {
      now += Math.min(by, left)
      const cb = next
      next = null
      cb?.(now)
    }
  }
  return { clock, advance, pending: () => next !== null }
}

const angleOf = (h: History, i: number) => (h.steps[i]!.params as { angleDeg: number }).angleDeg

describe('Player', () => {
  test('seek(2.5) shows step 3 at 50% of its angle, swung from frames[2]', () => {
    const h = cupHistory()
    const p = new Player(h, { reduced: () => false })
    const seen: ReplayView[] = []
    p.onFrame(v => seen.push(v))
    p.seek(2.5)
    const v = seen.at(-1)!
    expect(v.t).toBe(2.5)
    expect(v.step).toBe(3)
    expect(v.progress).toBeCloseTo(0.5)
    expect(v.frame).toBe(h.frames[2])
    expect(v.swing).not.toBeNull()
    expect(v.swing!.angleDeg).toBeCloseTo(0.5 * angleOf(h, 2), 6)
    expect(v.style).toMatchObject({ tool: 'fold', kind: 'valley' })
  })

  test('an integer time shows that many completed steps, with no swing', () => {
    const h = cupHistory()
    const p = new Player(h, { reduced: () => false })
    expect(p.viewAt(0).frame).toBe(h.frames[0])
    expect(p.viewAt(3).frame).toBe(h.frames[3])
    expect(p.viewAt(3).swing).toBeNull()
    expect(p.viewAt(6).frame).toBe(h.frames[6])
    // Out of range clamps.
    expect(p.viewAt(99).t).toBe(6)
    expect(p.viewAt(-1).t).toBe(0)
  })

  test('a turn over (compound-like) step shows the start state before half way, the end state after', () => {
    const h = cupHistory()
    expect(h.steps[4]!.kind).toBe('turnOver')
    const p = new Player(h, { reduced: () => false })
    expect(p.viewAt(4.4).frame).toBe(h.frames[4])
    expect(p.viewAt(4.4).swing).toBeNull()
    expect(p.viewAt(4.6).frame).toBe(h.frames[5])
    expect(p.viewAt(4.6).swing).toBeNull()
  })

  test('viewAt is pure (the recorder renders exact times) and poses are cached per frame', () => {
    const h = cupHistory()
    const p = new Player(h, { reduced: () => false })
    let calls = 0
    p.onFrame(() => calls++)
    const a = p.viewAt(1)
    const b = p.viewAt(1)
    expect(calls).toBe(0)
    expect(p.t).toBe(0)
    expect(a.poses).toBe(b.poses)
  })

  test('replays only up to the cursor (what the studio shows)', () => {
    const h = { ...cupHistory(), cursor: 2 }
    const p = new Player(h)
    expect(p.steps).toBe(2)
    expect(p.viewAt(2).frame).toBe(h.frames[2])
  })

  test('speed 2 halves the duration', () => {
    const h = cupHistory()
    const { clock, advance } = fakeClock()
    const p = new Player(h, { clock, reduced: () => false })
    expect(p.duration).toBe(6 * STEP_MS)
    p.setSpeed(2)
    expect(p.duration).toBe(3 * STEP_MS)
    p.play()
    advance(3 * STEP_MS - 50)
    expect(p.playing).toBe(true)
    expect(p.t).toBeLessThan(6)
    advance(100)
    expect(p.t).toBe(6)
    expect(p.playing).toBe(false)
  })

  test('playing tweens through fractional times at speed 1', () => {
    const { clock, advance } = fakeClock()
    const p = new Player(cupHistory(), { clock, reduced: () => false })
    const ts: number[] = []
    p.onFrame(v => ts.push(v.t))
    p.play()
    advance(STEP_MS / 2)
    expect(p.t).toBeCloseTo(0.5, 1)
    expect(ts.some(t => t > 0 && t < 1)).toBe(true)
  })

  test('reduced motion steps through whole frames without tweening, one per beat', () => {
    const h = cupHistory()
    const { clock, advance } = fakeClock()
    const p = new Player(h, { clock, reduced: () => true })
    const seen: ReplayView[] = []
    p.onFrame(v => seen.push(v))
    p.play()
    advance(STEP_MS - 20)
    expect(p.t).toBe(0)
    advance(40)
    expect(p.t).toBe(1)
    advance(6 * STEP_MS)
    expect(p.t).toBe(6)
    expect(seen.length).toBeGreaterThan(0)
    for (const v of seen) {
      expect(Number.isInteger(v.t)).toBe(true)
      expect(v.swing).toBeNull()
    }
    // Each frame appears once (no in-between emits).
    expect(seen.filter(v => v.playing).map(v => v.t)).toEqual([0, 1, 2, 3, 4, 5])
    // A scrub lands on whole steps too.
    p.seek(2.5)
    expect(p.t).toBe(2)
  })

  test('pause holds the current frame', () => {
    const { clock, advance, pending } = fakeClock()
    const p = new Player(cupHistory(), { clock, reduced: () => false })
    const seen: ReplayView[] = []
    p.onFrame(v => seen.push(v))
    p.play()
    advance(STEP_MS * 1.25)
    p.pause()
    const held = p.t
    const n = seen.length
    expect(held).toBeGreaterThan(1)
    expect(seen.at(-1)!.playing).toBe(false)
    expect(seen.at(-1)!.t).toBe(held)
    advance(STEP_MS * 3)
    expect(p.t).toBe(held)
    expect(seen.length).toBe(n)
    expect(pending()).toBe(false)
    // Play resumes from the held time.
    p.play()
    advance(STEP_MS / 4)
    expect(p.t).toBeGreaterThan(held)
  })

  test('play at the end restarts from step 0; seek while playing re-anchors', () => {
    const { clock, advance } = fakeClock()
    const p = new Player(cupHistory(), { clock, reduced: () => false })
    p.seek(6)
    p.play()
    expect(p.t).toBe(0)
    p.seek(4)
    advance(STEP_MS / 2)
    expect(p.t).toBeCloseTo(4.5, 1)
    p.dispose()
    expect(p.playing).toBe(false)
  })

  test('autoFrame is carried on each view and re-emits when toggled', () => {
    const p = new Player(cupHistory())
    const seen: ReplayView[] = []
    p.onFrame(v => seen.push(v))
    expect(p.autoFrame).toBe(false)
    p.autoFrame = true
    expect(seen.at(-1)!.autoFrame).toBe(true)
  })
})
