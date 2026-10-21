// Wires the input router to the Stage and the studio store: the one place that
// maps named actions to behaviour. Raw events never reach anything else.
import { useEffect } from 'react'
import { useStudio } from '../studio/store'
import { createFoldGesture, type GestureOptions, type GestureStage } from '../studio/useFoldGesture'
import { useSettings } from '../settings/store'
import { createRouter, type Handlers } from './router'

/** What the input wiring needs from the Stage. */
export interface InputStage extends GestureStage {
  orbit(dx: number, dy: number): void
  pan(dx: number, dy: number): void
  zoom(delta: number): void
  view(name: 'top' | 'reset', animate: boolean): void
}

const animateViews = (): boolean => {
  const m = useSettings.getState().reducedMotion
  if (m === 'always') return false
  if (m === 'never') return true
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
}

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
    const handlers: Handlers = {
      fold: e => {
        if (e.phase === 'start') {
          if (!g.down({ pointerId: e.pointerId ?? 0, clientX: e.clientX ?? 0, clientY: e.clientY ?? 0 })) return false
          if (snapHeld) st.getState().setSnapAngle(true)
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
        st.getState().setSnapAngle(snapHeld)
      },
      valley: () => st.getState().setKind('valley'),
      mountain: () => st.getState().setKind('mountain'),
      reverse: () => st.getState().setTool('reverse'),
      squash: () => st.getState().setTool('squash'),
      petal: () => st.getState().setTool('petal'),
      turnOver: () => void st.getState().turnOver(),
      undo: () => st.getState().undo(),
      redo: () => st.getState().redo(),
      cancel: () => g.cancel(),
      topView: () => stage.view('top', animateViews()),
      resetView: () => stage.view('reset', animateViews()),
    }
    const el = stage.canvas
    const dispose = createRouter(el, () => useSettings.getState().bindings, handlers)
    const hover = (e: PointerEvent) => g.hover(e)
    el.addEventListener('pointermove', hover)
    return () => {
      dispose()
      el.removeEventListener('pointermove', hover)
      el.style.cursor = ''
    }
  }, [stage, opts])
}
