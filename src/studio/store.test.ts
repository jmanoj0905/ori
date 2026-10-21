// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PAPER_SIZES, canRedo, createPaper, current, preview } from '@engine'
import type { Gesture } from '@engine'
import { inProcessCommitter, type Committer, type CommitRequest } from './committer'
import { DEFAULT_PAPER, HINT_START, createStudioStore, lastFold, setPaperDefaultsSource } from './store'

const fresh = () => createStudioStore({ committer: inProcessCommitter })

/** Fold the square's top-right corner onto the bottom-left one, flat. */
function foldCorner(s: ReturnType<typeof fresh>) {
  s.getState().begin([1, 1])
  s.getState().drag([0, 0], 1)
  return s.getState().release()
}

/** A committer whose calls resolve only when the test says so. */
function deferredCommitter() {
  const calls: { req: CommitRequest; resolve: () => void }[] = []
  const committer: Committer = req =>
    new Promise(res => calls.push({ req, resolve: () => inProcessCommitter(req).then(res) }))
  return { committer, calls }
}

describe('useStudio store', () => {
  test('the initial hint asks for a first fold', () => {
    const s = fresh().getState()
    expect(HINT_START).toBe('Grab a corner and drag it across.')
    expect(s.hint).toBe('Grab a corner and drag it across.')
    expect(s.history.steps).toHaveLength(0)
    expect(s.tool).toBe('fold')
    expect(s.kind).toBe('valley')
    expect(s.gesture).toBeNull()
    expect(s.preview).toBeNull()
    expect(s.refusal).toBeNull()
    expect(s.paper.mode).toBe('kami')
    expect(s.paper.size).toBe('square')
  })

  test('setSnapAngle toggles Gesture.snapAngle mid-drag and is a no-op without a gesture', () => {
    const s = fresh()
    s.getState().setSnapAngle(true)
    expect(s.getState().gesture).toBeNull()
    s.getState().begin([1, 1])
    s.getState().drag([0.3, 0.3], 1)
    s.getState().setSnapAngle(true)
    expect(s.getState().gesture?.snapAngle).toBe(true)
    expect(s.getState().preview).not.toBeNull()
    s.getState().setSnapAngle(false)
    expect(s.getState().gesture?.snapAngle).toBe(false)
  })

  test('begin → drag → release on a fresh square adds one step', async () => {
    const s = fresh()
    s.getState().begin([1, 1])
    expect(s.getState().gesture).toMatchObject({ tool: 'fold', grab: [1, 1], layers: 1, kind: 'valley', snapAngle: false })
    s.getState().drag([0, 0], 1)
    expect(s.getState().preview).not.toBeNull()
    expect(s.getState().refusal).toBeNull()
    await expect(s.getState().release()).resolves.toBe(true)
    const st = s.getState()
    expect(st.history.steps).toHaveLength(1)
    expect(st.history.cursor).toBe(1)
    expect(st.gesture).toBeNull()
    expect(st.preview).toBeNull()
    expect(st.pending).toBe(false)
  })

  test('drag previews against current(history), never Preview.frame', () => {
    const s = fresh()
    s.getState().begin([1, 1])
    s.getState().drag([0.5, 0.5], 0.4)
    const first = s.getState().preview!
    s.getState().drag([0.2, 0.2], 0.6)
    const g: Gesture = { tool: 'fold', grab: [1, 1], target: [0.2, 0.2], layers: 1, kind: 'valley', progress: 0.6, snapAngle: false }
    const expected = preview(current(s.getState().history), g)
    expect(expected.ok).toBe(true)
    if (!expected.ok) return
    expect(s.getState().preview!.crease).toEqual(expected.preview.crease)
    expect(s.getState().preview!.angleDeg).toBeCloseTo(expected.preview.angleDeg)
    expect(first).not.toBe(s.getState().preview)
  })

  test('cancel mid-drag leaves the history unchanged and clears the preview', () => {
    const s = fresh()
    const before = s.getState().history
    s.getState().begin([1, 1])
    s.getState().drag([0.3, 0.3], 0.5)
    expect(s.getState().preview).not.toBeNull()
    s.getState().cancel()
    const st = s.getState()
    expect(st.history).toBe(before)
    expect(st.preview).toBeNull()
    expect(st.gesture).toBeNull()
    expect(st.refusal).toBeNull()
  })

  test('a refused drag sets refusal to the engine reason, and release does not commit it', async () => {
    const s = fresh()
    const g: Gesture = { tool: 'fold', grab: [2, 2], target: [3, 3], layers: 1, kind: 'valley', progress: 1, snapAngle: false }
    const engine = preview(createPaper(PAPER_SIZES.square), g)
    expect(engine.ok).toBe(false)
    if (engine.ok) return
    s.getState().begin([2, 2])
    s.getState().drag([3, 3], 1)
    expect(s.getState().refusal).toBe(engine.reason)
    expect(s.getState().preview).toBeNull()
    await expect(s.getState().release()).resolves.toBe(false)
    expect(s.getState().history.steps).toHaveLength(0)
    expect(s.getState().gesture).toBeNull()
  })

  test('release without a drag commits nothing', async () => {
    const s = fresh()
    s.getState().begin([1, 1])
    await expect(s.getState().release()).resolves.toBe(false)
    expect(s.getState().history.steps).toHaveLength(0)
  })

  test('undo and redo work through the store', async () => {
    const s = fresh()
    await foldCorner(s)
    expect(s.getState().history.cursor).toBe(1)
    s.getState().undo()
    expect(s.getState().history.cursor).toBe(0)
    expect(s.getState().history.steps).toHaveLength(1)
    s.getState().redo()
    expect(s.getState().history.cursor).toBe(1)
    s.getState().jumpTo(0)
    expect(s.getState().history.cursor).toBe(0)
  })

  test('setLayers and setKind re-run the preview mid-drag', () => {
    const s = fresh()
    s.getState().begin([1, 1])
    s.getState().drag([0.4, 0.4], 0.5)
    const valley = s.getState().preview!
    s.getState().setKind('mountain')
    expect(s.getState().gesture!.kind).toBe('mountain')
    expect(s.getState().kind).toBe('mountain')
    expect(s.getState().preview).not.toBe(valley)
    // a single sheet has one layer: asking for more is clamped to what the engine took
    s.getState().setLayers(5)
    expect(s.getState().preview!.layers).toBe(1)
    expect(s.getState().gesture!.layers).toBe(1)
  })

  test('turnOver adds a step', async () => {
    const s = fresh()
    await expect(s.getState().turnOver()).resolves.toBe(true)
    expect(s.getState().history.steps).toHaveLength(1)
    expect(s.getState().history.steps[0].kind).toBe('turnOver')
  })

  test('newSheet starts a fresh history at the given size', async () => {
    const s = fresh()
    await foldCorner(s)
    s.getState().newSheet('a4')
    let st = s.getState()
    expect(st.history.steps).toHaveLength(0)
    expect(st.paper.size).toBe('a4')
    const ys = current(st.history).vertices_coords.map(p => p[1])
    expect(Math.max(...ys)).toBeCloseTo(Math.SQRT2)
    s.getState().newSheet({ width: 2, height: 1 })
    st = s.getState()
    expect(st.paper.size).toEqual({ width: 2, height: 1 })
    expect(Math.max(...current(st.history).vertices_coords.map(p => p[0]))).toBeCloseTo(2)
  })

  test('setTool and setPaper update settings', () => {
    const s = fresh()
    s.getState().setTool('squash')
    expect(s.getState().tool).toBe('squash')
    s.getState().setPaper({ front: '#2F4A8A' })
    expect(s.getState().paper.front).toBe('#2F4A8A')
    expect(s.getState().paper.mode).toBe('kami')
  })

  test('while a commit is pending, begin is ignored and pending is true', async () => {
    const { committer, calls } = deferredCommitter()
    const s = createStudioStore({ committer })
    s.getState().begin([1, 1])
    s.getState().drag([0, 0], 1)
    const done = s.getState().release()
    expect(s.getState().pending).toBe(true)
    s.getState().begin([0, 0])
    expect(s.getState().gesture?.grab).not.toEqual([0, 0])
    expect(calls).toHaveLength(1)
    calls[0].resolve()
    await expect(done).resolves.toBe(true)
    expect(s.getState().pending).toBe(false)
    expect(s.getState().history.steps).toHaveLength(1)
    s.getState().begin([0, 0])
    expect(s.getState().gesture?.grab).toEqual([0, 0])
  })

  test('a commit that lands after the history changed is dropped', async () => {
    const { committer, calls } = deferredCommitter()
    const s = createStudioStore({ committer })
    s.getState().begin([1, 1])
    s.getState().drag([0, 0], 1)
    const done = s.getState().release()
    s.getState().newSheet('square')
    calls[0].resolve()
    await expect(done).resolves.toBe(false)
    expect(s.getState().history.steps).toHaveLength(0)
    expect(s.getState().pending).toBe(false)
  })

  test('a committer failure becomes a refusal, not a crash', async () => {
    const s = createStudioStore({ committer: () => Promise.reject(new Error('worker died')) })
    s.getState().begin([1, 1])
    s.getState().drag([0, 0], 1)
    await expect(s.getState().release()).resolves.toBe(false)
    expect(s.getState().refusal).toBeTruthy()
    expect(s.getState().pending).toBe(false)
    expect(s.getState().history.steps).toHaveLength(0)
  })

  describe('R28 post-release angle and numeric input', () => {
    /** Fold the top-right corner to the bottom-left one, but only 90 degrees of the way. */
    async function foldTo90(s: ReturnType<typeof fresh>) {
      s.getState().begin([1, 1])
      s.getState().drag([0, 0], 1)
      s.getState().setNumeric({ angleDeg: 90 })
      return s.getState().release()
    }

    test('lastFold reads the recorded params of the step under the cursor', async () => {
      const s = fresh()
      expect(lastFold(s.getState().history)).toBeNull()
      await foldCorner(s)
      const last = lastFold(s.getState().history)
      expect(last?.grab).toEqual([1, 1])
      expect(last?.angleDeg).toBeCloseTo(180)
      s.getState().undo()
      expect(lastFold(s.getState().history)).toBeNull()
    })

    test('during a gesture setNumeric sets Gesture.angleDeg and re-previews', () => {
      const s = fresh()
      s.getState().begin([1, 1])
      s.getState().drag([0, 0], 1)
      s.getState().setNumeric({ angleDeg: 60 })
      expect(s.getState().gesture?.angleDeg).toBe(60)
      expect(s.getState().preview?.angleDeg).toBeCloseTo(60)
    })

    test('during a gesture setNumeric takes an exact crease', () => {
      const s = fresh()
      s.getState().begin([1, 0.5])
      s.getState().setNumeric({ crease: { origin: [0.75, 0], vector: [0, 1] }, angleDeg: 180 })
      expect(s.getState().preview?.crease[0].map(p => p[0])).toEqual([0.75, 0.75])
    })

    test('setLastFold replaces the last history entry: one step, one undo', async () => {
      const s = fresh()
      await foldTo90(s)
      expect(s.getState().history.steps).toHaveLength(1)
      const before = s.getState().history.frames[1]
      await expect(s.getState().setLastFold({ angleDeg: 45 })).resolves.toBe(true)
      const h = s.getState().history
      expect(h.steps).toHaveLength(1)
      expect(h.cursor).toBe(1)
      expect(h.frames[1]).not.toBe(before)
      expect(lastFold(h)?.angleDeg).toBeCloseTo(45)
      expect(s.getState().pending).toBe(false)
      s.getState().undo()
      expect(s.getState().history.cursor).toBe(0)
      expect(s.getState().history.frames[0]).toBe(h.frames[0])
    })

    test('a refused re-commit leaves history alone and shows the reason', async () => {
      const s = fresh()
      await foldTo90(s)
      const h = s.getState().history
      await expect(s.getState().setLastFold({ angleDeg: 270 })).resolves.toBe(false)
      expect(s.getState().history).toBe(h)
      expect(s.getState().refusal).toBe('The fold angle must be between 0° and 180°.')
    })

    test('setLastFold is a no-op while a gesture is active or with no fold', async () => {
      const s = fresh()
      await expect(s.getState().setLastFold({ angleDeg: 30 })).resolves.toBe(false)
      await foldTo90(s)
      s.getState().begin([0, 1])
      const h = s.getState().history
      await expect(s.getState().setLastFold({ angleDeg: 30 })).resolves.toBe(false)
      expect(s.getState().history).toBe(h)
    })

    test('without a gesture setNumeric re-commits the last fold', async () => {
      const s = fresh()
      await foldTo90(s)
      s.getState().setNumeric({ angleDeg: 30 })
      await vi.waitFor(() => expect(lastFold(s.getState().history)?.angleDeg).toBeCloseTo(30))
    })

    test('rapid slider moves are coalesced: one request at a time, the latest value wins', async () => {
      const { committer, calls } = deferredCommitter()
      const s = createStudioStore({ committer })
      s.getState().begin([1, 1])
      s.getState().drag([0, 0], 1)
      const rel = s.getState().release()
      calls[0].resolve()
      await rel
      const first = s.getState().setLastFold({ angleDeg: 120 })
      const second = s.getState().setLastFold({ angleDeg: 100 })
      const third = s.getState().setLastFold({ angleDeg: 80 })
      expect(calls).toHaveLength(2) // the commit plus ONE re-commit in flight
      calls[1].resolve()
      await vi.waitFor(() => expect(calls).toHaveLength(3))
      expect(calls[2].req).toMatchObject({ gesture: { angleDeg: 80 } })
      calls[2].resolve()
      await Promise.all([first, second, third])
      expect(lastFold(s.getState().history)?.angleDeg).toBeCloseTo(80)
      expect(s.getState().history.steps).toHaveLength(1)
    })

    test('undo while a re-commit is in flight drops the queued edit: the earlier fold is untouched, the later one stays redoable', async () => {
      const { committer, calls } = deferredCommitter()
      const s = createStudioStore({ committer })
      const fold = async (grab: [number, number], target: [number, number], layers: number) => {
        s.getState().begin(grab)
        s.getState().drag(target, 1)
        s.getState().setLayers(layers)
        const p = s.getState().release()
        calls.at(-1)!.resolve()
        await p
      }
      await fold([1, 0.5], [0, 0.5], 1)
      await fold([0, 0.5], [0.5, 0.5], 2)
      expect(s.getState().history.steps).toHaveLength(2)
      const stepA = s.getState().history.steps[0]
      const n = calls.length
      const a = s.getState().setLastFold({ angleDeg: 100 })
      const b = s.getState().setLastFold({ angleDeg: 60 })
      s.getState().undo()
      calls[n].resolve()
      await Promise.all([a, b])
      const h = s.getState().history
      expect(calls).toHaveLength(n + 1) // the queued value never reached the committer
      expect(h.cursor).toBe(1)
      expect(h.steps).toHaveLength(2)
      expect(h.steps[0]).toBe(stepA)
      expect(canRedo(h)).toBe(true)
      expect(s.getState().pending).toBe(false)
    })
  })
})


