// Transient UI state shared between the input wiring and the islands: which
// sheet is open, the keyboard-fold phase (for the hint line), and the layer
// belt while it is open (the gesture opens it, the LayerBelt island draws it).
import { create } from 'zustand'
import type { BeltState } from './belt'

export type Sheet = 'settings' | 'shortcuts'
export type KeyboardPhase = 'idle' | 'grab' | 'target'
/**
 * The 3D view: loading (the Stage chunk), ready, or why it is unavailable —
 * no WebGL, the chunk failed to load, or the GPU context was lost (until the
 * browser restores it). While unavailable the fold and preset controls are off.
 */
export type StageStatus = 'loading' | 'ready' | 'webgl' | 'chunk' | 'lost'

export const STAGE_MESSAGES: Partial<Record<StageStatus, string>> = {
  webgl: 'Ori needs WebGL to show the paper.',
  chunk: "Couldn't load the 3D view — reload to try again.",
  lost: 'The 3D view was interrupted. Restoring it…',
}

/** True when the paper cannot be shown (and so cannot be folded). */
export const stageDown = (s: StageStatus): boolean => s === 'webgl' || s === 'chunk' || s === 'lost'

/** Sandbox folding, or the crease pattern designer (spec 07, code-split). */
export type Mode = 'sandbox' | 'designer'

export type UiState = {
  sheet: Sheet | null
  mode: Mode
  kf: KeyboardPhase
  stage: StageStatus
  belt: BeltState | null
  open(s: Sheet): void
  close(): void
  toggle(s: Sheet): void
  setKf(p: KeyboardPhase): void
  setStage(s: StageStatus): void
  setMode(m: Mode): void
  openBelt(b: BeltState): void
  /** The row under the pointer (no-op while the belt is closed). */
  hoverBelt(i: number | null): void
  closeBelt(): void
}

export const useUi = create<UiState>()((set, get) => ({
  sheet: null,
  mode: 'sandbox',
  kf: 'idle',
  stage: 'loading',
  belt: null,
  open: sheet => set({ sheet }),
  close: () => set({ sheet: null }),
  toggle: sheet => set({ sheet: get().sheet === sheet ? null : sheet }),
  setKf: kf => set({ kf }),
  setStage: stage => set({ stage }),
  setMode: mode => set({ mode }),
  openBelt: belt => set({ belt }),
  hoverBelt: hovered => {
    const { belt } = get()
    if (belt && belt.hovered !== hovered) set({ belt: { ...belt, hovered } })
  },
  closeBelt: () => {
    if (get().belt) set({ belt: null })
  },
}))
