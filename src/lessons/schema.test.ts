import { afterEach, describe, expect, test, vi } from 'vitest'
import { PAPER_SIZES, branch, commit, createPaper, push, sculpt, startHistory, turnOver, type Frame } from '@engine'
import { PRESETS, runPreset } from '../presets'
import { checkStep } from './check'
import { LAUNCH_LESSONS, loadLessons, parseLesson, sheetOf, type Lesson } from './schema'
import { gestureOf, lessonSkeleton } from './devExport'
import { RECORDINGS } from './authoring/recordings'
import { waterbombCreases } from '../engine/testkit'

afterEach(() => vi.restoreAllMocks())

const lessons = loadLessons()
const byId = (id: string): Lesson => {
  const l = lessons.find(x => x.id === id)
  if (!l) throw new Error(`no lesson ${id}`)
  return l
}

/** Raw JSON of a valid lesson (a deep copy of the cup's data), to break in tests. */
const rawCup = () => JSON.parse(JSON.stringify(byId('cup'))) as Record<string, unknown> & { steps: Record<string, unknown>[] }

describe('launch lessons', () => {
  test('all five launch lessons validate, in menu order', () => {
    expect(LAUNCH_LESSONS).toEqual(['waterbomb', 'plane', 'cup', 'frog', 'crane'])
    expect(lessons.map(l => l.id)).toEqual(LAUNCH_LESSONS)
    for (const l of lessons) {
      expect(l.title).not.toBe('')
      expect([1, 2, 3]).toContain(l.difficulty)
      expect(l.steps.length).toBeGreaterThan(0)
      for (const s of l.steps) {
        expect(s.caption.trim()).not.toBe('')
        expect(s.hint.trim()).not.toBe('')
        expect(s.caption).not.toMatch(/TODO/i)
        expect(s.hint).not.toMatch(/TODO/i)
      }
    }
  })

  test.each(LAUNCH_LESSONS)('%s: every step matches its own target, and its demo gesture folds it', id => {
    const l = byId(id)
    let prev: Frame = createPaper(sheetOf(l.paper))
    for (const [i, s] of l.steps.entries()) {
      expect(checkStep(s.target, s.target, { allowMirror: false }), `step ${i + 1} vs itself`).toEqual({ match: true })
      // "Show me" and "Skip" play the step from the previous step's target
      const r = s.tool === 'turnOver' ? turnOver(prev) : s.demo ? commit(prev, s.demo) : null
      expect(r, `step ${i + 1} has a demo`).not.toBeNull()
      if (!r!.ok) throw new Error(`step ${i + 1}: ${r!.reason}`)
      expect(checkStep(r!.frame, s.target, { allowMirror: false }), `step ${i + 1} demo`).toEqual({ match: true })
      if (s.tool !== 'turnOver') {
        expect(s.demo!.tool).toBe(s.tool)
        // each fold step changes the model: the previous frame is not already the target
        expect(checkStep(prev, s.target, { allowMirror: true }).match, `step ${i + 1} changes something`).toBe(false)
      }
      prev = s.target
    }
  })

  test('the waterbomb lesson folds from pre-creased paper too (spec 09 scenario 3)', () => {
    let f: Frame = waterbombCreases()
    const l = byId('waterbomb')
    for (const [i, s] of l.steps.entries()) {
      const r = s.tool === 'turnOver' ? turnOver(f) : commit(f, s.demo!)
      if (!r.ok) throw new Error(`step ${i + 1}: ${r.reason}`)
      f = r.frame
    }
    expect(checkStep(f, l.steps.at(-1)!.target, { allowMirror: false })).toEqual({ match: true })
  })

  test('the plane, cup and crane lessons fold the same models as their presets', () => {
    for (const p of PRESETS) {
      const r = runPreset(p)
      if (!r.ok) throw new Error(r.reason)
      const l = byId(p.id)
      expect(l.steps).toHaveLength(p.steps.length)
      l.steps.forEach((s, i) => expect(checkStep(s.target, r.history.frames[i + 1], { allowMirror: false }), `${p.id} ${i + 1}`).toEqual({ match: true }))
    }
  })

  test('the lesson data is what the recordings fold (re-run the authoring script after changing one)', () => {
    for (const rec of RECORDINGS) {
      const l = byId(rec.id)
      expect(l.steps.map(s => s.tool)).toEqual(rec.steps.map(s => s.tool))
    }
  })

  test('the cup can be folded from its lesson points alone (keyboard folding grabs and targets them exactly)', () => {
    const l = byId('cup')
    let f: Frame = createPaper(PAPER_SIZES.square)
    for (const s of l.steps) {
      if (s.tool === 'turnOver') f = turnOver(f).frame
      else {
        const d = s.demo!
        const r = commit(f, { tool: d.tool, grab: d.grab, target: d.target, layers: d.layers, kind: d.kind, progress: 1, snapAngle: false })
        if (!r.ok) throw new Error(r.reason)
        f = r.frame
      }
      expect(checkStep(f, s.target, { allowMirror: false })).toEqual({ match: true })
    }
  })
})

