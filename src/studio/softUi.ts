// Soft paper's UI state (spec 08; Plan 6 Task 4), shared by the toggle in the
// Tools island and the app shell that runs the soft session (src/soft,
// loaded on demand). No soft-paper code is imported here: this stays in the
// first load.
import { create } from 'zustand'

export const NO_WEBGPU = 'Soft paper needs WebGPU, which this browser does not provide. Folding works as usual.'
export const NOT_IN_LESSON = 'Soft paper is not available during a lesson.'

/** Does this browser expose WebGPU? (An adapter may still be refused; the session then falls back.) */
export const hasWebGPU = (): boolean => typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as Navigator & { gpu?: unknown }).gpu

export type SoftUi = {
  /** The soft session is running (the Stage shows the soft mesh). */
  active: boolean
  /** Starting or leaving (remeshing, building the solver, handing back). */
  busy: boolean
  wet: boolean
  /** The model has curved creases the Curve fold slider can fold (0: none). */
  curves: number
  curveDeg: number
  /** Which solver runs ('cpu' after a device loss). */
  solver: 'gpu' | 'cpu' | null
  message: string | null
  set(p: Partial<Omit<SoftUi, 'set'>>): void
}

export const useSoftUi = create<SoftUi>()(set => ({
  active: false,
  busy: false,
  wet: false,
  curves: 0,
  curveDeg: 0,
  solver: null,
  message: null,
  set: p => set(p),
}))
