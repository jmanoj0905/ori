// Layout-aware key bindings (final review item 5): see keys.ts for the design.
import { describe, expect, test } from 'vitest'
import { DEFAULT_BINDINGS, findConflicts, sameBinding } from './bindings'
import { describeBinding } from './describe'
import { bindingFromKeyEvent, matchesKey, migrateKeyBinding } from './keys'
import type { Binding, Mods } from './schema'
import { migrate } from './store'

const none: Mods = { mod: false, shift: false, alt: false }
type Ev = { key: string; code: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; altGraph?: boolean }
const ev = ({ altGraph, ...e }: Ev) => ({
  ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...e,
  getModifierState: (k: string) => k === 'AltGraph' && altGraph === true,
})
const keyB = (key: string, mods: Partial<Mods> = {}): Binding => ({ type: 'key', key, mods: { ...none, ...mods } })
const codeB = (code: string, mods: Partial<Mods> = {}): Binding => ({ type: 'key', code, mods: { ...none, ...mods } })
const k = (b: Binding) => b as Extract<Binding, { type: 'key' }>

describe('matching', () => {
  test('QWERTZ: the key printed Z (code KeyY) undoes; the key printed Y does not', () => {
    const undo = k(DEFAULT_BINDINGS.undo[0]!)
    expect(matchesKey(undo, ev({ key: 'z', code: 'KeyY', ctrlKey: true }))).toBe(true)
    expect(matchesKey(undo, ev({ key: 'y', code: 'KeyZ', ctrlKey: true }))).toBe(false)
    expect(matchesKey(undo, ev({ key: 'z', code: 'KeyY', metaKey: true }))).toBe(true) // Cmd on macOS
  })

  test('AZERTY: M, A and Z match by the letter printed on the key', () => {
    expect(matchesKey(k(DEFAULT_BINDINGS.mountain[0]!), ev({ key: 'm', code: 'Semicolon' }))).toBe(true)
    expect(matchesKey(k(keyB('a')), ev({ key: 'a', code: 'KeyQ' }))).toBe(true)
    expect(matchesKey(k(DEFAULT_BINDINGS.redo[0]!), ev({ key: 'Z', code: 'KeyW', ctrlKey: true, shiftKey: true }))).toBe(true)
  })

  test('letters still compare Shift (Ctrl+Z is not Ctrl+Shift+Z)', () => {
    expect(matchesKey(k(DEFAULT_BINDINGS.undo[0]!), ev({ key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  test('"?" is matched by the character, whatever Shift it took (US Shift+/, German Shift+ß, French Shift+,)', () => {
    const sheet = k(DEFAULT_BINDINGS.shortcuts[0]!)
    expect(matchesKey(sheet, ev({ key: '?', code: 'Slash', shiftKey: true }))).toBe(true)
    expect(matchesKey(sheet, ev({ key: '?', code: 'Minus', shiftKey: true }))).toBe(true)
    expect(matchesKey(sheet, ev({ key: '?', code: 'KeyM', shiftKey: true }))).toBe(true)
    expect(matchesKey(sheet, ev({ key: '/', code: 'Slash' }))).toBe(false)
  })

  test('[ and ] match the characters, including AltGr on European layouts (not read as Ctrl+Alt)', () => {
    const less = k(DEFAULT_BINDINGS.layersLess[0]!)
    expect(matchesKey(less, ev({ key: '[', code: 'BracketLeft' }))).toBe(true)
    expect(matchesKey(less, ev({ key: '[', code: 'Digit8', ctrlKey: true, altKey: true, altGraph: true }))).toBe(true)
    expect(matchesKey(less, ev({ key: 'ü', code: 'BracketLeft' }))).toBe(false)
  })

  test('a layout that cannot type the Latin letter falls back to the key position', () => {
    // Russian: the key at KeyV types "м".
    expect(matchesKey(k(DEFAULT_BINDINGS.valley[0]!), ev({ key: 'м', code: 'KeyV' }))).toBe(true)
    // An event with no key value (synthetic) also falls back.
    expect(matchesKey(k(DEFAULT_BINDINGS.valley[0]!), ev({ key: '', code: 'KeyV' }))).toBe(true)
  })

  test('named keys keep matching by code', () => {
    expect(matchesKey(k(DEFAULT_BINDINGS.cancel[0]!), ev({ key: 'Escape', code: 'Escape' }))).toBe(true)
    expect(DEFAULT_BINDINGS.cancel[0]).toEqual(codeB('Escape'))
  })
})

describe('capture', () => {
  test('a letter is stored by the letter typed (lower case), modifiers kept', () => {
    expect(bindingFromKeyEvent(ev({ key: 'z', code: 'KeyY' }))).toEqual(keyB('z'))
    expect(bindingFromKeyEvent(ev({ key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true }))).toEqual(keyB('z', { mod: true, shift: true }))
  })

  test('a symbol is stored by its character, without the Shift it took', () => {
    expect(bindingFromKeyEvent(ev({ key: '?', code: 'Slash', shiftKey: true }))).toEqual(keyB('?'))
    expect(bindingFromKeyEvent(ev({ key: '[', code: 'Digit8', ctrlKey: true, altKey: true, altGraph: true }))).toEqual(keyB('['))
  })

  test('macOS Option+letter (types a symbol) is stored as Alt + the letter of the key', () => {
    expect(bindingFromKeyEvent(ev({ key: 'π', code: 'KeyP', altKey: true }))).toEqual(keyB('p', { alt: true }))
  })

  test('named keys are stored by code', () => {
    expect(bindingFromKeyEvent(ev({ key: 'ArrowLeft', code: 'ArrowLeft' }))).toEqual(codeB('ArrowLeft'))
    expect(bindingFromKeyEvent(ev({ key: ' ', code: 'Space' }))).toEqual(codeB('Space'))
  })
})

describe('labels', () => {
  test('from the stored key: letters upper case, symbols as typed', () => {
    expect(describeBinding(keyB('z', { mod: true }))).toBe('Ctrl/⌘ + Z')
    expect(describeBinding(keyB('z', { mod: true, shift: true }))).toBe('Ctrl/⌘ + Shift + Z')
    expect(describeBinding(keyB('?'))).toBe('?')
    expect(describeBinding(keyB('['))).toBe('[')
    expect(describeBinding(keyB('ö'))).toBe('Ö')
  })
})

describe('migration of code-based bindings', () => {
  test('letters, digits and US punctuation become key bindings; Shift+/ becomes "?"; named keys stay', () => {
    expect(migrateKeyBinding(codeB('KeyZ', { mod: true }))).toEqual(keyB('z', { mod: true }))
    expect(migrateKeyBinding(codeB('Digit3', { alt: true }))).toEqual(keyB('3', { alt: true }))
    expect(migrateKeyBinding(codeB('BracketLeft'))).toEqual(keyB('['))
    expect(migrateKeyBinding(codeB('Slash', { shift: true }))).toEqual(keyB('?'))
    expect(migrateKeyBinding(codeB('Escape'))).toEqual(codeB('Escape'))
    // A shifted digit has no layout-free character: left on its physical key.
    expect(migrateKeyBinding(codeB('Digit1', { shift: true }))).toEqual(codeB('Digit1', { shift: true }))
  })

  test('saved settings with the old code-based defaults load as the new defaults', () => {
    const old = {
      version: 1,
      bindings: {
        valley: [codeB('KeyV')], undo: [codeB('KeyZ', { mod: true })], shortcuts: [codeB('Slash', { shift: true })],
        layersLess: [codeB('BracketLeft'), { type: 'wheel', mods: none }],
      },
    }
    const s = migrate(old)
    expect(s.bindings.valley).toEqual(DEFAULT_BINDINGS.valley)
    expect(s.bindings.undo).toEqual(DEFAULT_BINDINGS.undo)
    expect(s.bindings.shortcuts).toEqual(DEFAULT_BINDINGS.shortcuts)
    expect(s.bindings.layersLess).toEqual(DEFAULT_BINDINGS.layersLess)
  })

  test('a code binding and the key binding it migrates to are the same binding (conflicts see through)', () => {
    expect(sameBinding(codeB('KeyB'), keyB('b'))).toBe(true)
    expect(findConflicts({ ...DEFAULT_BINDINGS, petal: [codeB('KeyV')] })).toContainEqual(['valley', 'petal'])
  })
})
