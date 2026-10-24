// @vitest-environment jsdom
// Lesson mode through the studio store (Plan 4 Task 3): the follow-along
// flow, hints, Show me, skips, rewinds and the turn over / material rules.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { current, type Vec2 } from '@engine'
import { inProcessCommitter } from '../studio/committer'
import { createKeyboardFold } from '../studio/keyboardFold'
import { createStudioStore } from '../studio/store'
import { checkStep } from './check'
import { HINT_AFTER, MISS_TEXT, SHOW_HOLD_MS, TURN_CONFIRM, aligned, duration, expectedStep } from './lessonSlice'
import { loadLessons } from './schema'

const LESSONS = loadLessons()
const h = 2 - Math.SQRT2

function setup(opts: { reduced?: boolean; now?: () => number; hold?: Promise<void> } = {}) {
  const said: string[] = []
  const tweens: number[] = []
  const store = createStudioStore({
    committer: inProcessCommitter,
    reduced: () => opts.reduced ?? true,
    lessons: {
      load: id => Promise.resolve(LESSONS.find(l => l.id === id) ?? null),
      announce: t => void said.push(t),
      now: opts.now ?? (() => 1000),
      wait: () => opts.hold ?? Promise.resolve(),
      // a stand-in tween that records every frame (no rAF in jsdom); instant = one frame at the end
      tween: (from, to, _ms, onFrame, instant, signal) => {
        const n = instant ? 1 : 5
        for (let i = 1; i <= n && !signal?.aborted; i++) {
          const v = instant ? to : from + ((to - from) * i) / n
          tweens.push(v)
          onFrame(v)
        }
        return Promise.resolve()
      },
    },
  })
  return { store, said, tweens }
}

type Store = ReturnType<typeof setup>['store']

async function fold(s: Store, grab: Vec2, target: Vec2, layers = 1) {
  s.getState().begin(grab)
  s.getState().setLayers(layers)
  s.getState().drag(target, 1)
  return s.getState().release()
}

/** The cup's steps, as a learner would make them (exact points, as keyboard folding does). */
const CUP: { grab: Vec2; target: Vec2; layers: number }[] = [
  { grab: [0, 0], target: [1, 1], layers: 1 },
  { grab: [1, 0], target: [h, 1], layers: 2 },
  { grab: [0, 1], target: [1, h], layers: 2 },
  { grab: [1, 1], target: [h, h], layers: 1 },
]

afterEach(() => vi.restoreAllMocks())

describe('starting a lesson', () => {
  test('starts on a blank sheet of the lesson paper with its suggested material, and announces step 1', async () => {
    const { store, said } = setup()
    await fold(store, [1, 1], [0, 0]) // some sandbox work first
    await expect(store.getState().startLesson('frog')).resolves.toBe(true)
    const s = store.getState()
    expect(s.lesson).toMatchObject({ id: 'frog', index: 0, misses: 0, skipped: [], startedAt: 1000, finishedAt: null })
    expect(s.history.steps).toHaveLength(0)
    expect(current(s.history).vertices_coords[2]).toEqual([1, 5 / 3])
    expect(s.paper.size).toEqual({ width: 1, height: 5 / 3 })
    expect(s.paper.front).toBe('#7A9A57')
    expect(said.at(-1)).toBe(`Lesson: Jumping frog. Step 1 of 8: ${LESSONS.find(l => l.id === 'frog')!.steps[0]!.caption}`)
  })

  test('an unknown lesson does not start and leaves the sandbox alone', async () => {
    const { store } = setup()
    await fold(store, [1, 1], [0, 0])
    const before = store.getState().history
    await expect(store.getState().startLesson('origami-dragon')).resolves.toBe(false)
    expect(store.getState().lesson).toBeNull()
    expect(store.getState().history).toBe(before)
  })
})

