// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PAPER_SIZES, createPaper, landmarks, startHistory } from '@engine'
import type { Frame, Vec2 } from '@engine'
import { halfFolded } from '../engine/testkit'
import { inProcessCommitter } from './committer'
import { createKeyboardFold, nextLandmark } from './keyboardFold'
import { createStudioStore } from './store'
import { useUi } from './ui'

const square = () => landmarks(startHistory(createPaper(PAPER_SIZES.square)).frames[0])
const at = (p: Vec2) => (l: { p: Vec2 }) => Math.abs(l.p[0] - p[0]) < 1e-9 && Math.abs(l.p[1] - p[1]) < 1e-9

describe('nextLandmark', () => {
  test('from the bottom-left corner going right gives the bottom midpoint', () => {
    const next = nextLandmark(square(), [0, 0], 'right')
    expect(next.p).toEqual([0.5, 0])
    expect(next.kind).toBe('midpoint')
  })

  test('arrows pick the nearest landmark inside the 45 degree cone, and stay put when there is none', () => {
    const ls = square()
    expect(nextLandmark(ls, [0, 0], 'up').p).toEqual([0, 0.5])
    expect(nextLandmark(ls, [1, 1], 'left').p).toEqual([0.5, 1])
    expect(nextLandmark(ls, [1, 1], 'down').p).toEqual([1, 0.5])
    // nothing lies to the left of the left edge
    expect(nextLandmark(ls, [0, 0.5], 'left').p).toEqual([0, 0.5])
    // the cone is +-45 degrees: from (0.5, 0) 'up' must not jump to a side midpoint (90 degrees off)
    const up = nextLandmark(ls, [0.5, 0], 'up')
    expect(up.p).toEqual([0.5, 1])
  })

  test('tab walks reading order: top to bottom, left to right, wrapping; from null it is the first', () => {
    const ls = square()
    const order: Vec2[] = []
    let from: Vec2 | null = null
    for (let i = 0; i < ls.length; i++) {
      const n = nextLandmark(ls, from, 'tab')
      order.push(n.p)
      from = n.p
    }
    expect(order[0]).toEqual([0, 1]) // top-left first
    expect(order[1]).toEqual([0.5, 1])
    expect(order[2]).toEqual([1, 1])
    for (let i = 1; i < order.length; i++) {
      const [a, b] = [order[i - 1]!, order[i]!]
      expect(b[1] < a[1] - 1e-9 || (Math.abs(b[1] - a[1]) < 1e-9 && b[0] > a[0])).toBe(true)
    }
    expect(order[order.length - 1]).toEqual([1, 0]) // bottom-right last
    expect(nextLandmark(ls, [1, 0], 'tab').p).toEqual([0, 1]) // wraps
    expect(nextLandmark(ls, [1, 0], 'tab', true).p).toEqual([0.5, 0]) // Shift+Tab goes back
  })
})

const clientOf = (p: Vec2): Vec2 => [100 + p[0] * 200, 500 - p[1] * 200]

function setup(frame?: Frame) {
  const store = createStudioStore({ committer: inProcessCommitter, reduced: () => true })
  if (frame) store.getState().restoreHistory(startHistory(frame))
  const marker = vi.fn()
  const said: string[] = []
  const kf = createKeyboardFold({ stage: { setHoverMarker: marker, clientOf }, store, announce: t => said.push(t) })
  const press = (key: string, shiftKey = false) => kf.key({ key, shiftKey })
  return { store, marker, said, kf, press }
}

