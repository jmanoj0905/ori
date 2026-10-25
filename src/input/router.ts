// The input router: raw pointer, keyboard and wheel events -> named actions,
// through the user's live bindings (src/settings). Nothing else in the app
// listens to raw input.
//
// Contract
//  - `getBindings` is called on every event, so a remap takes effect at once.
//  - Mouse-drag actions (fold / orbit / pan) emit start, move, end with
//    clientX/clientY (and dx/dy since the previous event, in CSS pixels).
//    A `start` handler may return `false` to refuse the drag (e.g. the press
//    missed the paper): the router then treats it as never begun.
//  - Key actions emit a single `tap`. Keys match layout-aware (settings/keys.ts):
//    letters and symbols by the character typed, named keys by code.
//  - Modifier bindings (angleSnap, forceNewFold) emit
//    `start` on press and `end` on release of the key, once per hold.
//  - Wheel: always zoom, folding or not. `delta` carries deltaY in pixels
//    (positive = out). Layers are never stepped by the wheel.
//  - `cancel` (tap) is also emitted, instead of `end`, when a fold drag is
//    lost: pointercancel, lostpointercapture, window blur, a move with no
//    button down, or a second pointer pressing. Orbit and pan just end.
//  - Touch (pointerType 'touch') is handled by its own small state machine and
//    ignores the mouse bindings: one finger on the paper is a fold (a finger
//    that misses the paper does nothing); a second finger arriving cancels the
//    fold (as Esc: `cancel`, never `end`) and starts a two-finger gesture whose
//    centre movement is `orbit` and whose finger-distance change is `zoom`
//    (delta < 0 when the fingers spread). Neither engages before TOUCH_SLOP_PX
//    of travel, so a steady pair of fingers does not jitter the view. Lifting
//    a finger ends the gesture; the finger left on the glass does not turn
//    into a fold until every finger has lifted. pointercancel / blur cancel.
//  - Ctrl+wheel (a trackpad pinch) is zoom unless some binding claims
//    Ctrl+wheel, so it never falls through to the browser's page zoom.
//  - `mod` (Ctrl-or-Cmd) matches ctrlKey || metaKey on every platform.
//    Mouse and wheel matching ignores modifiers that are themselves bound as
//    hold-modifiers (Shift for angleSnap, Alt for forceNewFold), so holding Shift never blocks a fold.
//  - Key events are ignored while focus is in an input, textarea, select or
//    contenteditable element, and while focus is inside a modal dialog
//    ([aria-modal="true"]: the confirm dialog, the settings and shortcut
//    sheets), so Esc / Z / V never reach the fold underneath.
import type { Action, Bindings, Mods } from '../settings/schema'
import { matchesKey } from '../settings/keys'

export interface ActionEvent {
  phase: 'start' | 'move' | 'end' | 'tap'
  clientX?: number
  clientY?: number
  /** Wheel zoom: deltaY in pixels (positive = out). */
  delta?: number
  /** Drag movement since the previous event, CSS pixels. */
  dx?: number
  dy?: number
  pointerId?: number
}

export type ActionHandler = (e: ActionEvent) => void | boolean
export type Handlers = Partial<Record<Action, ActionHandler>>

/** Travel (centre or finger distance, CSS px) before a two-finger gesture engages. */
export const TOUCH_SLOP_PX = 6
/** Ctrl+wheel deltas are tiny (a pinch reports ~1-10 px): scale to mouse-wheel feel. */
export const PINCH_WHEEL_GAIN = 10
/** Larger ctrl+wheel deltas are a real wheel notch, which keeps the plain wheel's zoom step. */
export const PINCH_MAX_PX = 50

const DRAGS = ['fold', 'orbit', 'pan'] as const
type DragAction = (typeof DRAGS)[number]
const MODIFIER_CODES: Record<string, 'shift' | 'alt' | 'mod'> = {
  ShiftLeft: 'shift', ShiftRight: 'shift', AltLeft: 'alt', AltRight: 'alt',
  ControlLeft: 'mod', ControlRight: 'mod', MetaLeft: 'mod', MetaRight: 'mod',
}

