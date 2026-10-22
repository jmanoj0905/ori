// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cloneBindings, DEFAULT_BINDINGS } from '../settings/bindings'
import type { Action, Bindings } from '../settings/schema'
import { createRouter, type ActionEvent } from './router'

type Log = [Action, ActionEvent][]

let el: HTMLElement
let disposers: (() => void)[] = []
let bindings: Bindings

beforeEach(() => {
  el = document.createElement('div')
  document.body.appendChild(el)
  bindings = cloneBindings(DEFAULT_BINDINGS)
  disposers = []
})
afterEach(() => {
  disposers.forEach(d => d())
  el.remove()
})

const setup = (actions: Action[] = ['fold', 'orbit', 'pan', 'zoom', 'layersLess', 'layersMore', 'angleSnap', 'valley', 'mountain', 'undo', 'redo', 'cancel']) => {
  const log: Log = []
  const handlers: Partial<Record<Action, (e: ActionEvent) => void>> = {}
  for (const a of actions) handlers[a] = e => void log.push([a, e])
  disposers.push(createRouter(el, () => bindings, handlers))
  return log
}

const ptr = (type: string, init: Record<string, unknown> = {}, target: EventTarget = el) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...init })
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 })
  target.dispatchEvent(e)
  return e
}
const key = (code: string, init: KeyboardEventInit = {}, type = 'keydown', target: EventTarget = window) => {
  const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}
const wheel = (deltaY: number, init: WheelEventInit = {}) => {
  const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(e)
  return e
}
const phases = (log: Log, a: Action) => log.filter(([x]) => x === a).map(([, e]) => e.phase)

describe('mouse drags', () => {
  test('left-drag emits fold start, move, end with coordinates', () => {
    const log = setup()
    ptr('pointerdown', { clientX: 10, clientY: 20 })
    ptr('pointermove', { clientX: 15, clientY: 26 })
    ptr('pointerup', { clientX: 15, clientY: 26, buttons: 0 })
    expect(phases(log, 'fold')).toEqual(['start', 'move', 'end'])
    expect(log[0][1]).toMatchObject({ clientX: 10, clientY: 20 })
    expect(log[1][1]).toMatchObject({ clientX: 15, clientY: 26, dx: 5, dy: 6 })
  })

  test('right-drag orbits and middle-drag pans; the context menu is suppressed', () => {
    const log = setup()
    ptr('pointerdown', { button: 2, buttons: 2 })
    ptr('pointermove', { button: 2, buttons: 2, clientX: 4, clientY: 0 })
    ptr('pointerup', { button: 2, buttons: 0 })
    ptr('pointerdown', { button: 1, buttons: 4, pointerId: 2 })
    ptr('pointermove', { button: 1, buttons: 4, clientX: 1, clientY: 1, pointerId: 2 })
    ptr('pointerup', { button: 1, buttons: 0, pointerId: 2 })
    expect(phases(log, 'orbit')).toEqual(['start', 'move', 'end'])
    expect(phases(log, 'pan')).toEqual(['start', 'move', 'end'])
    expect(phases(log, 'fold')).toEqual([])
    const cm = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    el.dispatchEvent(cm)
    expect(cm.defaultPrevented).toBe(true)
  })

  test('a fold handler returning false rejects the drag (no move/end, wheel still zooms)', () => {
    const log: Log = []
    disposers.push(createRouter(el, () => bindings, {
      fold: e => { log.push(['fold', e]); return false },
      zoom: e => void log.push(['zoom', e]),
      layersMore: e => void log.push(['layersMore', e]),
    }))
    ptr('pointerdown')
    ptr('pointermove', { clientX: 5 })
    ptr('pointerup', { buttons: 0 })
    wheel(-100)
    expect(log.map(([a, e]) => `${a}:${e.phase}`)).toEqual(['fold:start', 'zoom:tap'])
  })
})

describe('wheel', () => {
  test('zoom when not folding, carrying deltaY; the page is not scrolled', () => {
    const log = setup()
    const e = wheel(120)
    expect(log).toHaveLength(1)
    expect(log[0][0]).toBe('zoom')
    expect(log[0][1].delta).toBe(120)
    expect(e.defaultPrevented).toBe(true)
  })

  test('while a fold is active: wheel up = layersMore, down = layersLess', () => {
    const log = setup()
    ptr('pointerdown')
    wheel(-100)
    wheel(100)
    expect(log.filter(([a]) => a === 'zoom')).toHaveLength(0)
    expect(log.filter(([a]) => a.startsWith('layers')).map(([a]) => a)).toEqual(['layersMore', 'layersLess'])
    ptr('pointerup', { buttons: 0 })
    wheel(100)
    expect(log[log.length - 1][0]).toBe('zoom')
  })

  test('small trackpad deltas accumulate to one layer step', () => {
    const log = setup()
    ptr('pointerdown')
    for (let i = 0; i < 9; i++) wheel(-10)
    expect(log.filter(([a]) => a === 'layersMore')).toHaveLength(0)
    for (let i = 0; i < 1; i++) wheel(-10)
    expect(log.filter(([a]) => a === 'layersMore')).toHaveLength(1)
  })

  test('a modifier-gated zoom binding needs the modifier', () => {
    bindings.zoom = [{ type: 'wheel', mods: { mod: true, shift: false, alt: false } }]
    const log = setup()
    wheel(100)
    expect(log).toHaveLength(0)
    wheel(100, { ctrlKey: true })
    expect(log.map(([a]) => a)).toEqual(['zoom'])
  })
})

