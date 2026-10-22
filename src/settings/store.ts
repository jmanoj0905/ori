import { create } from 'zustand'
import { DEFAULT_PAPER, cleanPaper } from '../paper'
import { DEFAULT_BINDINGS, cloneBindings, findConflicts } from './bindings'
import { migrateKeyBinding } from './keys'
import {
  ACTIONS, SETTINGS_KEY, SETTINGS_VERSION,
  type Action, type Binding, type Bindings, type ReducedMotion, type Settings, type SnapSettings,
} from './schema'

export const DEFAULT_SNAP: SnapSettings = {
  corners: true, midpoints: true, intersections: true, edges: true, angle: true, axioms: false,
}

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    bindings: cloneBindings(DEFAULT_BINDINGS),
    reducedMotion: 'system',
    snap: { ...DEFAULT_SNAP },
    snapRadiusPx: 12,
    toolReturnsToFold: true,
    confirmPresetReplace: true,
    paperDefaults: { ...DEFAULT_PAPER },
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)

const validMods = (m: unknown) =>
  isObj(m) && typeof m.mod === 'boolean' && typeof m.shift === 'boolean' && typeof m.alt === 'boolean'

function validBinding(b: unknown): b is Binding {
  if (!isObj(b)) return false
  switch (b.type) {
    case 'key':
      return validMods(b.mods) && (
        (typeof b.key === 'string' && b.key.length > 0 && b.code === undefined) ||
        (typeof b.code === 'string' && b.key === undefined))
    case 'mouse': return (b.button === 0 || b.button === 1 || b.button === 2) && validMods(b.mods)
    case 'wheel': return validMods(b.mods)
    case 'modifier': return b.key === 'shift' || b.key === 'alt' || b.key === 'mod'
    default: return false
  }
}

export const clampRadius = (r: unknown, fallback: number): number =>
  typeof r === 'number' && Number.isFinite(r) ? Math.min(40, Math.max(2, r)) : fallback

function cleanBindings(raw: unknown): Bindings {
  const out = cloneBindings(DEFAULT_BINDINGS)
  if (!isObj(raw)) return out
  for (const a of ACTIONS) {
    const v = raw[a]
    // Pre-layout-aware saves stored every key by code: migrate (keys.ts).
    if (Array.isArray(v) && v.every(validBinding)) out[a] = (v as Binding[]).map(b => migrateKeyBinding(b))
  }
  return findConflicts(out).length ? cloneBindings(DEFAULT_BINDINGS) : out
}

/** v0 (pre-versioned) shape: no `version`; `reducedMotion` boolean; `snapRadius`;
 *  `toolReturns`; `keys` maps an action to a bare KeyboardEvent.code. */
type SettingsV0 = {
  reducedMotion?: boolean
  snapRadius?: number
  toolReturns?: boolean
  keys?: Partial<Record<Action, string>>
}

function fromV0(v0: SettingsV0): Record<string, unknown> {
  const bindings: Record<string, unknown> = {}
  if (isObj(v0.keys)) {
    for (const [a, code] of Object.entries(v0.keys)) {
      if ((ACTIONS as readonly string[]).includes(a) && typeof code === 'string' && code) {
        bindings[a] = [{ type: 'key', code, mods: { mod: false, shift: false, alt: false } }]
      }
    }
  }
  return {
    version: 1,
    bindings,
    reducedMotion: v0.reducedMotion === true ? 'always' : 'system',
    snapRadiusPx: v0.snapRadius,
    toolReturnsToFold: v0.toolReturns,
  }
}

/** Any stored value -> current Settings. Unknown / corrupt fields fall back to defaults. */
export function migrate(raw: unknown): Settings {
  const d = defaultSettings()
  if (!isObj(raw)) return d
  const src = raw.version === undefined ? fromV0(raw as SettingsV0) : raw
  if (src.version !== 1) return d
  const rm = src.reducedMotion
  const snap = isObj(src.snap) ? src.snap : {}
  const r = src.snapRadiusPx
  return {
    version: 1,
    bindings: cleanBindings(src.bindings),
    reducedMotion: rm === 'always' || rm === 'never' || rm === 'system' ? rm : d.reducedMotion,
    snap: {
      corners: bool(snap.corners, d.snap.corners),
      midpoints: bool(snap.midpoints, d.snap.midpoints),
      intersections: bool(snap.intersections, d.snap.intersections),
      edges: bool(snap.edges, d.snap.edges),
      angle: bool(snap.angle, d.snap.angle),
      axioms: bool(snap.axioms, d.snap.axioms),
    },
    snapRadiusPx: clampRadius(r, d.snapRadiusPx),
    toolReturnsToFold: bool(src.toolReturnsToFold, d.toolReturnsToFold),
    confirmPresetReplace: bool(src.confirmPresetReplace, d.confirmPresetReplace),
    paperDefaults: cleanPaper(src.paperDefaults),
  }
}

function load(): Settings {
  try {
    const s = globalThis.localStorage?.getItem(SETTINGS_KEY)
    return migrate(s ? JSON.parse(s) : undefined)
  } catch {
    return defaultSettings()
  }
}

function save(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* private mode / quota: settings still work in memory */
  }
}

export type Prefs = Omit<Settings, 'bindings' | 'version'>
export type SaveResult = { ok: true } | { ok: false; conflicts: [Action, Action][] }

export type SettingsState = Settings & {
  /** Replace one action's bindings (the list is copied). Refused (state unchanged) if it creates a conflict. */
  setBinding: (action: Action, list: Binding[]) => SaveResult
  /** Replace the whole map (settings-sheet Save). Refused on any conflict. */
  setBindings: (b: Bindings) => SaveResult
  /** Restore one action's default. Refused (state unchanged) if the default now clashes with another action. */
  resetBinding: (action: Action) => SaveResult
  resetAllBindings: () => void
  update: (patch: Partial<Prefs>) => void
}

const persisted = (s: SettingsState): Settings => ({
  version: s.version, bindings: s.bindings, reducedMotion: s.reducedMotion, snap: s.snap,
  snapRadiusPx: s.snapRadiusPx, toolReturnsToFold: s.toolReturnsToFold,
  confirmPresetReplace: s.confirmPresetReplace, paperDefaults: s.paperDefaults,
})

export const useSettings = create<SettingsState>()((set, get) => {
  const commit = (patch: Partial<Settings>) => {
    set(patch)
    save(persisted(get()))
  }
  const trySet = (b: Bindings): SaveResult => {
    const conflicts = findConflicts(b)
    if (conflicts.length) return { ok: false, conflicts }
    commit({ bindings: b })
    return { ok: true }
  }
  return {
    ...load(),
    setBinding: (action, list) => trySet({ ...get().bindings, [action]: structuredClone(list) }),
    setBindings: b => trySet(cloneBindings(b)),
    resetBinding: action => trySet({ ...get().bindings, [action]: cloneBindings(DEFAULT_BINDINGS)[action] }),
    resetAllBindings: () => commit({ bindings: cloneBindings(DEFAULT_BINDINGS) }),
    update: patch => {
      const next: Partial<Settings> = { ...patch }
      if (patch.snapRadiusPx !== undefined) next.snapRadiusPx = clampRadius(patch.snapRadiusPx, get().snapRadiusPx)
      if (patch.paperDefaults !== undefined) next.paperDefaults = cleanPaper(patch.paperDefaults)
      commit(next)
    },
  }
})

export type { ReducedMotion }
export { cleanPaper }