const eventMods = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): Mods => ({
  mod: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey,
})
const sameMods = (a: Mods, b: Mods) => a.mod === b.mod && a.shift === b.shift && a.alt === b.alt

/** <input> types that take typed text; sliders, checkboxes, colour pickers etc. do not. */
const TEXT_INPUTS = new Set(['', 'text', 'number', 'search', 'email', 'url', 'password', 'tel'])

export function isTypingTarget(t: EventTarget | null): boolean {
  const els: (Element | null)[] = [t instanceof Element ? t : null, document.activeElement]
  return els.some(n => {
    if (!n) return false
    const tag = n.tagName
    if (tag === 'INPUT') return TEXT_INPUTS.has(((n as HTMLInputElement).type || '').toLowerCase())
    return tag === 'TEXTAREA' || tag === 'SELECT' || (n as HTMLElement).isContentEditable === true
  })
}

/**
 * A modal dialog is open ([aria-modal="true"]: confirm dialog, settings or
 * shortcut sheet). While one is, nothing underneath is operable, so the router
 * stands down for every key, wherever focus happens to be (it can briefly sit on
 * <body> when a focused control unmounts).
 */
export function inModal(_target?: EventTarget | null): boolean {
  return document.querySelector('[aria-modal="true"]') !== null
}