describe('keyboard', () => {
  test('V emits valley as a tap and prevents default', () => {
    const log = setup()
    const e = key('KeyV')
    expect(log).toHaveLength(1)
    expect(log[0][0]).toBe('valley')
    expect(log[0][1].phase).toBe('tap')
    expect(e.defaultPrevented).toBe(true)
  })

  test('Ctrl+Z is undo; Ctrl+Shift+Z is redo and NOT undo; Cmd works too', () => {
    const log = setup()
    key('KeyZ', { ctrlKey: true })
    key('KeyZ', { ctrlKey: true, shiftKey: true })
    key('KeyZ', { metaKey: true })
    expect(log.map(([a]) => a)).toEqual(['undo', 'redo', 'undo'])
    log.length = 0
    key('KeyZ') // bare Z is nothing
    key('KeyZ', { altKey: true, ctrlKey: true })
    expect(log).toHaveLength(0)
  })

  test('keys are ignored while typing in an input, textarea or contenteditable', () => {
    const log = setup()
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const ce = document.createElement('div')
    ce.setAttribute('contenteditable', 'true')
    Object.defineProperty(ce, 'isContentEditable', { value: true })
    document.body.append(input, area, ce)
    for (const t of [input, area, ce]) {
      const e = key('KeyV', {}, 'keydown', t)
      expect(e.defaultPrevented).toBe(false)
    }
    expect(log).toHaveLength(0)
    input.remove(); area.remove(); ce.remove()
  })

  test('sliders, checkboxes and buttons do not count as typing, so shortcuts keep working after touching them', () => {
    const log = setup(['valley'])
    for (const type of ['range', 'checkbox', 'color', 'radio']) {
      const input = document.createElement('input')
      input.type = type
      document.body.append(input)
      input.focus()
      const e = key('KeyV', {}, 'keydown', input)
      expect(e.defaultPrevented).toBe(true)
      input.remove()
    }
    expect(log).toHaveLength(4)
    for (const type of ['text', 'number', 'search']) {
      const input = document.createElement('input')
      input.type = type
      document.body.append(input)
      input.focus()
      key('KeyV', {}, 'keydown', input)
      input.remove()
    }
    expect(log).toHaveLength(4)
  })

  test('keys do nothing while focus is inside a modal dialog, Esc included (Task 7 carry)', () => {
    const log = setup(['cancel', 'valley', 'undo'])
    // A dialog that, unlike ConfirmDialog, does not stop the key itself: the router must stand down.
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const btn = document.createElement('button')
    dialog.append(btn)
    document.body.append(dialog)
    btn.focus()
    for (const [code, init] of [['Escape', {}], ['KeyV', {}], ['KeyZ', { ctrlKey: true }]] as const) {
      const e = key(code, init, 'keydown', btn)
      expect(e.defaultPrevented).toBe(false)
    }
    expect(log).toHaveLength(0)
    dialog.remove()
    key('Escape')
    expect(phases(log, 'cancel')).toEqual(['tap']) // back to normal once it is gone
  })

  test('a canvas press blurs a focused island control', () => {
    setup()
    const slider = document.createElement('input')
    slider.type = 'range'
    document.body.append(slider)
    slider.focus()
    expect(document.activeElement).toBe(slider)
    ptr('pointerdown')
    expect(document.activeElement).not.toBe(slider)
    slider.remove()
  })

  test('Escape emits cancel and ends an active fold drag so later moves are ignored', () => {
    const log = setup()
    ptr('pointerdown')
    key('Escape')
    ptr('pointermove', { clientX: 9 })
    ptr('pointerup', { buttons: 0 })
    expect(log.map(([a, e]) => `${a}:${e.phase}`)).toEqual(['fold:start', 'cancel:tap'])
  })

  test('held modifier: Shift keydown/keyup emit angleSnap start/end, once', () => {
    const log = setup()
    key('ShiftLeft', { shiftKey: true })
    key('ShiftLeft', { shiftKey: true, repeat: true })
    key('ShiftLeft', {}, 'keyup')
    expect(phases(log, 'angleSnap')).toEqual(['start', 'end'])
  })

  test('shift held before a click does not stop the fold from matching', () => {
    const log = setup()
    ptr('pointerdown', { shiftKey: true })
    expect(phases(log, 'fold')).toEqual(['start'])
  })
})

