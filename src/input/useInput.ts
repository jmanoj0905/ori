// Wires the input router to the Stage and the studio store: the one place that
// maps named actions to behaviour. Raw events never reach anything else.
import { useEffect } from 'react'
import { useStudio } from '../studio/store'
import { createFoldGesture, type GestureOptions, type GestureStage } from '../studio/useFoldGesture'
import { useSettings } from '../settings/store'
import { prefersReducedMotion } from '../studio/motion'
import { createKeyboardFold } from '../studio/keyboardFold'
import { useUi } from '../studio/ui'
import { createRouter, inModal, isTypingTarget, type Handlers } from './router'

/** What the input wiring needs from the Stage. */
export interface InputStage extends GestureStage {
  orbit(dx: number, dy: number): void
  pan(dx: number, dy: number): void
  zoom(delta: number): void
  view(name: 'top' | 'reset', animate: boolean): void
  setHoverMarker?(p: readonly [number, number] | null): void
}

const animateViews = (): boolean => !prefersReducedMotion(useSettings.getState().reducedMotion)

export function useInput(stage: InputStage | null, opts?: GestureOptions): void {
  useEffect(() => {
    if (!stage) return
    const st = useStudio
    const g = createFoldGesture(stage, st, opts)
    let snapHeld = false
    const layers = (d: number) => {
      const gs = st.getState().gesture
      if (gs) st.getState().setLayers(gs.layers + d)
    }
    const kf = createKeyboardFold({ stage, store: st })
    const handlers: Handlers = {
      fold: e => {
        if (e.phase === 'start') {
          kf.cancel() // a pointer fold replaces the keyboard one (and a miss must not leave it orphaned)
          if (!g.down({ pointerId: e.pointerId ?? 0, clientX: e.clientX ?? 0, clientY: e.clientY ?? 0 })) return false
          if (snapHeld && useSettings.getState().snap.angle) st.getState().setSnapAngle(true)
        } else if (e.phase === 'move') g.move({ pointerId: e.pointerId ?? 0, clientX: e.clientX ?? 0, clientY: e.clientY ?? 0 })
        else if (e.phase === 'end') void g.up({ pointerId: e.pointerId ?? 0, clientX: e.clientX ?? 0, clientY: e.clientY ?? 0 })
      },
      orbit: e => { if (e.phase === 'move') stage.orbit(e.dx ?? 0, e.dy ?? 0) },
      pan: e => { if (e.phase === 'move') stage.pan(e.dx ?? 0, e.dy ?? 0) },
      zoom: e => stage.zoom(e.delta ?? 0),
      layersLess: () => layers(-1),
      layersMore: () => layers(1),
      angleSnap: e => {
        snapHeld = e.phase === 'start'
        st.getState().setSnapAngle(snapHeld && useSettings.getState().snap.angle)
      },
      valley: () => st.getState().setKind('valley'),
      mountain: () => st.getState().setKind('mountain'),
      reverse: () => st.getState().setTool('reverse'),
      squash: () => st.getState().setTool('squash'),
      petal: () => st.getState().setTool('petal'),
      turnOver: () => void st.getState().turnOver(),
      undo: () => st.getState().undo(),
      redo: () => st.getState().redo(),
      cancel: () => {
        kf.cancel()
        g.cancel()
      },
      keyboardFold: () => kf.start(),
      shortcuts: () => useUi.getState().toggle('shortcuts'),
      settings: () => useUi.getState().open('settings'),
      topView: () => stage.view('top', animateViews()),
      resetView: () => stage.view('reset', animateViews()),
    }
    const el = stage.canvas
    const dispose = createRouter(el, () => useSettings.getState().bindings, handlers)
    // While the keyboard cursor is up it owns the marker: pointer hover must not fight it.
    const hover = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && kf.phase() === 'idle') g.hover(e) // no hover on glass
    }
    const leave = () => {
      if (kf.phase() === 'idle') g.leave()
    }
    // The cursor's own keys (Tab, arrows, Enter, + -, Esc) are modal: they only exist
    // while the mode is on, and are taken before the router so Tab never leaves the canvas.
    const onKey = (e: KeyboardEvent) => {
      if (kf.phase() === 'idle' || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target) || inModal(e.target)) return
      if (kf.key(e)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    // The canvas is a real tab stop, so the keyboard path starts without a pointer.
    const prev = {
      tabindex: el.getAttribute('tabindex'), role: el.getAttribute('role'), label: el.getAttribute('aria-label'),
    }
    el.tabIndex = 0
    el.setAttribute('role', 'application')
    el.setAttribute('aria-label', 'Origami sheet. Press F to fold with the keyboard, ? for all shortcuts.')
    el.addEventListener('pointermove', hover)
    el.addEventListener('pointerleave', leave)
    return () => {
      dispose()
      kf.dispose()
      window.removeEventListener('keydown', onKey, true)
      for (const [name, v] of [['tabindex', prev.tabindex], ['role', prev.role], ['aria-label', prev.label]] as const) {
        if (v === null) el.removeAttribute(name)
        else el.setAttribute(name, v)
      }
      el.removeEventListener('pointermove', hover)
      el.removeEventListener('pointerleave', leave)
      stage.setHoverMarker?.(null)
      el.style.cursor = ''
    }
  }, [stage, opts])
}