describe('settle animation', () => {
  let now = 0
  let queue = new Map<number, (t: number) => void>()
  let nextId = 1
  const flush = (dt: number) => {
    now += dt
    const q = [...queue.values()]
    queue = new Map()
    q.forEach(cb => cb(now))
  }
  beforeEach(() => {
    now = 0
    queue = new Map()
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      const id = nextId++
      queue.set(id, cb)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id) })
  })
  afterEach(() => vi.unstubAllGlobals())

  /** Commit that reports a different committed angle than the preview showed (R13-style divergence). */
  const committingAt = (angle: number): Committer => async req => {
    const r = await inProcessCommitter(req)
    if (!r.ok) return r
    return { ...r, step: { ...r.step, params: { ...(r.step.params as object), angleDeg: angle } } }
  }

  const released = async (reduced: boolean, committed = 170) => {
    const s = createStudioStore({ committer: committingAt(committed), reduced: () => reduced })
    const seen: (number | null)[] = []
    s.subscribe(st => seen.push(st.settling ? st.settling.angleDeg : null))
    s.getState().begin([1, 1])
    s.getState().drag([0, 0], 0.6)
    const startAngle = s.getState().preview!.angleDeg
    expect(await s.getState().release()).toBe(true)
    return { s, seen, startAngle }
  }

  test('commits immediately; the flap then eases from the released angle to the committed one', async () => {
    const { s, startAngle } = await released(false, 170)
    expect(s.getState().history.steps).toHaveLength(1)
    expect(s.getState().preview).toBeNull()
    expect(s.getState().settling?.angleDeg).toBeCloseTo(startAngle)
    flush(0)
    flush(100)
    const mid = s.getState().settling!.angleDeg
    expect(mid).toBeGreaterThan(startAngle)
    expect(mid).toBeLessThan(170)
    flush(400)
    expect(s.getState().settling).toBeNull()
  })

  test('the last settle frame is the committed angle: no overshoot, no backward pop', async () => {
    const { s } = await released(false, 170)
    const angles: number[] = []
    s.subscribe(st => st.settling && angles.push(st.settling.angleDeg))
    for (let i = 0; i < 40; i++) flush(10)
    expect(angles.length).toBeGreaterThan(1)
    expect(Math.max(...angles)).toBeLessThanOrEqual(170 + 1e-6)
    expect(angles).toEqual([...angles].sort((a, b) => a - b))
    expect(s.getState().settling).toBeNull()
  })

  test('released at the committed angle (the usual case) there is nothing to settle', async () => {
    const s = createStudioStore({ committer: inProcessCommitter, reduced: () => false })
    s.getState().begin([1, 1])
    s.getState().drag([0, 0], 0.6)
    await s.getState().release()
    expect(s.getState().settling).toBeNull()
    expect(queue.size).toBe(0)
  })

  test('reduced motion: no intermediate frame is ever shown', async () => {
    const { s, seen } = await released(true)
    expect(s.getState().history.steps).toHaveLength(1)
    expect(s.getState().settling).toBeNull()
    expect(seen.every(a => a === null)).toBe(true)
    expect(queue.size).toBe(0)
  })

  test('undo, begin, turnOver or a tool change mid-settle cancels it; no frame lands afterwards', async () => {
    const acts: ((s: ReturnType<typeof fresh>) => void)[] = [
      s => s.getState().undo(),
      s => s.getState().begin([0, 1]),
      s => void s.getState().turnOver(),
      s => s.getState().setTool('squash'),
      s => s.getState().newSheet('a4'),
    ]
    for (const act of acts) {
      const { s } = await released(false)
      flush(0)
      flush(50)
      expect(s.getState().settling).not.toBeNull()
      act(s)
      expect(s.getState().settling).toBeNull()
      expect(queue.size).toBe(0)
      flush(10)
      expect(s.getState().settling).toBeNull()
      expect(s.getState().settleStyle).toBeNull()
      flush(500)
      expect(s.getState().settling).toBeNull()
    }
  })

  test('R41: a release commits the fold at the previewed angle (edges_foldAngle), 180 only at progress 1', async () => {
    const fold = async (progress: number) => {
      const s = createStudioStore({ committer: inProcessCommitter, reduced: () => true })
      s.getState().begin([1, 1])
      s.getState().drag([0, 0], progress)
      const shown = s.getState().preview!.angleDeg
      await s.getState().release()
      const f = current(s.getState().history)
      const creased = f.edges_foldAngle!.filter(a => a !== 0)
      return { shown, creased, params: (s.getState().history.steps[0]!.params as { angleDeg: number }).angleDeg }
    }
    const partial = await fold(0.6)
    expect(partial.shown).toBeLessThan(180)
    expect(partial.creased).toEqual([partial.shown])
    expect(partial.params).toBe(partial.shown)
    const full = await fold(1)
    expect(full.creased).toEqual([180])
    expect(full.params).toBe(180)
  })

  test('the settle keeps the released gesture style (mountain) for the Stage', async () => {
    const s = createStudioStore({ committer: committingAt(170), reduced: () => false })
    const calls: { p: unknown; style: Record<string, unknown> }[] = []
    const stage = {
      setPaper() {}, setFrame() {},
      setPreview: (p: unknown, style: Record<string, unknown> = {}) => calls.push({ p, style }),
    }
    const { syncStage } = await import('./App')
    s.subscribe((st, prev) => syncStage(stage as never, st, prev))
    s.getState().setKind('mountain')
    s.getState().begin([1, 1])
    s.getState().drag([0, 0], 0.6)
    await s.getState().release()
    flush(0)
    flush(100)
    const during = calls.filter(c => c.p && s.getState().gesture === null).slice(-2)
    expect(during.length).toBeGreaterThan(0)
    for (const c of during) expect(c.style).toMatchObject({ kind: 'mountain', tool: 'fold' })
    flush(400)
    expect(calls.at(-1)!.p).toBeNull()
  })
})