describe('cancel paths (Review Focus 2)', () => {
  test('pointercancel mid-fold emits cancel, not end', () => {
    const log = setup()
    ptr('pointerdown')
    ptr('pointercancel', { buttons: 0 })
    ptr('pointerup', { buttons: 0 })
    expect(log.map(([a, e]) => `${a}:${e.phase}`)).toEqual(['fold:start', 'cancel:tap'])
  })

  test('window blur mid-fold emits cancel', () => {
    const log = setup()
    ptr('pointerdown')
    window.dispatchEvent(new Event('blur'))
    expect(log.map(([a, e]) => `${a}:${e.phase}`)).toEqual(['fold:start', 'cancel:tap'])
  })

  test('blur ends an orbit drag and releases a held modifier', () => {
    const log = setup()
    ptr('pointerdown', { button: 2, buttons: 2 })
    key('ShiftLeft', { shiftKey: true })
    window.dispatchEvent(new Event('blur'))
    expect(phases(log, 'orbit')).toEqual(['start', 'end'])
    expect(phases(log, 'angleSnap')).toEqual(['start', 'end'])
    expect(phases(log, 'cancel')).toEqual([])
  })

  test('blur with nothing active emits nothing', () => {
    const log = setup()
    window.dispatchEvent(new Event('blur'))
    expect(log).toHaveLength(0)
  })

  test('lost pointer capture mid-fold cancels', () => {
    const log = setup()
    ptr('pointerdown')
    ptr('lostpointercapture')
    expect(log.map(([a, e]) => `${a}:${e.phase}`)).toEqual(['fold:start', 'cancel:tap'])
  })

  test('release outside the window (capture failed): window pointerup ends the drag', () => {
    const log = setup()
    ptr('pointerdown')
    ptr('pointerup', { buttons: 0, clientX: 900 }, window)
    expect(phases(log, 'fold')).toEqual(['start', 'end'])
  })

  test('a move with no buttons down mid-fold cancels (the release was missed)', () => {
    const log = setup()
    ptr('pointerdown')
    ptr('pointermove', { buttons: 0, clientX: 3 })
    expect(log.map(([a, e]) => `${a}:${e.phase}`)).toEqual(['fold:start', 'cancel:tap'])
  })

  test('a press from a different pointer drops the stale fold with a cancel', () => {
    const log = setup()
    ptr('pointerdown', { pointerId: 1 })
    ptr('pointerdown', { pointerId: 2 })
    expect(log.map(([a, e]) => `${a}:${e.phase}`)).toEqual(['fold:start', 'cancel:tap', 'fold:start'])
  })
})

describe('live bindings and dispose', () => {
  test('a remap takes effect without re-creating the router', () => {
    const log = setup()
    key('KeyV')
    bindings = { ...bindings, valley: [{ type: 'key', code: 'KeyQ', mods: { mod: false, shift: false, alt: false } }] }
    key('KeyV')
    key('KeyQ')
    expect(log.map(([a]) => a)).toEqual(['valley', 'valley'])
    // Swap fold and orbit mouse buttons live.
    bindings = { ...bindings, fold: [{ type: 'mouse', button: 2, mods: { mod: false, shift: false, alt: false } }], orbit: [{ type: 'mouse', button: 0, mods: { mod: false, shift: false, alt: false } }] }
    log.length = 0
    ptr('pointerdown', { button: 2, buttons: 2 })
    ptr('pointerup', { button: 2, buttons: 0 })
    expect(phases(log, 'fold')).toEqual(['start', 'end'])
  })

  test('dispose removes every listener', () => {
    const log: Log = []
    const off = createRouter(el, () => bindings, { valley: e => void log.push(['valley', e]), fold: e => void log.push(['fold', e]), zoom: e => void log.push(['zoom', e]) })
    off()
    key('KeyV'); ptr('pointerdown'); wheel(1)
    expect(log).toHaveLength(0)
  })

  test('actions without a handler are not swallowed', () => {
    setup(['zoom'])
    expect(key('KeyV').defaultPrevented).toBe(false)
  })
})

describe('layout-aware keys (final review item 5)', () => {
  test('QWERTZ: Ctrl + the key printed Z (code KeyY) is undo; "?" typed on any layout opens the sheet', async () => {
    const { DEFAULT_BINDINGS, cloneBindings } = await import('../settings/bindings')
    const el = document.createElement('div')
    document.body.appendChild(el)
    const seen: string[] = []
    const dispose = createRouter(el, () => cloneBindings(DEFAULT_BINDINGS), {
      undo: () => void seen.push('undo'), redo: () => void seen.push('redo'), shortcuts: () => void seen.push('shortcuts'),
    })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', code: 'Minus', shiftKey: true, bubbles: true, cancelable: true }))
    expect(seen).toEqual(['undo', 'shortcuts'])
    dispose()
    el.remove()
  })
})
