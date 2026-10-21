// Motion helpers shared by the fold settle and the camera view transitions
// (spec 04 §4: reduced motion means instant). One tween, one reduced-motion test.
import type { ReducedMotion } from '../settings/schema'

/** How long a released flap takes to settle into its committed angle. */
export const SETTLE_MS = 250

export function prefersReducedMotion(setting: ReducedMotion): boolean {
  if (setting === 'always') return true
  if (setting === 'never') return false
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Where the studio reads the reduced-motion setting from. The settings store
 * imports the studio store, so the store cannot import it back; the App wires
 * the real source in at start-up. Defaults to the OS preference.
 */
let source: () => boolean = () => prefersReducedMotion('system')
export const setReducedMotionSource = (fn: () => boolean): void => { source = fn }
export const isReducedMotion = (): boolean => source()

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3

/**
 * Animate from `from` to `to` over `ms`, calling `onFrame(value)` each
 * animation frame; the last call is always exactly `to`. With `reduced` it
 * calls `onFrame(to)` once, synchronously, and resolves. Aborting `signal`
 * stops the tween at once without a final call (the canceller owns the end
 * state) and still resolves the promise.
 */
export function tween(
  from: number,
  to: number,
  ms: number,
  onFrame: (value: number) => void,
  reduced: boolean,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  if (reduced || ms <= 0) {
    onFrame(to)
    return Promise.resolve()
  }
  return new Promise<void>(resolve => {
    let start: number | null = null
    let raf = 0
    const finish = () => {
      signal?.removeEventListener('abort', stop)
      resolve()
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      finish()
    }
    const step = (now: number) => {
      if (signal?.aborted) return finish()
      start ??= now
      const t = Math.min(1, (now - start) / ms)
      if (t >= 1) {
        onFrame(to)
        return finish()
      }
      onFrame(from + (to - from) * easeOutCubic(t))
      raf = requestAnimationFrame(step)
    }
    signal?.addEventListener('abort', stop, { once: true })
    raf = requestAnimationFrame(step)
  })
}