describe('validation', () => {
  test('a lesson with a missing target is filtered out with a console error', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = rawCup()
    bad.id = 'broken'
    delete bad.steps[2]!.target
    const out = loadLessons([rawCup(), bad])
    expect(out.map(l => l.id)).toEqual(['cup'])
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0]![0])).toMatch(/broken/)
    expect(String(err.mock.calls[0]![0])).toMatch(/step 3/)
  })

  test.each([
    ['not an object', null],
    ['no steps', { ...rawCup(), steps: [] }],
    ['a bad difficulty', { ...rawCup(), difficulty: 4 }],
    ['an unknown paper', { ...rawCup(), paper: 'letter' }],
    ['an unknown tool', { ...rawCup(), steps: [{ ...rawCup().steps[0], tool: 'crimp' }] }],
    ['an empty caption', { ...rawCup(), steps: [{ ...rawCup().steps[0], caption: ' ' }] }],
    ['a target that is not a FOLD frame', { ...rawCup(), steps: [{ ...rawCup().steps[0], target: { vertices_coords: 3 } }] }],
    ['a demo with a non-finite grab', { ...rawCup(), steps: [{ ...rawCup().steps[0], demo: { ...(rawCup().steps[0]!.demo as object), grab: [NaN, 0] } }] }],
    ['a demo whose tool is not the step tool', { ...rawCup(), steps: [{ ...rawCup().steps[0], tool: 'reverse' }] }],
    ['a target on a different paper size', { ...rawCup(), paper: 'a4' }],
    ['a bad camera', { ...rawCup(), steps: [{ ...rawCup().steps[0], camera: 'side' }] }],
  ])('%s is rejected, never thrown', (_why, raw) => {
    const r = parseLesson(raw)
    expect(r.ok).toBe(false)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => loadLessons([raw])).not.toThrow()
    expect(loadLessons([raw])).toEqual([])
    expect(err).toHaveBeenCalled()
  })

  test('two lessons with one id: the second is dropped', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(loadLessons([rawCup(), rawCup()])).toHaveLength(1)
    expect(err).toHaveBeenCalledTimes(1)
  })

  test('a suggested material is cleaned (unknown fields and bad colours dropped)', () => {
    const raw = { ...rawCup(), material: { mode: 'washi', front: 'red', translucency: 0.2, bogus: 1 } }
    const r = parseLesson(raw)
    if (!r.ok) throw new Error(r.reason)
    expect(r.lesson.material).toEqual({ mode: 'washi', translucency: 0.2 })
  })
})

describe('devExport', () => {
  test('a recorded history exports as a lesson skeleton that validates and replays', () => {
    const cup = PRESETS.find(p => p.id === 'cup')!
    const r = runPreset(cup)
    if (!r.ok) throw new Error(r.reason)
    const sk = lessonSkeleton(r.history, { id: 'cup-copy', title: 'Cup copy', difficulty: 1, paper: 'square' })
    expect(sk.steps).toHaveLength(cup.steps.length)
    expect(sk.steps.map(s => s.tool)).toEqual(cup.steps.map(s => s.tool === 'turnOver' ? 'turnOver' : s.tool))
    expect(sk.steps.every(s => s.caption === '' && s.hint === '')).toBe(true)
    // with captions filled in it is a valid lesson, and its targets are the history's frames
    const filled = { ...sk, steps: sk.steps.map((s, i) => ({ ...s, caption: `Step ${i + 1}`, hint: 'Hint' })) }
    const p = parseLesson(JSON.parse(JSON.stringify(filled)))
    if (!p.ok) throw new Error(p.reason)
    p.lesson.steps.forEach((s, i) => expect(checkStep(s.target, r.history.frames[i + 1], { allowMirror: false })).toEqual({ match: true }))
  })

  test('a designer crease pattern step cannot become a lesson step', () => {
    const sheet = createPaper(PAPER_SIZES.square)
    const h = branch(startHistory(sheet), sheet)
    expect(() => lessonSkeleton(h, { id: 'x', title: 'X', difficulty: 1, paper: 'square' })).toThrow(/crease pattern/)
  })

  test('a sculpted (soft paper) step cannot become a lesson step (phase 5 decision 3)', () => {
    const sheet = createPaper(PAPER_SIZES.square)
    const r = sculpt(sheet, { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0.2], tris: [0, 1, 2], uv: [0, 0, 1, 0, 0, 1] })
    if (!r.ok) throw new Error(r.reason)
    const h = push(startHistory(sheet), r.step, r.frame)
    expect(() => lessonSkeleton(h, { id: 'x', title: 'X', difficulty: 1, paper: 'square' })).toThrow(/sculpted/)
  })

  test('gestureOf rebuilds the committed gesture from the step params (tool, grab, target, layers, kind, snap, face)', () => {
    const f = createPaper(PAPER_SIZES.square)
    const r = commit(f, { tool: 'fold', grab: [0.9, 0.5], target: [0.1, 0.5], layers: 1, kind: 'mountain', progress: 1, snapAngle: true, face: 0 })
    if (!r.ok) throw new Error(r.reason)
    expect(gestureOf(r.step)).toEqual({ tool: 'fold', grab: [0.9, 0.5], target: [0.1, 0.5], layers: 1, kind: 'mountain', progress: 1, snapAngle: true, face: 0 })
    expect(gestureOf(turnOver(f).step)).toBeNull()
  })
})
