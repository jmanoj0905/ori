// Transient UI state shared between the input wiring and the islands: which
// sheet is open, and the keyboard-fold phase (for the hint line).
import { create } from 'zustand'

export type Sheet = 'settings' | 'shortcuts'
export type KeyboardPhase = 'idle' | 'grab' | 'target'

export type UiState = {
  sheet: Sheet | null
  kf: KeyboardPhase
  open(s: Sheet): void
  close(): void
  toggle(s: Sheet): void
  setKf(p: KeyboardPhase): void
}

export const useUi = create<UiState>()((set, get) => ({
  sheet: null,
  kf: 'idle',
  open: sheet => set({ sheet }),
  close: () => set({ sheet: null }),
  toggle: sheet => set({ sheet: get().sheet === sheet ? null : sheet }),
  setKf: kf => set({ kf }),
}))
