// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SETTLE_MS, prefersReducedMotion, tween } from './motion'

let now = 0
let queue: ((t: number) => void)[] = []
const flush = (dt: number) => {
  now += dt
  const q = queue
  queue = []
  q.forEach(cb => cb(now))
}

beforeEach(() => {
  now = 0
  queue = []
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => queue.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => { queue = [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('motion', () => {
  test('SETTLE_MS is 250', () => expect(SETTLE_MS).toBe(250))

  test('reduced: onFrame(to) exactly once, no frames scheduled', async () => {
    const f = vi.fn()
    await tween(0, 10, 250, f, true)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f).toHaveBeenCalledWith(10)
    expect(queue).toHaveLength(0)
  })

  test('animated: eases through intermediates and ends exactly on `to`', async () => {
    const f = vi.fn()
    const p = tween(0, 10, 250, f, false)
    flush(0)
    flush(100)
    const mid = f.mock.calls.at(-1)![0] as number
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(10)
    flush(300)
    await p
    expect(f.mock.calls.at(-1)![0]).toBe(10)
  })

  test('abort mid-tween stops frames and resolves', async () => {
    const f = vi.fn()
    const ac = new AbortController()
    const p = tween(0, 10, 250, f, false, ac.signal)
    flush(0)
    flush(50)
    const n = f.mock.calls.length
    ac.abort()
    await p
    flush(500)
    expect(f.mock.calls.length).toBe(n)
    expect(f).not.toHaveBeenCalledWith(10)
  })

  test("'always' / 'never' ignore the OS; 'system' reads matchMedia", () => {
    const mm = vi.fn(() => ({ matches: true }))
    vi.stubGlobal('matchMedia', mm)
    expect(prefersReducedMotion('always')).toBe(true)
    expect(prefersReducedMotion('never')).toBe(false)
    expect(mm).not.toHaveBeenCalled()
    expect(prefersReducedMotion('system')).toBe(true)
    expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(prefersReducedMotion('system')).toBe(false)
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion('system')).toBe(false)
  })
})