describe('keyboard fold flow', () => {
  test('fold key, Enter on the grab, arrows to the target, Enter commits a step', async () => {
    const { store, kf, press, marker } = setup()
    kf.start()
    expect(kf.phase()).toBe('grab')
    expect(marker).toHaveBeenLastCalledWith([0, 1]) // the cursor starts top-left
    expect(press('Enter')).toBe(true)
    expect(kf.phase()).toBe('target')
    expect(store.getState().gesture?.grab).toEqual([0, 1])
    press('ArrowRight')
    press('ArrowRight')
    expect(marker).toHaveBeenLastCalledWith([1, 1])
    expect(store.getState().preview).not.toBeNull() // live preview while cycling targets
    press('Enter')
    await vi.waitFor(() => expect(store.getState().history.steps).toHaveLength(1))
    expect(store.getState().history.steps[0]!.label).toBe('Valley fold · top flap · 180°')
    expect(kf.phase()).toBe('idle')
    expect(marker).toHaveBeenLastCalledWith(null)
  })

  test('plus and minus change the angle in 22.5 degree steps; they clamp at 22.5 and 180', async () => {
    const { store, kf, press } = setup()
    kf.start()
    press('Enter')
    press('ArrowRight')
    press('ArrowRight')
    press('-')
    expect(store.getState().preview!.angleDeg).toBeCloseTo(157.5)
    press('-')
    expect(store.getState().preview!.angleDeg).toBeCloseTo(135)
    press('+')
    expect(store.getState().preview!.angleDeg).toBeCloseTo(157.5)
    press('+')
    press('+')
    expect(store.getState().preview!.angleDeg).toBeCloseTo(180)
    for (let i = 0; i < 12; i++) press('-')
    expect(store.getState().preview!.angleDeg).toBeCloseTo(22.5)
    press('=') // unshifted plus key
    expect(store.getState().preview!.angleDeg).toBeCloseTo(45)
    press('Enter')
    await vi.waitFor(() => expect(store.getState().history.steps).toHaveLength(1))
    expect((store.getState().history.steps[0]!.params as { angleDeg: number }).angleDeg).toBeCloseTo(45)
  })

  test('Escape cancels the gesture and hides the cursor; keys do nothing when idle', () => {
    const { store, kf, press, marker } = setup()
    expect(press('Enter')).toBe(false)
    expect(press('ArrowRight')).toBe(false)
    kf.start()
    press('Enter')
    press('ArrowRight')
    expect(store.getState().gesture).not.toBeNull()
    expect(press('Escape')).toBe(true)
    expect(store.getState().gesture).toBeNull()
    expect(store.getState().preview).toBeNull()
    expect(kf.phase()).toBe('idle')
    expect(marker).toHaveBeenLastCalledWith(null)
  })

  test('Escape while choosing the grab ends the mode', () => {
    const { kf, press } = setup()
    kf.start()
    press('Escape')
    expect(kf.phase()).toBe('idle')
  })

  test('Enter on the grab point itself does not commit; the cursor announcements name the landmark', () => {
    const { store, kf, press, said } = setup()
    kf.start()
    press('Enter')
    press('Enter') // no target chosen yet
    expect(store.getState().history.steps).toHaveLength(0)
    expect(store.getState().gesture).not.toBeNull()
    expect(said.some(t => /top left corner/i.test(t))).toBe(true)
  })

  test('tool modes use the same flow (the grab begins with the active tool)', () => {
    const { store, kf, press } = setup()
    store.getState().setTool('squash')
    kf.start()
    press('Enter')
    expect(store.getState().gesture?.tool).toBe('squash')
  })

  test('Tab cycles the cursor in reading order and Shift+Tab goes back', () => {
    const { kf, press, marker } = setup()
    kf.start()
    press('Tab')
    expect(marker).toHaveBeenLastCalledWith([0.5, 1])
    press('Tab', true)
    expect(marker).toHaveBeenLastCalledWith([0, 1])
  })

  test('a changed history (undo, preset) drops the mode', () => {
    const { store, kf } = setup()
    kf.start()
    store.getState().newSheet('a4')
    expect(kf.phase()).toBe('idle')
  })

  test('moving the target cursor back onto the grab point clears the preview; Enter does not commit', async () => {
    const { store, kf, press, said } = setup()
    kf.start()
    press('Enter')
    press('ArrowRight')
    expect(store.getState().preview).not.toBeNull()
    press('ArrowLeft') // back on the grab landmark
    expect(store.getState().preview).toBeNull()
    expect(store.getState().gesture?.progress).toBe(0)
    press('Enter')
    await new Promise(r => setTimeout(r, 20))
    expect(store.getState().history.steps).toHaveLength(0)
    expect(said[said.length - 1]).toBe('Choose a point to fold to first.')
  })

  test('F does nothing while a gesture (a mouse drag) is already live', () => {
    const { store, kf } = setup()
    store.getState().begin([1, 1])
    store.getState().drag([0, 0], 1)
    kf.start()
    expect(kf.phase()).toBe('idle')
    expect(store.getState().gesture?.grab).toEqual([1, 1])
  })
})

