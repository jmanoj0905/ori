// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { current } from '@engine'
import { inProcessCommitter } from '../studio/committer'
import { createStudioStore, DEFAULT_PAPER } from '../studio/store'
import { bootStudio, resetBootForTests } from '../studio/boot'
import { AUTOSAVE_KEY, cancelSave, flushSave, saveHistory } from './autosave'
import { resetNotices, notices } from './notice'
import { NEWER, DAMAGED, encodeShare } from './shareCodec'

const fresh = () => createStudioStore({ committer: inProcessCommitter })

async function fold(s: ReturnType<typeof fresh>, from: [number, number], to: [number, number]) {
  s.getState().begin(from)
  s.getState().drag(to, 1)
  return s.getState().release()
}

/** A store with two folds: the model a link is made from. */
async function twoFolds() {
  const s = fresh()
  expect(await fold(s, [1, 1], [0, 0])).toBe(true)
  expect(await fold(s, [0.5, 0.5], [0, 0.5])).toBe(true)
  return s
}

const link = (s: ReturnType<typeof fresh>) => '#' + encodeShare(s.getState().paper, s.getState().history.steps)

beforeEach(() => {
  localStorage.clear()
  resetNotices()
  cancelSave()
  history.replaceState(null, '', '/')
})
afterEach(() => {
  resetBootForTests()
  history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

describe('opening a share link', () => {
  test('a valid hash with no autosave replays the steps into the history, and the hash is removed', async () => {
    const a = await twoFolds()
    history.replaceState(null, '', '/' + link(a))
    const b = fresh()
    await bootStudio(b, { confirm: () => Promise.reject(new Error('must not ask')) })
    expect(b.getState().history.steps.map(s => s.label)).toHaveLength(2)
    const fa = current(a.getState().history)
    const fb = current(b.getState().history)
    expect(fb.faces_vertices).toEqual(fa.faces_vertices)
    expect(fb.edges_assignment).toEqual(fa.edges_assignment)
    fa.vertices_coords.forEach((v, i) => v.forEach((x, k) => expect(fb.vertices_coords[i]![k]!).toBeCloseTo(x, 4)))
    expect(b.getState().history.cursor).toBe(2)
    expect(b.getState().paper).toEqual(a.getState().paper)
    expect(location.hash).toBe('')
    expect(b.getState().pending).toBe(false)
    flushSave() // the opened model is the new autosave
    expect(JSON.parse(localStorage.getItem(AUTOSAVE_KEY)!).steps).toHaveLength(2)
  })

  test('with an autosave, it asks first; Replace loads the shared model', async () => {
    const a = await twoFolds()
    const mine = fresh()
    await fold(mine, [1, 1], [0, 0])
    saveHistory(mine.getState().history, mine.getState().paper)
    flushSave()
    history.replaceState(null, '', '/' + link(a))
    const b = fresh()
    const confirm = vi.fn(() => Promise.resolve(true))
    await bootStudio(b, { confirm })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(b.getState().history.steps).toHaveLength(2)
    expect(location.hash).toBe('')
  })

  test('with an autosave, Cancel keeps the autosave', async () => {
    const a = await twoFolds()
    const mine = fresh()
    await fold(mine, [1, 1], [0, 0])
    saveHistory(mine.getState().history, mine.getState().paper)
    flushSave()
    const saved = localStorage.getItem(AUTOSAVE_KEY)
    history.replaceState(null, '', '/' + link(a))
    const b = fresh()
    await bootStudio(b, { confirm: () => Promise.resolve(false) })
    expect(b.getState().history.steps).toHaveLength(1)
    expect(b.getState().pending).toBe(false)
    flushSave()
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBe(saved)
    expect(location.hash).toBe('')
  })

  test('a damaged link toasts the reason and leaves the autosave untouched', async () => {
    const a = await twoFolds()
    const mine = fresh()
    await fold(mine, [1, 1], [0, 0])
    saveHistory(mine.getState().history, mine.getState().paper)
    flushSave()
    const saved = localStorage.getItem(AUTOSAVE_KEY)
    history.replaceState(null, '', '/' + link(a).slice(0, -9)) // truncated
    const b = fresh()
    await bootStudio(b, { confirm: () => Promise.reject(new Error('must not ask')) })
    expect(notices.getState().message).toBe(DAMAGED)
    expect(b.getState().history.steps).toHaveLength(1) // autosave restored
    flushSave()
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBe(saved)
    expect(location.hash).toBe('')
  })

  test('a link from a newer Ori says so and keeps the work', async () => {
    history.replaceState(null, '', '/#v9:abcd')
    const b = fresh()
    await bootStudio(b)
    expect(notices.getState().message).toBe(NEWER)
    expect(b.getState().history.steps).toHaveLength(0)
    expect(b.getState().paper.size).toBe(DEFAULT_PAPER.size) // blank sheet seeded
    expect(location.hash).toBe('')
  })

  test('a link whose steps the engine refuses is damaged, not applied', async () => {
    const a = await twoFolds()
    // Same step twice: the second fold of the same crease cannot be a valid replay of step 2's frame.
    const steps = a.getState().history.steps
    const bogus = '#' + encodeShare(a.getState().paper, [steps[1]!, steps[1]!, steps[1]!])
    history.replaceState(null, '', '/' + bogus)
    const b = fresh()
    await bootStudio(b)
    expect(notices.getState().message).toBe(DAMAGED)
    expect(b.getState().history.steps).toHaveLength(0)
  })

  test('a hash that is not a share link is left alone', async () => {
    history.replaceState(null, '', '/#about')
    const b = fresh()
    await bootStudio(b)
    expect(location.hash).toBe('#about')
    expect(notices.getState().message).toBeNull()
  })
})

describe('a link pasted into an open tab (hashchange)', () => {
  const paste = async (hash: string) => {
    history.replaceState(null, '', '/' + hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await vi.waitFor(() => expect(location.hash).toBe(''))
  }

  test('with no work it replaces the blank sheet without asking', async () => {
    const a = await twoFolds()
    const b = fresh()
    await bootStudio(b, { confirm: () => Promise.reject(new Error('must not ask')) })
    await paste(link(a))
    await vi.waitFor(() => expect(b.getState().history.steps).toHaveLength(2))
    expect(b.getState()).toMatchObject({ pending: false, restoring: false })
  })

  test('with work it asks: Cancel keeps it, Replace opens the link', async () => {
    const a = await twoFolds()
    const b = fresh()
    let answer = false
    const confirm = vi.fn(() => Promise.resolve(answer))
    await bootStudio(b, { confirm })
    await fold(b, [1, 1], [0, 0])
    await paste(link(a))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(b.getState().history.steps).toHaveLength(1)
    answer = true
    await paste(link(a))
    await vi.waitFor(() => expect(b.getState().history.steps).toHaveLength(2))
    flushSave()
    expect(JSON.parse(localStorage.getItem(AUTOSAVE_KEY)!).steps).toHaveLength(2)
  })

  test('a non-share hash change is ignored', async () => {
    const b = fresh()
    await bootStudio(b)
    history.replaceState(null, '', '/#about')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await new Promise(r => setTimeout(r, 20))
    expect(location.hash).toBe('#about')
  })
})
