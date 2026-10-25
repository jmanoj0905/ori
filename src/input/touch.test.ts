// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cloneBindings, DEFAULT_BINDINGS } from '../settings/bindings'
import type { Action } from '../settings/schema'
import { createRouter, type ActionEvent } from './router'

type Log = [Action, ActionEvent][]

let el: HTMLElement
let disposers: (() => void)[] = []

beforeEach(() => {
  el = document.createElement('div')
  document.body.appendChild(el)
  disposers = []
})
afterEach(() => {
  disposers.forEach(d => d())
  el.remove()
})

const ACTIONS: Action[] = ['fold', 'orbit', 'pan', 'zoom', 'cancel']
const setup = (actions: Action[] = ACTIONS) => {
  const log: Log = []
  const handlers: Partial<Record<Action, (e: ActionEvent) => void>> = {}
  for (const a of actions) handlers[a] = e => void log.push([a, e])
  disposers.push(createRouter(el, () => cloneBindings(DEFAULT_BINDINGS), handlers))
  return log
}

const touch = (type: string, id: number, x: number, y: number) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerId', { value: id })
  Object.defineProperty(e, 'pointerType', { value: 'touch' })
  ;(type === 'pointerdown' ? el : window).dispatchEvent(e)
  return e
}
const phases = (log: Log, a: Action) => log.filter(([x]) => x === a).map(([, e]) => e.phase)
const of = (log: Log, a: Action) => log.filter(([x]) => x === a).map(([, e]) => e)

describe('touch gestures', () => {
  test('one-finger drag emits fold start, move, end', () => {
    const log = setup()
    touch('pointerdown', 1, 100, 100)
    touch('pointermove', 1, 130, 110)
    touch('pointerup', 1, 130, 110)
    expect(phases(log, 'fold')).toEqual(['start', 'move', 'end'])
    expect(of(log, 'fold')[1]).toMatchObject({ clientX: 130, clientY: 110, dx: 30, dy: 10 })
    expect(phases(log, 'orbit')).toEqual([])
  })

  test('one finger folds even when Fold is remapped away from the left button', () => {
    const b = cloneBindings(DEFAULT_BINDINGS)
    b.fold = [{ type: 'mouse', button: 2, mods: { mod: false, shift: false, alt: false } }]
    const log: Log = []
    disposers.push(createRouter(el, () => b, { fold: e => void log.push(['fold', e]) }))
    touch('pointerdown', 1, 10, 10)
    touch('pointerup', 1, 10, 10)
    expect(phases(log, 'fold')).toEqual(['start', 'end'])
  })

  test('two-finger drag emits orbit (centre movement), not zoom', () => {
    const log = setup()
    touch('pointerdown', 1, 100, 200)
    touch('pointerdown', 2, 200, 200)
    // both fingers move 30px right / 20px down together: the distance is constant
    touch('pointermove', 1, 130, 220)
    touch('pointermove', 2, 230, 220)
    touch('pointerup', 2, 230, 220)
    touch('pointerup', 1, 130, 220)
    const moves = of(log, 'orbit').filter(e => e.phase === 'move')
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.reduce((s, e) => s + (e.dx ?? 0), 0)).toBeCloseTo(30, 5)
    expect(moves.reduce((s, e) => s + (e.dy ?? 0), 0)).toBeCloseTo(20, 5)
    expect(phases(log, 'orbit').at(-1)).toBe('end')
    expect(phases(log, 'zoom')).toEqual([])
  })

  test('pinch emits zoom: spreading zooms in (negative delta), pinching zooms out', () => {
    const log = setup()
    touch('pointerdown', 1, 150, 200)
    touch('pointerdown', 2, 250, 200)
    touch('pointermove', 1, 100, 200) // spread 100 -> 200
    touch('pointermove', 2, 300, 200)
    const zin = of(log, 'zoom')
    expect(zin.length).toBeGreaterThan(0)
    expect(zin.reduce((s, e) => s + (e.delta ?? 0), 0)).toBeLessThan(0)
    expect(phases(log, 'orbit').filter(p => p === 'move')).toEqual([])
    log.length = 0
    touch('pointermove', 1, 180, 200) // pinch 200 -> 120
    touch('pointermove', 2, 220, 200)
    expect(of(log, 'zoom').reduce((s, e) => s + (e.delta ?? 0), 0)).toBeGreaterThan(0)
  })

  test('a second finger mid-fold cancels the fold (no end, no commit) and starts a two-finger gesture', () => {
    const log = setup()
    touch('pointerdown', 1, 100, 100)
    touch('pointermove', 1, 120, 110)
    touch('pointerdown', 2, 220, 110)
    expect(phases(log, 'fold')).toEqual(['start', 'move'])
    expect(phases(log, 'cancel')).toEqual(['tap'])
    touch('pointermove', 2, 240, 110)
    touch('pointermove', 1, 100, 110)
    expect(phases(log, 'fold')).toEqual(['start', 'move']) // the fold never resumes or ends
    expect(of(log, 'zoom').length + of(log, 'orbit').length).toBeGreaterThan(0)
  })

  test('lifting one finger of a two-finger gesture does not start a fold with the other', () => {
    const log = setup()
    touch('pointerdown', 1, 100, 100)
    touch('pointerdown', 2, 200, 100)
    touch('pointerup', 2, 200, 100)
    touch('pointermove', 1, 150, 150)
    touch('pointerup', 1, 150, 150)
    // the first finger's fold started (it was alone), was cancelled by finger 2, and nothing resumed:
    expect(phases(log, 'fold')).toEqual(['start'])
    expect(phases(log, 'cancel')).toEqual(['tap'])
  })

  test('pointercancel cancels the fold; lifting both fingers ends cleanly', () => {
    const log = setup()
    touch('pointerdown', 1, 100, 100)
    touch('pointercancel', 1, 100, 100)
    expect(phases(log, 'cancel')).toEqual(['tap'])
    expect(phases(log, 'fold')).toEqual(['start'])
    log.length = 0
    touch('pointerdown', 1, 100, 100)
    touch('pointerdown', 2, 200, 100)
    touch('pointermove', 1, 160, 100)
    touch('pointermove', 2, 260, 100)
    touch('pointerup', 1, 160, 100)
    touch('pointerup', 2, 260, 100)
    expect(phases(log, 'orbit').filter(p => p === 'end')).toHaveLength(1)
    // a fresh single touch folds again
    log.length = 0
    touch('pointerdown', 3, 50, 50)
    expect(phases(log, 'fold')).toEqual(['start'])
  })

  test('a finger that missed the paper does not block a later two-finger gesture', () => {
    const log: Log = []
    disposers.push(createRouter(el, () => cloneBindings(DEFAULT_BINDINGS), {
      fold: e => { log.push(['fold', e]); return false },
      orbit: e => void log.push(['orbit', e]),
      zoom: e => void log.push(['zoom', e]),
    }))
    touch('pointerdown', 1, 5, 5)
    touch('pointerdown', 2, 105, 5)
    touch('pointermove', 1, 5, 5)
    touch('pointermove', 2, 205, 5)
    expect(of(log, 'zoom').length).toBeGreaterThan(0)
  })

  test('the canvas takes no browser touch handling', () => {
    setup()
    expect(el.style.getPropertyValue('touch-action')).toBe('none')
  })
})