describe('follow-along flow', () => {
  test('a correct fold moves to the next step and announces the next caption', async () => {
    const { store, said } = setup()
    await store.getState().startLesson('cup')
    const cup = store.getState().lessonData!
    await fold(store, CUP[0]!.grab, CUP[0]!.target)
    const s = store.getState()
    expect(s.lesson).toMatchObject({ index: 1, misses: 0, message: { kind: 'success' } })
    expect(s.history.cursor).toBe(1)
    expect(checkStep(current(s.history), cup.steps[0]!.target, { allowMirror: false })).toEqual({ match: true })
    expect(said.at(-1)).toBe(`Well folded. Step 2 of 6: ${cup.steps[1]!.caption}`)
    expect(aligned(s)).toBe(true)
  })

  test('the same fold from a different grab point is accepted, and the model lines up with the lesson', async () => {
    const { store } = setup()
    await store.getState().startLesson('cup')
    await fold(store, [1, 1], [0, 0]) // the other triangle moves
    expect(store.getState().lesson!.index).toBe(1)
    expect(aligned(store.getState())).toBe(true)
    // the next step folds on from there
    await fold(store, CUP[1]!.grab, CUP[1]!.target, 2)
    expect(store.getState().lesson!.index).toBe(2)
  })

  test('a wrong fold is undone and counted; from the 2nd miss the hint shows and is announced', async () => {
    const { store, said } = setup()
    await store.getState().startLesson('cup')
    const start = store.getState().history
    const hint = store.getState().lessonData!.steps[0]!.hint
    // a book fold where the step wants the diagonal
    await expect(fold(store, [0.5, 1], [0.5, 0])).resolves.toBe(false)
    let s = store.getState()
    expect(s.history).toBe(start)
    expect(s.lesson).toMatchObject({ index: 0, misses: 1, message: { kind: 'miss', text: MISS_TEXT } })
    expect(said.at(-1)).toBe(MISS_TEXT)
    expect(HINT_AFTER).toBe(2)
    await fold(store, [0.5, 1], [0.5, 0])
    s = store.getState()
    expect(s.history).toBe(start)
    expect(s.lesson!.misses).toBe(2)
    expect(s.lesson!.message!.text).toContain(hint)
    expect(said.at(-1)).toBe(`${MISS_TEXT} Hint: ${hint}`)
    // a correct fold then resets the count
    await fold(store, CUP[0]!.grab, CUP[0]!.target)
    expect(store.getState().lesson).toMatchObject({ index: 1, misses: 0 })
  })

  test('a fold made only part-way is a miss (the step is a flat fold)', async () => {
    const { store } = setup()
    await store.getState().startLesson('cup')
    store.getState().begin([0, 0])
    store.getState().drag([0.6, 0.6], 0.5)
    await store.getState().release()
    expect(store.getState().lesson).toMatchObject({ index: 0, misses: 1 })
    expect(store.getState().history.steps).toHaveLength(0)
  })

  test('the whole cup by its lesson points, with the expected turn over, ends in the summary', async () => {
    let t = 1000
    const { store, said } = setup({ now: () => t })
    await store.getState().startLesson('cup')
    for (const st of CUP) await fold(store, st.grab, st.target, st.layers)
    expect(store.getState().lesson!.index).toBe(4)
    // the expected turn over needs no confirm
    await expect(store.getState().turnOver()).resolves.toBe(true)
    expect(store.getState().lesson).toMatchObject({ index: 5, askTurn: false })
    const last = store.getState().lessonData!.steps[5]!.demo!
    t = 1000 + 65_000
    await fold(store, last.grab, last.target, last.layers)
    const s = store.getState()
    expect(s.lesson).toMatchObject({ index: 6, finishedAt: 66_000 })
    expect(expectedStep(s)).toBeNull()
    expect(said.at(-1)).toBe('Well folded. Lesson complete: Cup. 6 of 6 steps folded, 0 skipped, in 1 min 05 s.')
    expect(duration(42_400)).toBe('42 s')
  })
})

describe('turning over and material (Review Focus 3)', () => {
  test('turning over when the step is not a turn over asks first; cancel keeps the model, confirm turns it unjudged', async () => {
    const { store, said } = setup()
    await store.getState().startLesson('cup')
    const before = store.getState().history
    await expect(store.getState().turnOver()).resolves.toBe(false)
    expect(store.getState().history).toBe(before)
    expect(store.getState().lesson!.askTurn).toBe(true)
    expect(said.at(-1)).toBe(TURN_CONFIRM)
    await expect(store.getState().confirmTurn(false)).resolves.toBe(false)
    expect(store.getState().lesson!.askTurn).toBe(false)
    expect(store.getState().history).toBe(before)

    await store.getState().turnOver()
    await expect(store.getState().confirmTurn(true)).resolves.toBe(true)
    let s = store.getState()
    expect(s.history.steps.map(x => x.kind)).toEqual(['turnOver'])
    expect(s.lesson).toMatchObject({ index: 0, misses: 0 }) // a free move, not a miss
    // folding the step on the turned model still counts: the same physical fold, which seen from
    // this side is a mountain (turned about x = ½, the corner (0,0) is now at (1,0))
    await fold(store, [1, 0], [0, 1])
    expect(store.getState().lesson).toMatchObject({ index: 0, misses: 1 }) // a valley from the back is not it
    store.getState().setKind('mountain')
    await fold(store, [1, 0], [0, 1])
    store.getState().setKind('valley')
    s = store.getState()
    expect(s.lesson!.index).toBe(1)
    expect(aligned(s)).toBe(true)
  })

  test('a fold where a turn over is expected is a miss; the turn over is accepted', async () => {
    const { store } = setup()
    await store.getState().startLesson('cup')
    for (const st of CUP) await fold(store, st.grab, st.target, st.layers)
    const at4 = store.getState().history
    await fold(store, [0.95, 0.95], [0.7, 0.7])
    expect(store.getState().history).toBe(at4)
    expect(store.getState().lesson).toMatchObject({ index: 4, misses: 1 })
    await store.getState().turnOver()
    expect(store.getState().lesson!.index).toBe(5)
  })

  test('changing the material mid-lesson never breaks the check', async () => {
    const { store } = setup()
    await store.getState().startLesson('cup')
    store.getState().setPaper({ mode: 'washi', front: '#2B2A28', thickness: 1, translucency: 0.5, pattern: 'asanoha' })
    await fold(store, CUP[0]!.grab, CUP[0]!.target)
    expect(store.getState().lesson!.index).toBe(1)
    store.getState().setPaper({ mode: 'plain', thickness: 0 })
    await fold(store, CUP[1]!.grab, CUP[1]!.target, 2)
    expect(store.getState().lesson!.index).toBe(2)
    expect(store.getState().paper.mode).toBe('plain')
  })
})