export function createRouter(el: HTMLElement, getBindings: () => Bindings, handlers: Handlers): () => void {
  let drag: { action: DragAction; id: number; x: number; y: number; touch?: boolean } | null = null
  const held = new Set<Action>()
  // Touch: every finger down, the two-finger gesture, and whether a finger left
  // over from one must be ignored until all lift.
  const touches = new Map<number, { x: number; y: number }>()
  let pair: {
    a: number; b: number; engaged: boolean; mode: 'orbit' | 'zoom'; moved: Set<number>
    cx0: number; cy0: number; d0: number; cx: number; cy: number; d: number
  } | null = null
  let leftover = false
  const prevTouchAction = el.style.getPropertyValue('touch-action')
  el.style.setProperty('touch-action', 'none') // the router owns every touch gesture

  const emit = (a: Action, e: ActionEvent): boolean => {
    const h = handlers[a]
    return h ? h(e) !== false : false
  }

  /** Modifiers bound as hold-modifiers: ignored when matching mouse and wheel. */
  const maskedMods = (b: Bindings): Mods => {
    const m: Mods = { mod: false, shift: false, alt: false }
    for (const list of Object.values(b)) for (const x of list) if (x.type === 'modifier') m[x.key] = true
    return m
  }
  const pointerMods = (b: Bindings, e: MouseEvent): Mods => {
    const mask = maskedMods(b)
    const m = eventMods(e)
    return { mod: m.mod && !mask.mod, shift: m.shift && !mask.shift, alt: m.alt && !mask.alt }
  }

  const endDrag = (cancelIt: boolean, e?: ActionEvent) => {
    if (!drag) return
    const d = drag
    drag = null
    try {
      el.releasePointerCapture?.(d.id)
    } catch {
      /* already released */
    }
    if (d.action === 'fold' && cancelIt) emit('cancel', { phase: 'tap', pointerId: d.id })
    else emit(d.action, { phase: 'end', pointerId: d.id, ...e })
  }

  const centre = (a: number, b: number) => {
    const p = touches.get(a)!
    const q = touches.get(b)!
    return { cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2, d: Math.hypot(p.x - q.x, p.y - q.y) }
  }

  const endPair = () => {
    if (!pair) return
    const was = pair
    pair = null
    if (was.engaged && was.mode === 'orbit') emit('orbit', { phase: 'end' })
  }

  const touchDown = (e: PointerEvent) => {
    if (drag && !drag.touch) return // a mouse drag owns the gesture: touch never disturbs it
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.size === 1) leftover = false
    else if (!pair && touches.size >= 2) {
      // The second finger: a fold in progress is cancelled as if Esc was pressed.
      if (drag) endDrag(true)
      const [a, b] = [...touches.keys()]
      const c = centre(a!, b!)
      pair = { a: a!, b: b!, engaged: false, mode: 'orbit', moved: new Set(), cx0: c.cx, cy0: c.cy, d0: c.d, ...c }
      leftover = true
      e.preventDefault()
      return
    }
    if (pair || leftover || drag) return // extra fingers, or the remainder of a gesture
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && !el.contains(active)) active.blur()
    if (!handlers.fold) return
    e.preventDefault()
    if (!emit('fold', { phase: 'start', clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId })) return
    drag = { action: 'fold', id: e.pointerId, x: e.clientX, y: e.clientY, touch: true }
    try {
      el.setPointerCapture?.(e.pointerId)
    } catch {
      /* best-effort */
    }
  }

  const touchMove = (e: PointerEvent) => {
    const t = touches.get(e.pointerId)
    if (!t) return
    t.x = e.clientX
    t.y = e.clientY
    if (pair && (e.pointerId === pair.a || e.pointerId === pair.b)) {
      // Fingers report one at a time: act once both have moved (or one moved twice, the
      // other being still), so a single finger's step is not mistaken for a pinch.
      const again = pair.moved.has(e.pointerId)
      pair.moved.add(e.pointerId)
      if (pair.moved.size < 2 && !again) return
      pair.moved.clear()
      const c = centre(pair.a, pair.b)
      if (!pair.engaged) {
        const travel = Math.hypot(c.cx - pair.cx0, c.cy - pair.cy0)
        const spread = Math.abs(c.d - pair.d0)
        if (travel < TOUCH_SLOP_PX && spread < TOUCH_SLOP_PX) return
        // The dominant movement wins and holds until the fingers lift.
        pair.engaged = true
        pair.mode = travel >= spread ? 'orbit' : 'zoom'
        if (pair.mode === 'orbit') emit('orbit', { phase: 'start', clientX: pair.cx, clientY: pair.cy })
      }
      if (pair.mode === 'orbit') {
        const dx = c.cx - pair.cx
        const dy = c.cy - pair.cy
        if (dx !== 0 || dy !== 0) emit('orbit', { phase: 'move', clientX: c.cx, clientY: c.cy, dx, dy })
      } else if (c.d > 0 && pair.d > 0 && c.d !== pair.d) {
        emit('zoom', { phase: 'tap', delta: -Math.log(c.d / pair.d) * 1000, clientX: c.cx, clientY: c.cy })
      }
      Object.assign(pair, c)
      return
    }
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      drag.x = e.clientX
      drag.y = e.clientY
      emit('fold', { phase: 'move', clientX: e.clientX, clientY: e.clientY, dx, dy, pointerId: e.pointerId })
    }
  }

  const touchUp = (e: PointerEvent, cancelled: boolean) => {
    if (!touches.delete(e.pointerId)) return
    if (pair && (e.pointerId === pair.a || e.pointerId === pair.b)) endPair()
    else if (drag && e.pointerId === drag.id) {
      endDrag(cancelled, { phase: 'end', clientX: e.clientX, clientY: e.clientY })
    }
    if (touches.size === 0) leftover = false
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return touchDown(e)
    // A press on the canvas takes focus back from any island control (a slider, a
    // field), so the shortcuts are never left dead behind a stale focus.
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && !el.contains(active)) active.blur()
    const b = getBindings()
    if (drag) {
      if (drag.touch) return // a touch fold is not the mouse's to end
      if (drag.id === e.pointerId) return // another button of the same pointer
      endDrag(true) // the previous pointer was lost: drop its stale drag
    }
    const mods = pointerMods(b, e)
    const action = DRAGS.find(a =>
      handlers[a] && b[a].some(x => x.type === 'mouse' && x.button === e.button && sameMods(x.mods, mods)))
    if (!action) return
    e.preventDefault()
    if (!emit(action, { phase: 'start', clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId })) return
    drag = { action, id: e.pointerId, x: e.clientX, y: e.clientY }
    try {
      el.setPointerCapture?.(e.pointerId)
    } catch {
      /* capture is best-effort; window listeners below cover its absence */
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return touchMove(e)
    if (!drag || e.pointerId !== drag.id) return
    if (e.buttons === 0 && e.pointerType !== 'touch') {
      endDrag(true, { phase: 'end', clientX: e.clientX, clientY: e.clientY }) // the release was missed
      return
    }
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    drag.x = e.clientX
    drag.y = e.clientY
    emit(drag.action, { phase: 'move', clientX: e.clientX, clientY: e.clientY, dx, dy, pointerId: e.pointerId })
  }

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return touchUp(e, false)
    if (!drag || e.pointerId !== drag.id) return
    endDrag(false, { phase: 'end', clientX: e.clientX, clientY: e.clientY })
  }
  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return touchUp(e, true)
    if (!drag || e.pointerId !== drag.id) return
    endDrag(true, { phase: 'end', clientX: e.clientX, clientY: e.clientY })
  }

  const releaseHeld = () => {
    for (const a of held) emit(a, { phase: 'end' })
    held.clear()
  }
  const onBlur = () => {
    endDrag(true)
    endPair()
    touches.clear()
    leftover = false
    releaseHeld()
  }

  const onWheel = (e: WheelEvent) => {
    const b = getBindings()
    const mods = pointerMods(b, e)
    const bound = (a: Action) => handlers[a] !== undefined && b[a].some(x => x.type === 'wheel' && sameMods(x.mods, mods))
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1
    const dy = e.deltaY * scale
    if (bound('zoom')) {
      e.preventDefault()
      emit('zoom', { phase: 'tap', delta: dy, clientX: e.clientX, clientY: e.clientY })
      return
    }
    // A trackpad pinch arrives as ctrl+wheel: zoom, never the browser's page zoom,
    // unless the user bound Ctrl+wheel to something.
    const pinchLike = e.deltaMode === 0 && Math.abs(dy) < PINCH_MAX_PX // a mouse notch is ~100
    if (e.ctrlKey && handlers.zoom && !(Object.keys(b) as Action[]).some(a => handlers[a] && b[a].some(x => x.type === 'wheel' && x.mods.mod))) {
      e.preventDefault()
      emit('zoom', { phase: 'tap', delta: pinchLike ? dy * PINCH_WHEEL_GAIN : dy, clientX: e.clientX, clientY: e.clientY })
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target) || inModal(e.target)) return
    const b = getBindings()
    const mk = MODIFIER_CODES[e.code]
    if (mk) {
      for (const a of Object.keys(b) as Action[]) {
        if (handlers[a] && !held.has(a) && b[a].some(x => x.type === 'modifier' && x.key === mk)) {
          held.add(a)
          emit(a, { phase: 'start' })
        }
      }
      return
    }
    // Layout-aware: character keys match what the key types, named keys their code (settings/keys.ts).
    const action = (Object.keys(b) as Action[]).find(a =>
      handlers[a] && b[a].some(x => x.type === 'key' && matchesKey(x, e)))
    if (!action) return
    e.preventDefault()
    if (e.repeat) return
    // Esc (or any cancel binding) also drops the router's own fold drag.
    if (action === 'cancel' && drag?.action === 'fold') {
      const d = drag
      drag = null
      try {
        el.releasePointerCapture?.(d.id)
      } catch {
        /* already released */
      }
    }
    emit(action, { phase: 'tap' })
  }

  const onKeyUp = (e: KeyboardEvent) => {
    const mk = MODIFIER_CODES[e.code]
    if (!mk) return
    const b = getBindings()
    for (const a of [...held]) {
      if (b[a].some(x => x.type === 'modifier' && x.key === mk) || !b[a].some(x => x.type === 'modifier')) {
        held.delete(a)
        emit(a, { phase: 'end' })
      }
    }
  }

  const onContextMenu = (e: MouseEvent) => {
    const b = getBindings()
    if (DRAGS.some(a => handlers[a] && b[a].some(x => x.type === 'mouse' && x.button === 2))) e.preventDefault()
  }

  // Touch capture is released by the router itself when a second finger lands (finger 1 is
  // still down), so a touch pointer losing capture says nothing: pointerup/cancel decide.
  const onLost = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') onPointerCancel(e)
  }

  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('lostpointercapture', onLost)
  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('blur', onBlur)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  return () => {
    if (prevTouchAction) el.style.setProperty('touch-action', prevTouchAction)
    else el.style.removeProperty('touch-action')
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('lostpointercapture', onLost)
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }
}
