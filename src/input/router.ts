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
//  - Key actions emit a single `tap`. Modifier bindings (angleSnap) emit
//    `start` on press and `end` on release of the key, once per hold.
//  - Wheel: while a fold drag is active the wheel means layers (deltaY < 0,
//    wheel up = layersMore; deltaY > 0, wheel down = layersLess), otherwise
//    zoom. `delta` carries deltaY in pixels (positive = out). Layer steps are
//    accumulated (LAYER_STEP_PX) so a trackpad does not skip dozens of layers.
//  - `cancel` (tap) is also emitted, instead of `end`, when a fold drag is
//    lost: pointercancel, lostpointercapture, window blur, a move with no
//    button down, or a second pointer pressing. Orbit and pan just end.
//  - `mod` (Ctrl-or-Cmd) matches ctrlKey || metaKey on every platform.
//    Mouse and wheel matching ignores modifiers that are themselves bound as
//    hold-modifiers (Shift for angleSnap), so holding Shift never blocks a fold.
//  - Key events are ignored while focus is in an input, textarea, select or
//    contenteditable element.
import type { Action, Bindings, Mods } from '../settings/schema'

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

/** Wheel pixels (normalised) that make one layer step while folding. */
export const LAYER_STEP_PX = 100 // one mouse-wheel notch

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

function isTypingTarget(t: EventTarget | null): boolean {
  const els: (Element | null)[] = [t instanceof Element ? t : null, document.activeElement]
  return els.some(n => {
    if (!n) return false
    const tag = n.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (n as HTMLElement).isContentEditable === true
  })
}

export function createRouter(el: HTMLElement, getBindings: () => Bindings, handlers: Handlers): () => void {
  let drag: { action: DragAction; id: number; x: number; y: number } | null = null
  const held = new Set<Action>()
  let wheelAcc = 0

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

  const onPointerDown = (e: PointerEvent) => {
    const b = getBindings()
    if (drag) {
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
    wheelAcc = 0
    try {
      el.setPointerCapture?.(e.pointerId)
    } catch {
      /* capture is best-effort; window listeners below cover its absence */
    }
  }

  const onPointerMove = (e: PointerEvent) => {
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
    if (!drag || e.pointerId !== drag.id) return
    endDrag(false, { phase: 'end', clientX: e.clientX, clientY: e.clientY })
  }
  const onPointerCancel = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    endDrag(true, { phase: 'end', clientX: e.clientX, clientY: e.clientY })
  }

  const releaseHeld = () => {
    for (const a of held) emit(a, { phase: 'end' })
    held.clear()
  }
  const onBlur = () => {
    endDrag(true)
    releaseHeld()
  }

  const onWheel = (e: WheelEvent) => {
    const b = getBindings()
    const mods = pointerMods(b, e)
    const bound = (a: Action) => handlers[a] !== undefined && b[a].some(x => x.type === 'wheel' && sameMods(x.mods, mods))
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1
    const dy = e.deltaY * scale
    if (drag?.action === 'fold' && (bound('layersMore') || bound('layersLess'))) {
      e.preventDefault()
      if (wheelAcc !== 0 && Math.sign(wheelAcc) !== Math.sign(dy)) wheelAcc = 0
      wheelAcc += dy
      while (Math.abs(wheelAcc) >= LAYER_STEP_PX) {
        const more = wheelAcc < 0 // wheel up
        wheelAcc += more ? LAYER_STEP_PX : -LAYER_STEP_PX
        const a: Action = more ? 'layersMore' : 'layersLess'
        if (bound(a)) emit(a, { phase: 'tap', delta: dy })
      }
      return
    }
    if (bound('zoom')) {
      e.preventDefault()
      emit('zoom', { phase: 'tap', delta: dy, clientX: e.clientX, clientY: e.clientY })
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return
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
    const mods = eventMods(e)
    const action = (Object.keys(b) as Action[]).find(a =>
      handlers[a] && b[a].some(x => x.type === 'key' && x.code === e.code && sameMods(x.mods, mods)))
    if (!action) return
    e.preventDefault()
    if (e.repeat && action !== 'layersLess' && action !== 'layersMore') return
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

  const onLost = (e: PointerEvent) => onPointerCancel(e)

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