describe('Show me (Review Focus 5) and Skip', () => {
  test('Show me plays the step on the lesson frame, then clears it and keeps the index', async () => {
    const { store, tweens, said } = setup({ reduced: false })
    await store.getState().startLesson('cup')
    const before = store.getState().history
    const seen: number[] = []
    const un = store.subscribe(s => {
      if (s.settling && s.settleStyle?.demo) seen.push(s.settleStyle.progress)
    })
    await store.getState().showMe()
    un()
    expect(tweens.length).toBeGreaterThan(1) // tweened
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.at(-1)).toBe(1)
    const s = store.getState()
    expect(s.settling).toBeNull()
    expect(s.history).toBe(before)
    expect(s.lesson).toMatchObject({ index: 0, misses: 0, showing: false })
    expect(said).toContain(`Showing step 1: ${s.lessonData!.steps[0]!.caption}`)
    // and the learner can then fold it
    await fold(store, CUP[0]!.grab, CUP[0]!.target)
    expect(store.getState().lesson!.index).toBe(1)
  })

  test('with reduced motion Show me steps straight to the folded state, without a tween', async () => {
    const { store, tweens } = setup({ reduced: true })
    await store.getState().startLesson('cup')
    const seen: { progress: number; angle: number }[] = []
    const un = store.subscribe(s => {
      if (s.settling && s.settleStyle?.demo) seen.push({ progress: s.settleStyle.progress, angle: s.settling.angleDeg })
    })
    await store.getState().showMe()
    un()
    expect(tweens).toEqual([1])
    expect(seen).toEqual([{ progress: 1, angle: 180 }])
    expect(SHOW_HOLD_MS).toBeGreaterThan(0)
  })

  test('starting a gesture during Show me ends it', async () => {
    let release: () => void = () => {}
    const hold = new Promise<void>(r => (release = r))
    const { store } = setup({ reduced: true, hold })
    await store.getState().startLesson('cup')
    const show = store.getState().showMe()
    await Promise.resolve()
    expect(store.getState().settling).not.toBeNull() // the demo is held on screen
    store.getState().begin([0, 0])
    release()
    await show
    expect(store.getState().settling).toBeNull()
    expect(store.getState().gesture).not.toBeNull()
    expect(store.getState().lesson!.showing).toBe(false)
  })

  test('skipStep records the skip and moves on to the lesson frame', async () => {
    const { store, said } = setup()
    await store.getState().startLesson('cup')
    store.getState().skipStep()
    let s = store.getState()
    expect(s.lesson).toMatchObject({ index: 1, skipped: [0] })
    expect(s.history.cursor).toBe(1)
    expect(checkStep(current(s.history), s.lessonData!.steps[0]!.target, { allowMirror: false }).match).toBe(true)
    expect(said.at(-1)).toMatch(/^Step 1 skipped\. Step 2 of 6: /)
    await fold(store, CUP[1]!.grab, CUP[1]!.target, 2)
    store.getState().skipStep()
    s = store.getState()
    expect(s.lesson).toMatchObject({ index: 3, skipped: [0, 2] })
  })

  test('a turn over step: Show me points at Turn over and leaves the model alone', async () => {
    const { store } = setup()
    await store.getState().startLesson('cup')
    for (let i = 0; i < 4; i++) store.getState().skipStep()
    const before = store.getState().history
    await store.getState().showMe()
    expect(store.getState().history).toBe(before)
    expect(store.getState().lesson!.message!.text).toMatch(/Turn over/)
  })
})