describe('ctrl+wheel (trackpad pinch)', () => {
  const wheel = (init: WheelEventInit) => {
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(e)
    return e
  }
  test('is zoom and is not left to the browser page zoom', () => {
    const log = setup()
    const e = wheel({ deltaY: -4, ctrlKey: true })
    expect(e.defaultPrevented).toBe(true)
    expect(phases(log, 'zoom')).toEqual(['tap'])
    expect(of(log, 'zoom')[0]!.delta!).toBeLessThan(0)
  })
  test('plain wheel zoom is unchanged', () => {
    const log = setup()
    wheel({ deltaY: 100 })
    expect(of(log, 'zoom')[0]!.delta).toBe(100)
  })
  test('a binding that claims ctrl+wheel keeps it', () => {
    const b = cloneBindings(DEFAULT_BINDINGS)
    b.pan = [{ type: 'wheel', mods: { mod: true, shift: false, alt: false } }]
    const log: Log = []
    disposers.push(createRouter(el, () => b, {
      zoom: e => void log.push(['zoom', e]), pan: e => void log.push(['pan', e]),
    }))
    wheel({ deltaY: -4, ctrlKey: true })
    expect(of(log, 'zoom')).toEqual([])
  })
})

describe('review fixes', () => {
  const lost = (id: number) => {
    const e = new MouseEvent('lostpointercapture', { bubbles: true })
    Object.defineProperty(e, 'pointerId', { value: id })
    Object.defineProperty(e, 'pointerType', { value: 'touch' })
    el.dispatchEvent(e)
  }
  test('lostpointercapture from releasing finger 1 does not kill the two-finger gesture', () => {
    const log = setup()
    touch('pointerdown', 1, 100, 100)
    touch('pointerdown', 2, 200, 100)
    lost(1) // the browser reports the capture the router just released
    touch('pointermove', 1, 100, 160)
    touch('pointermove', 2, 200, 160)
    expect(of(log, 'orbit').some(e => e.phase === 'move')).toBe(true)
    touch('pointerup', 1, 100, 160)
    touch('pointerdown', 3, 50, 50) // the remaining finger still blocks folds
    expect(phases(log, 'fold')).toEqual(['start'])
  })

  test('touch never disturbs a mouse drag', () => {
    const log = setup()
    const m = (type: string, init: Record<string, unknown> = {}) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...init })
      Object.defineProperty(e, 'pointerId', { value: 9 })
      Object.defineProperty(e, 'pointerType', { value: 'mouse' })
      ;(type === 'pointerdown' ? el : window).dispatchEvent(e)
    }
    m('pointerdown', { clientX: 5, clientY: 5 })
    touch('pointerdown', 1, 100, 100)
    touch('pointerdown', 2, 200, 100)
    touch('pointermove', 2, 260, 100)
    expect(phases(log, 'cancel')).toEqual([])
    m('pointermove', { clientX: 9, clientY: 9 })
    m('pointerup', { buttons: 0 })
    expect(phases(log, 'fold')).toEqual(['start', 'move', 'end'])
  })

  test('a mouse press does not end a touch fold', () => {
    const log = setup()
    touch('pointerdown', 1, 100, 100)
    const e = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1 })
    Object.defineProperty(e, 'pointerId', { value: 9 })
    Object.defineProperty(e, 'pointerType', { value: 'mouse' })
    el.dispatchEvent(e)
    expect(phases(log, 'cancel')).toEqual([])
  })

  test('a real ctrl+mouse notch zooms like a plain notch; a pinch-sized delta is boosted', () => {
    const log = setup()
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true }))
    expect(of(log, 'zoom')[0]!.delta).toBe(100)
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 3, ctrlKey: true, bubbles: true, cancelable: true }))
    expect(of(log, 'zoom')[1]!.delta).toBe(30)
  })
})
