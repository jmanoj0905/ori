// @vitest-environment jsdom
// TZ is pinned before anything reads a Date (the file's pngName test is unconditional).
process.env.TZ = 'UTC'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { current } from '@engine'
import { PRESETS, runPreset } from '../presets'
import { inProcessCommitter } from '../studio/committer'
import { DEFAULT_PAPER, createStudioStore } from '../studio/store'
import { bootStudio } from '../studio/boot'
import { AUTOSAVE_KEY, cancelSave, flushSave, loadHistory, saveHistory } from './autosave'
import { AUTOSAVE_OFF, RESTORE_FAILED, resetNotices, notices } from './notice'
import { pngName } from './png'

const fresh = () => createStudioStore({ committer: inProcessCommitter })

async function fold(s: ReturnType<typeof fresh>, to: [number, number]) {
  s.getState().begin([1, 1])
  s.getState().drag(to, 1)
  return s.getState().release()
}

/** A store with two folds, the second undone (so a redo entry is saved). */
async function twoFoldsOneUndone() {
  const s = fresh()
  expect(await fold(s, [0, 0])).toBe(true)
  s.getState().begin([0.5, 0.5])
  s.getState().drag([0, 0.5], 1)
  expect(await s.getState().release()).toBe(true)
  s.getState().undo()
  return s
}

beforeEach(() => {
  localStorage.clear()
  resetNotices()
  cancelSave()
})
afterEach(() => vi.restoreAllMocks())

describe('autosave', () => {
  test('save then load round-trips the steps, the cursor and the paper', async () => {
    const s = await twoFoldsOneUndone()
    const { history, paper } = s.getState()
    expect(history.steps).toHaveLength(2)
    expect(history.cursor).toBe(1)
    saveHistory(history, paper)
    flushSave()
    const r = loadHistory()
    expect(r).not.toBeNull()
    expect(r!.history.cursor).toBe(1)
    // JSON turns -0 into 0, so compare through the same round trip.
    const wire = (h: typeof history) => JSON.parse(JSON.stringify(h.steps.map(x => [x.kind, x.params])))
    expect(wire(r!.history)).toEqual(wire(history))
    expect(current(r!.history)).toEqual(current(history))
    expect(r!.paper).toEqual(paper)
    expect(notices.getState().message).toBeNull()
  })

  test('a turn over is replayed too', async () => {
    const s = fresh()
    await fold(s, [0, 0])
    expect(await s.getState().turnOver()).toBe(true)
    saveHistory(s.getState().history, s.getState().paper)
    flushSave()
    const r = loadHistory()!
    expect(r.history.steps.map(x => x.kind)).toEqual(['fold', 'turnOver'])
    expect(current(r.history)).toEqual(current(s.getState().history))
  })

  test('saving is debounced by 500 ms', () => {
    vi.useFakeTimers()
    try {
      saveHistory(fresh().getState().history, DEFAULT_PAPER)
      vi.advanceTimersByTime(499)
      expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull()
      vi.advanceTimersByTime(2)
      expect(localStorage.getItem(AUTOSAVE_KEY)).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('nothing saved: null and no toast', () => {
    expect(loadHistory()).toBeNull()
    expect(notices.getState().message).toBeNull()
  })

  test('corrupt JSON gives null and one "Couldn\'t restore" toast', () => {
    localStorage.setItem(AUTOSAVE_KEY, '{not json')
    expect(loadHistory()).toBeNull()
    expect(RESTORE_FAILED).toBe("Couldn't restore your last model.")
    expect(notices.getState().message).toBe(RESTORE_FAILED)
    notices.getState().dismiss()
    expect(loadHistory()).toBeNull() // once per session
    expect(notices.getState().message).toBeNull()
  })

  test('an unknown version is treated as unreadable', () => {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ version: 2, paper: DEFAULT_PAPER, steps: [], cursor: 0 }))
    expect(loadHistory()).toBeNull()
    expect(notices.getState().message).toBe(RESTORE_FAILED)
  })

  test('a step the engine refuses makes the save corrupt', async () => {
    const s = await twoFoldsOneUndone()
    const steps = structuredClone(s.getState().history.steps) as { params: { grab: number[]; target: number[]; crease: { origin: number[] } } }[]
    steps[0].params.crease.origin = [50, 50] // far off the sheet
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ version: 1, paper: DEFAULT_PAPER, steps, cursor: 1 }))
    expect(loadHistory()).toBeNull()
    expect(notices.getState().message).toBe(RESTORE_FAILED)
  })

  test('malformed fields are corrupt, not a crash', () => {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ version: 1, paper: DEFAULT_PAPER, steps: [{ kind: 'fold', params: 7 }], cursor: 1 }))
    expect(loadHistory()).toBeNull()
    expect(notices.getState().message).toBe(RESTORE_FAILED)
  })

  test('setItem throwing (quota / private mode) does not crash and toasts once per session', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const h = fresh().getState().history
    expect(() => {
      saveHistory(h, DEFAULT_PAPER)
      flushSave()
    }).not.toThrow()
    expect(notices.getState().message).toBe(AUTOSAVE_OFF)
    notices.getState().dismiss()
    saveHistory(h, DEFAULT_PAPER)
    flushSave()
    expect(notices.getState().message).toBeNull()
  })
})