describe('paper defaults (R43)', () => {
  const defaults = { ...DEFAULT_PAPER, mode: 'plain' as const, front: '#2F4A8A', size: 'a4' as const, thickness: 0.9 }
  afterEach(() => setPaperDefaultsSource(null))

  test('newSheet() without a size takes the settings defaults, size included', () => {
    setPaperDefaultsSource(() => defaults)
    const s = fresh()
    s.getState().setPaper({ front: '#000000' })
    s.getState().newSheet()
    expect(s.getState().paper).toEqual(defaults)
    expect(current(s.getState().history).vertices_coords.length).toBeGreaterThan(0)
    const f = current(s.getState().history).vertices_coords
    const w = Math.max(...f.map(v => v[0])) - Math.min(...f.map(v => v[0]))
    const h = Math.max(...f.map(v => v[1])) - Math.min(...f.map(v => v[1]))
    expect(w / h).toBeCloseTo(PAPER_SIZES.a4.width / PAPER_SIZES.a4.height)
  })

  test('an explicit size wins and keeps the current paper look', () => {
    setPaperDefaultsSource(() => defaults)
    const s = fresh()
    s.getState().setPaper({ front: '#123456' })
    s.getState().newSheet('square')
    expect(s.getState().paper.size).toBe('square')
    expect(s.getState().paper.front).toBe('#123456')
  })

  test('without a source it keeps the current paper', () => {
    const s = fresh()
    s.getState().setPaper({ front: '#123456' })
    s.getState().newSheet()
    expect(s.getState().paper.front).toBe('#123456')
  })
})
