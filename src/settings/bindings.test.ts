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
    expect(d.layerPicker).toEqual([{ type: 'key', key: 'l', mods: { mod: false, shift: false, alt: false } }])
    expect(d.forceNewFold).toEqual([{ type: 'modifier', key: 'alt' }])
    expect(d.angleSnap).toEqual([{ type: 'modifier', key: 'shift' }])
    expect(d.redo[0]).toMatchObject({ key: 'z', mods: { mod: true, shift: true } })
    expect(d.shortcuts[0]).toMatchObject({ key: '?' }) // layout-aware: the character, Shift implied
    expect(d.cancel[0]).toMatchObject({ code: 'Escape' })
  })
})

describe('findConflicts', () => {
  test('fold on right mouse clashes with orbit', () => {
    const b = cloneBindings(DEFAULT_BINDINGS)
    b.fold = [mouse(2)]
    expect(findConflicts(b)).toEqual([['fold', 'orbit']])
  })
  test('angleSnap (Shift held) does not conflict with a key binding', () => {
    const b = cloneBindings(DEFAULT_BINDINGS)
    b.layerPicker = [{ type: 'key', code: 'ShiftLeft', mods: { mod: false, shift: false, alt: false } }]
    expect(findConflicts(b)).toEqual([])
  })
  test('modifier bindings conflict only with each other', () => {
    const b = cloneBindings(DEFAULT_BINDINGS)
    b.pan = [{ type: 'modifier', key: 'shift' }]
    expect(findConflicts(b)).toEqual([['pan', 'angleSnap']])
  })
  test('a held modifier clashes with a mouse or wheel binding that needs it (the router masks it there)', () => {
    const b = cloneBindings(DEFAULT_BINDINGS)
    b.orbit = [{ type: 'mouse', button: 0, mods: { mod: false, shift: false, alt: true } }]
    expect(findConflicts(b)).toEqual([['orbit', 'forceNewFold']])
    b.orbit = [mouse(2)]
    b.zoom = [{ type: 'wheel', mods: { mod: false, shift: true, alt: false } }]
    expect(findConflicts(b)).toEqual([['zoom', 'angleSnap']])
  })
  test('wheel shared with a non-context action (pan) is a conflict', () => {
    const b = cloneBindings(DEFAULT_BINDINGS)
    b.pan = [{ type: 'wheel', mods: { mod: false, shift: false, alt: false } }]
    expect(findConflicts(b)).toEqual([['pan', 'zoom']])
  })
  test('different modifier sets do not conflict (undo vs redo)', () => {
    expect(findConflicts(DEFAULT_BINDINGS).length).toBe(0)
  })
})

