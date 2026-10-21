// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import { DEFAULT_BINDINGS, cloneBindings, findConflicts } from './bindings'
import { SETTINGS_KEY, type Binding } from './schema'
import { defaultSettings, migrate, useSettings } from './store'

const mouse = (button: 0 | 1 | 2): Binding => ({ type: 'mouse', button, mods: { mod: false, shift: false, alt: false } })

afterEach(() => useSettings.getState().resetAllBindings())

describe('default bindings', () => {
  test('have no conflicts', () => expect(findConflicts(DEFAULT_BINDINGS)).toEqual([]))
  test('match the spec 04 table', () => {
    const d = DEFAULT_BINDINGS
    expect(d.fold).toEqual([mouse(0)])
    expect(d.orbit).toEqual([mouse(2)])
    expect(d.pan).toEqual([mouse(1)])
    expect(d.layersLess[0]).toMatchObject({ type: 'key', code: 'BracketLeft' })
    expect(d.layersMore[0]).toMatchObject({ type: 'key', code: 'BracketRight' })
    expect(d.angleSnap).toEqual([{ type: 'modifier', key: 'shift' }])
    expect(d.redo[0]).toMatchObject({ code: 'KeyZ', mods: { mod: true, shift: true } })
    expect(d.shortcuts[0]).toMatchObject({ code: 'Slash', mods: { shift: true } })
    expect(d.cancel[0]).toMatchObject({ code: 'Escape' })
  })
})

describe('findConflicts', () => {
  test('fold on right mouse clashes with orbit', () => {
    const b = cloneBindings(DEFAULT_BINDINGS)
    b.fold = [mouse(2)]
    expect(findConflicts(b)).toEqual([['fold', 'orbit']])
  })
  test('angleSnap (Shift held) does not conflict with [', () => {
    const b = cloneBindings(DEFAULT_BINDINGS)
    b.layersLess = [{ type: 'key', code: 'ShiftLeft', mods: { mod: false, shift: false, alt: false } }]
    expect(findConflicts(b)).toEqual([])
  })
  test('modifier bindings conflict only with each other', () => {
    const b = cloneBindings(DEFAULT_BINDINGS)
    b.pan = [{ type: 'modifier', key: 'shift' }]
    expect(findConflicts(b)).toEqual([['pan', 'angleSnap']])
  })
  test('zoom and layers sharing the wheel is context-separated, not a conflict', () => {
    expect(findConflicts(DEFAULT_BINDINGS)).toEqual([])
  })
  test('wheel shared with a non-context action (pan) is a conflict', () => {
    const b = cloneBindings(DEFAULT_BINDINGS)
    b.pan = [{ type: 'wheel', mods: { mod: false, shift: false, alt: false } }]
    expect(findConflicts(b).length).toBe(3)
  })
  test('different modifier sets do not conflict (undo vs redo)', () => {
    expect(findConflicts(DEFAULT_BINDINGS).length).toBe(0)
  })
})

describe('migrate', () => {
  test('undefined and garbage give defaults', () => {
    expect(migrate(undefined)).toEqual(defaultSettings())
    expect(migrate('x')).toEqual(defaultSettings())
  })
  test('v0 object becomes v1', () => {
    const s = migrate({ reducedMotion: true, snapRadius: 20, toolReturns: false, keys: { valley: 'KeyB' } })
    expect(s.version).toBe(1)
    expect(s.reducedMotion).toBe('always')
    expect(s.snapRadiusPx).toBe(20)
    expect(s.toolReturnsToFold).toBe(false)
    expect(s.bindings.valley).toEqual([{ type: 'key', code: 'KeyB', mods: { mod: false, shift: false, alt: false } }])
    expect(s.bindings.mountain).toEqual(DEFAULT_BINDINGS.mountain)
  })
  test('v1 with conflicting bindings falls back to defaults', () => {
    const bad = defaultSettings()
    bad.bindings.fold = [mouse(2)]
    expect(migrate(bad).bindings).toEqual(DEFAULT_BINDINGS)
  })
  test('v1 round trips', () => {
    const s = defaultSettings()
    s.reducedMotion = 'never'
    expect(migrate(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })
})

describe('useSettings', () => {
  test('defaults', () => {
    const s = useSettings.getState()
    expect(s.snapRadiusPx).toBe(12)
    expect(s.reducedMotion).toBe('system')
    expect(s.snap.axioms).toBe(false)
    expect(s.toolReturnsToFold && s.confirmPresetReplace).toBe(true)
  })
  test('saving a conflicting binding is refused and returns the conflicts', () => {
    const r = useSettings.getState().setBinding('fold', [mouse(2)])
    expect(r).toEqual({ ok: false, conflicts: [['fold', 'orbit']] })
    expect(useSettings.getState().bindings.fold).toEqual([mouse(0)])
  })
  test('a valid remap applies immediately; reset restores it', () => {
    const k: Binding = { type: 'key', code: 'KeyB', mods: { mod: false, shift: false, alt: false } }
    expect(useSettings.getState().setBinding('valley', [k]).ok).toBe(true)
    expect(useSettings.getState().bindings.valley).toEqual([k])
    useSettings.getState().resetBinding('valley')
    expect(useSettings.getState().bindings.valley).toEqual(DEFAULT_BINDINGS.valley)
  })
  test('works when localStorage throws', () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('quota') } },
    })
    try {
      useSettings.getState().update({ snapRadiusPx: 20 })
      expect(useSettings.getState().snapRadiusPx).toBe(20)
    } finally {
      if (orig) Object.defineProperty(globalThis, 'localStorage', orig)
      else delete (globalThis as Record<string, unknown>).localStorage
      useSettings.getState().update({ snapRadiusPx: 12 })
    }
  })
  test('persists under ori.settings', () => {
    const mem = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) },
    })
    try {
      useSettings.getState().update({ reducedMotion: 'always' })
      expect(JSON.parse(mem.get(SETTINGS_KEY)!).reducedMotion).toBe('always')
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage
      useSettings.getState().update({ reducedMotion: 'system' })
    }
  })
})