describe('keyboard layer belt (spec 09)', () => {
  beforeEach(() => useUi.getState().closeBelt())
  afterEach(() => useUi.getState().closeBelt())

  /** Half-folded sheet, grab set and a target chosen: phase 'target'. */
  const targeting = () => {
    const t = setup(halfFolded())
    t.kf.start()
    t.press('Enter')
    t.press('Tab')
    expect(t.kf.phase()).toBe('target')
    return t
  }

  test('L opens the belt at the grab, top layer hovered, and announces it', () => {
    const { kf, said, store } = targeting()
    expect(kf.openBelt()).toBe(true)
    const belt = useUi.getState().belt!
    expect(belt.keyboard).toBe(true)
    expect(belt.hovered).toBe(0)
    expect(belt.stack.faces.length).toBe(2)
    expect([belt.clientX, belt.clientY]).toEqual(clientOf(store.getState().gesture!.grab))
    expect(said.at(-1)).toBe('Layer 1 of 2: top flap')
  })

  test('ArrowDown announces the next layer; Enter takes it and closes the belt', () => {
    const { kf, said, store, press } = targeting()
    kf.openBelt()
    expect(press('ArrowDown')).toBe(true)
    expect(useUi.getState().belt!.hovered).toBe(1)
    expect(said.at(-1)).toBe('Layer 2 of 2: top flap and 1 below')
    press('ArrowDown') // clamped at the bottom
    expect(useUi.getState().belt!.hovered).toBe(1)
    press('ArrowUp')
    expect(said.at(-1)).toBe('Layer 1 of 2: top flap')
    press('ArrowDown')
    expect(press('Enter')).toBe(true)
    expect(store.getState().gesture!.layers).toBe(2)
    expect(useUi.getState().belt).toBeNull()
    expect(store.getState().history.steps).toHaveLength(0) // Enter in the belt picks, it does not commit
    expect(kf.phase()).toBe('target')
  })

  test('Escape closes the belt only: the keyboard fold stays in target', () => {
    const { kf, store, press } = targeting()
    kf.openBelt()
    expect(press('Escape')).toBe(true)
    expect(useUi.getState().belt).toBeNull()
    expect(kf.phase()).toBe('target')
    expect(store.getState().gesture).not.toBeNull()
    expect(store.getState().gesture!.layers).toBe(1)
  })

  test('while the belt is open the cursor keys wait, and other keys fall through to the bindings', () => {
    const { kf, press } = targeting()
    kf.openBelt()
    expect(press('Tab')).toBe(true)
    expect(press('+')).toBe(true)
    expect(useUi.getState().belt).not.toBeNull()
    expect(press('m')).toBe(false)
  })

  test('openBelt is refused outside the target phase', () => {
    const { kf, press } = setup(halfFolded())
    expect(kf.openBelt()).toBe(false)
    kf.start()
    expect(kf.openBelt()).toBe(false) // grab phase: no grab point yet
    press('Enter')
    expect(kf.openBelt()).toBe(true)
    expect(useUi.getState().belt).not.toBeNull()
  })

  test('a single layer has nothing to pick: the belt stays closed', () => {
    const { kf, press, said } = setup()
    kf.start()
    press('Enter')
    expect(kf.openBelt()).toBe(false)
    expect(useUi.getState().belt).toBeNull()
    expect(said.at(-1)).toBe('One layer here: nothing to pick.')
  })

  test('cancelling the keyboard fold closes an open belt', () => {
    const { kf } = targeting()
    kf.openBelt()
    kf.cancel()
    expect(useUi.getState().belt).toBeNull()
  })
})