describe('migrate', () => {
  test('migrates a v1 save', () => {
    const none = { mod: false, shift: false, alt: false }
    const v1 = {
      version: 1,
      bindings: {
        layersLess: [{ type: 'key', key: '9', mods: none }],
        undo: [{ type: 'key', key: 'u', mods: { ...none, mod: true } }],
      },
      snap: { corners: true, midpoints: true, intersections: true, edges: true, angle: true, axioms: false },
    }
    const s = migrate(v1)
    expect(s.version).toBe(2)
    expect('layersLess' in s.bindings).toBe(false)
    expect(s.bindings.undo).toEqual([{ type: 'key', key: 'u', mods: { ...none, mod: true } }])
    expect(s.bindings.layerPicker).toEqual(DEFAULT_BINDINGS.layerPicker)
    expect(s.bindings.forceNewFold).toEqual(DEFAULT_BINDINGS.forceNewFold)
    expect(s.snap.creases).toBe(true)
  })

  test('v1 save whose binding clashes with a new default keeps the custom bindings', () => {
    const none = { mod: false, shift: false, alt: false }
    const s1 = migrate({ version: 1, bindings: { valley: [{ type: 'key', key: 'l', mods: none }], undo: [{ type: 'key', key: 'u', mods: { ...none, mod: true } }] } })
    expect(s1.bindings.valley).toEqual([{ type: 'key', key: 'l', mods: none }])
    expect(s1.bindings.undo[0]).toMatchObject({ key: 'u' })
    expect(s1.bindings.layerPicker).toEqual([])
    expect(findConflicts(s1.bindings)).toEqual([])
    const s2 = migrate({ version: 1, bindings: { angleSnap: [{ type: 'modifier', key: 'alt' }], undo: [{ type: 'key', key: 'u', mods: { ...none, mod: true } }] } })
    expect(s2.bindings.angleSnap).toEqual([{ type: 'modifier', key: 'alt' }])
    expect(s2.bindings.undo[0]).toMatchObject({ key: 'u' })
    expect(s2.bindings.forceNewFold).toEqual([])
    expect(findConflicts(s2.bindings)).toEqual([])
  })
  test('v1 save with a custom Alt+drag orbit keeps it and leaves forceNewFold unbound (Final review #4)', () => {
    const altLeft = { type: 'mouse', button: 0, mods: { mod: false, shift: false, alt: true } }
    const s = migrate({ version: 1, bindings: { orbit: [altLeft] } })
    expect(s.bindings.orbit).toEqual([altLeft])
    expect(s.bindings.forceNewFold).toEqual([])
    expect(findConflicts(s.bindings)).toEqual([])
  })

  test('undefined and garbage give defaults', () => {
    expect(migrate(undefined)).toEqual(defaultSettings())
    expect(migrate('x')).toEqual(defaultSettings())
  })
  test('v0 object becomes the current version', () => {
    const s = migrate({ reducedMotion: true, snapRadius: 20, toolReturns: false, keys: { valley: 'KeyB' } })
    expect(s.version).toBe(2)
    expect(s.reducedMotion).toBe('always')
    expect(s.snapRadiusPx).toBe(20)
    expect(s.toolReturnsToFold).toBe(false)
    expect(s.bindings.valley).toEqual([{ type: 'key', key: 'b', mods: { mod: false, shift: false, alt: false } }]) // migrated to the letter
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

describe('Task 10 carried fixes', () => {
  test('keyboardFold is a remappable action, F by default, with no conflict', () => {
    expect(DEFAULT_BINDINGS.keyboardFold).toEqual([{ type: 'key', key: 'f', mods: { mod: false, shift: false, alt: false } }])
  })

  test('migrate validates and clamps paperDefaults field by field', () => {
    const d = defaultSettings().paperDefaults
    const m = migrate({
      version: 1,
      paperDefaults: {
        mode: 'rainbow', front: 'red; background:url(x)', back: '#112233', thickness: 7, translucency: -3,
        pattern: 'zigzag', size: { width: -1, height: 2 }, evil: true,
      },
    }).paperDefaults
    expect(m).toEqual({ ...d, back: '#112233', thickness: 1, translucency: 0 })
    expect(m).not.toHaveProperty('evil')
    expect(m).not.toHaveProperty('pattern')
    const ok = migrate({ version: 1, paperDefaults: { mode: 'washi', pattern: 'asanoha', size: { width: 2, height: 3 }, front: '#AABBCC' } }).paperDefaults
    expect(ok).toMatchObject({ mode: 'washi', pattern: 'asanoha', size: { width: 2, height: 3 }, front: '#AABBCC' })
    expect(migrate({ version: 1, paperDefaults: { size: 'a4', thickness: 'x' } }).paperDefaults).toMatchObject({ size: 'a4', thickness: d.thickness })
    expect(migrate({ version: 1, paperDefaults: 5 }).paperDefaults).toEqual(d)
  })

  test('update() clamps snapRadiusPx to 2..40 and ignores NaN', () => {
    useSettings.getState().update({ snapRadiusPx: 500 })
    expect(useSettings.getState().snapRadiusPx).toBe(40)
    useSettings.getState().update({ snapRadiusPx: -4 })
    expect(useSettings.getState().snapRadiusPx).toBe(2)
    useSettings.getState().update({ snapRadiusPx: Number.NaN })
    expect(useSettings.getState().snapRadiusPx).toBe(2)
    useSettings.getState().update({ snapRadiusPx: 12 })
  })

  test('update() sanitises paperDefaults too', () => {
    useSettings.getState().update({ paperDefaults: { ...defaultSettings().paperDefaults, thickness: 99, front: 'nope' } })
    expect(useSettings.getState().paperDefaults.thickness).toBe(1)
    expect(useSettings.getState().paperDefaults.front).toBe(defaultSettings().paperDefaults.front)
    useSettings.getState().update({ paperDefaults: defaultSettings().paperDefaults })
  })

  test('setBinding clones the list it is given', () => {
    const list: Binding[] = [{ type: 'key', code: 'KeyB', mods: { mod: false, shift: false, alt: false } }]
    expect(useSettings.getState().setBinding('valley', list).ok).toBe(true)
    const first = list[0]
    if (first?.type !== 'key') throw new Error('unreachable')
    first.code = 'KeyQ'
    list.push(mouse(0))
    expect(useSettings.getState().bindings.valley).toEqual([{ type: 'key', code: 'KeyB', mods: { mod: false, shift: false, alt: false } }])
  })

  test('resetBinding refuses when the default now clashes with another action', () => {
    useSettings.getState().setBinding('valley', [{ type: 'key', code: 'KeyB', mods: { mod: false, shift: false, alt: false } }])
    useSettings.getState().setBinding('reverse', [{ type: 'key', code: 'KeyV', mods: { mod: false, shift: false, alt: false } }])
    const r = useSettings.getState().resetBinding('valley') // default V is now held by reverse
    expect(r.ok).toBe(false)
    expect(useSettings.getState().bindings.valley[0]).toMatchObject({ code: 'KeyB' })
  })
})
