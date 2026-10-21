// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { PAPER_SIZES, createPaper, current, preview } from '@engine'
import type { Gesture } from '@engine'
import { inProcessCommitter, type Committer, type CommitRequest } from './committer'
import { HINT_START, createStudioStore } from './store'

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
})
