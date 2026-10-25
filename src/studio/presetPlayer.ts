// Preset playback. Design: the preset is NOT precomputed. Each step is committed
// through the store's committer (the engine Worker, R33), so the main thread is
// never blocked even on the crane, and the history grows step by step exactly
// as if the user had folded it. Between steps the player waits SETTLE_MS (the
// "settle" beat); with reduced motion it steps through frames with no wait.
//
// Abort: aborting the signal stops further steps. A commit already in flight
// finishes and is kept, so the history always ends on a completed step. If
// anything else changes the history mid-playback (the user undoes, starts a
// fold, ...), playback yields and stops. Resolves in every case, never rejects.
import { PRESETS } from '../presets'
import type { Preset } from '../presets'
import { SETTLE_MS, isReducedMotion } from './motion'
import { useStudio } from './store'

export type PlayOptions = {
  /** Called after each completed step with (steps done, total). */
  onStep?: (done: number, total: number) => void
  signal?: AbortSignal
  /** Defaults to the app store. */
  store?: typeof useStudio
  reduced?: () => boolean
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>(resolve => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(t)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const t = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })

export async function playPreset(id: Preset['id'], { onStep, signal, store = useStudio, reduced = isReducedMotion }: PlayOptions = {}): Promise<void> {
  const preset = PRESETS.find(p => p.id === id)
  if (!preset || signal?.aborted) return
  // A commit from a previous playback may still be in flight: let it land (it is dropped).
  while (store.getState().pending && !signal?.aborted) await wait(5, signal)
  if (signal?.aborted) return
  store.getState().newSheet(preset.paper)
  let expected = store.getState().history
  for (const [i, step] of preset.steps.entries()) {
    if (signal?.aborted) return
    const r = await store.getState().commitStep(step)
    if (!r.ok) {
      if (r.refused && r.reason) store.setState({ refusal: `Step ${i + 1}: ${r.reason}` })
      return
    }
    const h = store.getState().history
    // The commit pushed exactly one step; anything else means someone else moved the history.
    if (h.cursor !== expected.cursor + 1) return
    expected = h
    onStep?.(i + 1, preset.steps.length)
    if (i < preset.steps.length - 1 && !reduced()) await wait(SETTLE_MS, signal)
    if (store.getState().history !== expected) return
  }
}
