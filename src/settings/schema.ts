import type { PaperSettings } from '../studio/store'

export type Action =
  | 'fold' | 'orbit' | 'pan' | 'zoom'
  | 'layersLess' | 'layersMore' | 'angleSnap'
  | 'valley' | 'mountain' | 'reverse' | 'squash' | 'petal' | 'turnOver'
  | 'undo' | 'redo' | 'cancel' | 'topView' | 'resetView' | 'shortcuts' | 'settings'
  | 'keyboardFold'

export const ACTIONS: readonly Action[] = [
  'fold', 'orbit', 'pan', 'zoom', 'layersLess', 'layersMore', 'angleSnap',
  'valley', 'mountain', 'reverse', 'squash', 'petal', 'turnOver',
  'undo', 'redo', 'cancel', 'topView', 'resetView', 'shortcuts', 'settings', 'keyboardFold',
]

/**
 * Modifier set. `mod` is the platform-neutral "Ctrl or Cmd": the router matches
 * it against `ctrlKey || metaKey`, so one binding serves every platform.
 */
export type Mods = { mod: boolean; shift: boolean; alt: boolean }

export type ModKey = 'shift' | 'alt' | 'mod'

/**
 * `modifier` is a hold-only binding (angle snap = hold Shift). It is a separate
 * class: it is compared only against other `modifier` bindings, never keys.
 */
export type Binding =
  | { type: 'key'; code: string; mods: Mods }
  | { type: 'mouse'; button: 0 | 1 | 2; mods: Mods }
  | { type: 'wheel'; mods: Mods }
  | { type: 'modifier'; key: ModKey }

export type Bindings = Record<Action, Binding[]>

export type ReducedMotion = 'system' | 'always' | 'never'

export type SnapSettings = {
  corners: boolean
  midpoints: boolean
  intersections: boolean
  edges: boolean
  angle: boolean
  axioms: boolean
}

export type Settings = {
  version: 1
  bindings: Bindings
  reducedMotion: ReducedMotion
  snap: SnapSettings
  snapRadiusPx: number
  toolReturnsToFold: boolean
  confirmPresetReplace: boolean
  paperDefaults: PaperSettings
}

export const SETTINGS_VERSION = 1 as const
export const SETTINGS_KEY = 'ori.settings'