describe('boot ordering', () => {
  test('a restored model is not replaced by the blank-sheet seed', async () => {
    const a = await twoFoldsOneUndone()
    saveHistory(a.getState().history, a.getState().paper)
    flushSave()
    const b = fresh()
    bootStudio(b)
    expect(b.getState().history.steps).toHaveLength(2)
    expect(b.getState().history.cursor).toBe(1)
    bootStudio(b) // idempotent (StrictMode)
    expect(b.getState().history.steps).toHaveLength(2)
  })

  test('with nothing saved the blank sheet is seeded, and later changes autosave', async () => {
    const b = fresh()
    bootStudio(b)
    expect(b.getState().history.steps).toHaveLength(0)
    await fold(b, [0, 0])
    flushSave()
    expect(JSON.parse(localStorage.getItem(AUTOSAVE_KEY)!).steps).toHaveLength(1)
  })

  test('a corrupt save boots a fresh sheet with one toast', () => {
    localStorage.setItem(AUTOSAVE_KEY, 'nope')
    const b = fresh()
    bootStudio(b)
    expect(b.getState().history.steps).toHaveLength(0)
    expect(notices.getState().message).toBe(RESTORE_FAILED)
  })
})

describe('pngName', () => {
  test('ori-YYYY-MM-DD-<step>.png from the local date', () => {
    expect(pngName(new Date(2026, 9, 20), 4)).toBe('ori-2026-10-20-4.png')
    expect(pngName(new Date(2026, 0, 5, 23, 59), 0)).toBe('ori-2026-01-05-0.png')
  })
  test('the ISO-date example holds with the timezone pinned to UTC', () => {
    expect(process.env.TZ).toBe('UTC')
    expect(pngName(new Date('2026-10-20'), 4)).toBe('ori-2026-10-20-4.png')
  })
})

/** Frames compared on everything the engine builds geometry from. */
const geometry = (h: { frames: readonly unknown[] }) =>
  h.frames.map(f => {
    const g = f as Record<string, unknown>
    return JSON.parse(JSON.stringify({
      fv: g.faces_vertices, ea: g.edges_assignment, fa: g.edges_foldAngle, ev: g.edges_vertices, vc: g.vertices_coords,
    }))
  })

describe('replay is exact', () => {
  const roundTrip = (h: Parameters<typeof saveHistory>[0], paper: typeof DEFAULT_PAPER = DEFAULT_PAPER) => {
    saveHistory(h, paper)
    flushSave()
    return loadHistory()
  }

  for (const preset of PRESETS) {
    test(`preset ${preset.id}: every frame survives save and load`, () => {
      const r = runPreset(preset)
      if (!r.ok) throw new Error(r.reason)
      const loaded = roundTrip(r.history, { ...DEFAULT_PAPER, size: preset.paper })
      expect(notices.getState().message).toBeNull()
      expect(loaded).not.toBeNull()
      expect(loaded!.history.steps.map(s => s.kind)).toEqual(r.history.steps.map(s => s.kind))
      expect(loaded!.history.cursor).toBe(r.history.cursor)
      const approx = (a: unknown): unknown[] => JSON.parse(JSON.stringify(a, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v)))
      const want = approx(geometry(r.history))
      const got = approx(geometry(loaded!.history))
      expect(got).toHaveLength(want.length)
      for (let i = 0; i < want.length; i++) expect(got[i]).toEqual(want[i])
    })
  }

  test('the presets cover compound tools', () => {
    const kinds = new Set<string>()
    for (const p of PRESETS) {
      const r = runPreset(p)
      if (r.ok) r.history.steps.forEach(s => kinds.add(s.kind))
    }
    expect([...kinds].some(k => k !== 'fold' && k !== 'turnOver')).toBe(true)
  })

  test('a partial 90 degree fold and an R28 re-commit both restore exactly', async () => {
    const s = fresh()
    s.getState().begin([1, 1])
    s.getState().drag([0, 0], 1)
    s.getState().setNumeric({ angleDeg: 90 })
    expect(await s.getState().release()).toBe(true)
    expect((s.getState().history.steps[0].params as { angleDeg: number }).angleDeg).toBe(90)
    let loaded = roundTrip(s.getState().history)!
    expect(geometry(loaded.history)).toEqual(geometry(s.getState().history))
    expect(await s.getState().setLastFold({ angleDeg: 45 })).toBe(true)
    expect(s.getState().history.steps).toHaveLength(1)
    loaded = roundTrip(s.getState().history)!
    expect((loaded.history.steps[0].params as { angleDeg: number }).angleDeg).toBe(45)
    expect(geometry(loaded.history)).toEqual(geometry(s.getState().history))
  })
})

describe('PNG export', () => {
  test('success: anchor click with the right name, revoked after a delay', async () => {
    vi.useFakeTimers()
    const { exportPng, REVOKE_MS } = await import('./png')
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    const stage = { snapshot: vi.fn(async () => new Blob(['x'])) }
    try {
      await exportPng(stage as never, 3, true)
      expect(stage.snapshot).toHaveBeenCalledWith(2, true)
      expect(names).toEqual([pngName(new Date(), 3)])
      expect(revoke).not.toHaveBeenCalled()
      vi.advanceTimersByTime(REVOKE_MS)
      expect(revoke).toHaveBeenCalledWith('blob:x')
      expect(REVOKE_MS).toBeGreaterThanOrEqual(1000)
    } finally {
      vi.useRealTimers()
    }
  })

  test('failure: a notice, no throw, no download', async () => {
    const { exportPng } = await import('./png')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const stage = { snapshot: vi.fn(async () => { throw new Error('boom') }) }
    await expect(exportPng(stage as never, 1, false)).resolves.toBeUndefined()
    expect(click).not.toHaveBeenCalled()
    expect(notices.getState().message).toBe("Couldn't export the image.")
  })
})
