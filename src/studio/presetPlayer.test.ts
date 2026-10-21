import { describe, expect, test } from 'vitest'
import { PRESETS, runPreset } from '../presets'
import { inProcessCommitter } from './committer'
import { playPreset } from './presetPlayer'
import { createStudioStore } from './store'

const mk = () => createStudioStore({ committer: inProcessCommitter, reduced: () => true })
const cup = PRESETS.find(p => p.id === 'cup')!

describe('playPreset', () => {
  test('plays every step through the committer and ends on the preset model', async () => {
    const store = mk()
    const seen: [number, number][] = []
    await playPreset('cup', { store, reduced: () => true, onStep: (d, t) => seen.push([d, t]) })
    const want = runPreset(cup)
    if (!want.ok) throw new Error(want.reason)
    const h = store.getState().history
    expect(h.steps.map(s => s.label)).toEqual(want.history.steps.map(s => s.label))
    expect(h.cursor).toBe(cup.steps.length)
    expect(seen).toEqual(cup.steps.map((_, i) => [i + 1, cup.steps.length]))
  })

  test('aborting stops further steps and leaves history at the last completed step', async () => {
    const store = mk()
    const c = new AbortController()
    await playPreset('cup', { store, reduced: () => true, signal: c.signal, onStep: d => d === 2 && c.abort() })
    const h = store.getState().history
    expect(h.steps).toHaveLength(2)
    expect(h.cursor).toBe(2)
    expect(store.getState().pending).toBe(false)
  })

  test('an already-aborted signal plays nothing', async () => {
    const store = mk()
    const c = new AbortController()
    c.abort()
    await playPreset('crane', { store, reduced: () => true, signal: c.signal })
    expect(store.getState().history.steps).toHaveLength(0)
  })

  test('stops when the user moves the history mid-playback', async () => {
    const store = mk()
    await playPreset('cup', { store, reduced: () => true, onStep: d => d === 3 && store.getState().undo() })
    expect(store.getState().history.cursor).toBe(2)
    expect(store.getState().history.steps).toHaveLength(3)
  })

  test('with motion it waits between steps and abort cuts the wait short', async () => {
    const store = mk()
    const c = new AbortController()
    const t0 = performance.now()
    await playPreset('cup', { store, reduced: () => false, signal: c.signal, onStep: d => { if (d === 1) setTimeout(() => c.abort(), 20) } })
    expect(performance.now() - t0).toBeLessThan(200)
    expect(store.getState().history.steps).toHaveLength(1)
  })
})