describe('rewinding (Review Focus 2)', () => {
  test('jumping back rewinds the lesson to that step instead of desyncing; skips after it are forgotten', async () => {
    const { store } = setup()
    await store.getState().startLesson('cup')
    await fold(store, CUP[0]!.grab, CUP[0]!.target)
    store.getState().skipStep()
    await fold(store, CUP[2]!.grab, CUP[2]!.target, 2)
    expect(store.getState().lesson).toMatchObject({ index: 3, skipped: [1] })
    store.getState().lessonJump(1)
    let s = store.getState()
    expect(s.lesson).toMatchObject({ index: 1, skipped: [], misses: 0 })
    expect(s.history.cursor).toBe(1)
    expect(aligned(s)).toBe(true)
    // folding on from there checks against step 2
    await fold(store, CUP[1]!.grab, CUP[1]!.target, 2)
    expect(store.getState().lesson!.index).toBe(2)
    // undo and jumpTo move the lesson with the cursor
    store.getState().undo()
    expect(store.getState().lesson!.index).toBe(1)
    store.getState().jumpTo(0)
    s = store.getState()
    expect(s.lesson!.index).toBe(0)
    expect(aligned(s)).toBe(true)
    // forward jumps past the current step are ignored
    store.getState().lessonJump(3)
    expect(store.getState().lesson!.index).toBe(0)
  })

  test('undoing a free turn over keeps the step', async () => {
    const { store } = setup()
    await store.getState().startLesson('cup')
    await fold(store, CUP[0]!.grab, CUP[0]!.target)
    await store.getState().turnOver()
    await store.getState().confirmTurn(true)
    expect(store.getState().lesson!.index).toBe(1)
    store.getState().undo()
    expect(store.getState().lesson!.index).toBe(1)
    expect(aligned(store.getState())).toBe(true)
  })
})

describe('keyboard folding in a lesson (spec 06 Accessibility)', () => {
  test("the cursor starts on the step's grab point, its target is a landmark, and the whole cup folds by keyboard", async () => {
    const { store } = setup()
    const said: string[] = []
    const kf = createKeyboardFold({ store, announce: t => void said.push(t), onPhase: () => {} })
    await store.getState().startLesson('cup')
    const data = store.getState().lessonData!
    for (const [i, step] of data.steps.entries()) {
      if (step.tool === 'turnOver') {
        await store.getState().turnOver()
        continue
      }
      const d = step.demo!
      kf.start()
      expect(said.at(-1)).toMatch(/lesson grab point\.$/)
      kf.key({ key: 'Enter' })
      const near = (p: Vec2, q: Vec2) => expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(1e-6)
      near(store.getState().gesture!.grab, d.grab)
      // Tab to the lesson's target point (it is in the landmark ring)
      for (let n = 0; n < 60 && !said.at(-1)!.includes('lesson target point'); n++) kf.key({ key: 'Tab' })
      near(store.getState().gesture!.target, d.target)
      for (let k = 1; k < d.layers; k++) store.getState().setLayers(k + 1)
      kf.key({ key: 'Enter' })
      await vi.waitFor(() => expect(store.getState().lesson!.index).toBe(i + 1))
    }
    expect(store.getState().lesson!.finishedAt).not.toBeNull()
    kf.dispose()
  })

  test('outside a lesson there are no lesson points', () => {
    const { store } = setup()
    const said: string[] = []
    const kf = createKeyboardFold({ store, announce: t => void said.push(t), onPhase: () => {} })
    kf.start()
    for (let n = 0; n < 12; n++) kf.key({ key: 'Tab' })
    expect(said.some(t => t.includes('lesson'))).toBe(false)
    kf.dispose()
  })
})

describe('leaving', () => {
  test('exitLesson keeps the model ("Free fold from here"); a new sheet or a restored history ends the lesson', async () => {
    const { store } = setup()
    await store.getState().startLesson('cup')
    await fold(store, CUP[0]!.grab, CUP[0]!.target)
    const h1 = store.getState().history
    store.getState().exitLesson()
    expect(store.getState().lesson).toBeNull()
    expect(store.getState().lessonData).toBeNull()
    expect(store.getState().history).toBe(h1)
    // sandbox folds are not judged any more
    await fold(store, [0.95, 0.95], [0.7, 0.7])
    expect(store.getState().history.cursor).toBe(2)

    await store.getState().startLesson('cup')
    store.getState().newSheet()
    expect(store.getState().lesson).toBeNull()
    await store.getState().startLesson('cup')
    store.getState().restoreHistory(h1)
    expect(store.getState().lesson).toBeNull()
  })

  test('the slider cannot re-commit a lesson step (it would change a checked fold)', async () => {
    const { store } = setup()
    await store.getState().startLesson('cup')
    await fold(store, CUP[0]!.grab, CUP[0]!.target)
    const h1 = store.getState().history
    await expect(store.getState().setLastFold({ angleDeg: 90 })).resolves.toBe(false)
    expect(store.getState().history).toBe(h1)
  })
})
