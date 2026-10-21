import { describe, expect, test } from 'vitest'
import { DEFAULT_BINDINGS } from './bindings'
import { ACTION_LABELS, describeBinding, describeBindings } from './describe'
import { ACTIONS, type Binding } from './schema'

const none = { mod: false, shift: false, alt: false }

describe('describeBinding', () => {
  test('keys, chords and the spec 04 examples', () => {
    expect(describeBinding({ type: 'key', code: 'KeyV', mods: none })).toBe('V')
    expect(describeBinding({ type: 'key', code: 'KeyZ', mods: { mod: true, shift: true, alt: false } })).toBe('Ctrl/⌘ + Shift + Z')
    expect(describeBinding({ type: 'key', code: 'KeyZ', mods: { mod: true, shift: false, alt: false } })).toBe('Ctrl/⌘ + Z')
    expect(describeBinding({ type: 'key', code: 'BracketLeft', mods: none })).toBe('[')
    expect(describeBinding({ type: 'key', code: 'Escape', mods: none })).toBe('Esc')
    expect(describeBinding({ type: 'key', code: 'Slash', mods: { mod: false, shift: true, alt: false } })).toBe('?')
    expect(describeBinding({ type: 'key', code: 'Digit3', mods: { mod: false, shift: false, alt: true } })).toBe('Alt + 3')
    expect(describeBinding({ type: 'key', code: 'ArrowLeft', mods: none })).toBe('←')
  })
  test('mouse, wheel and hold-modifier bindings', () => {
    expect(describeBinding({ type: 'mouse', button: 2, mods: none })).toBe('Right-drag')
    expect(describeBinding({ type: 'mouse', button: 0, mods: none })).toBe('Left-drag')
    expect(describeBinding({ type: 'mouse', button: 1, mods: { mod: false, shift: true, alt: false } })).toBe('Shift + Middle-drag')
    expect(describeBinding({ type: 'wheel', mods: none })).toBe('Scroll')
    expect(describeBinding({ type: 'wheel', mods: { mod: true, shift: false, alt: false } })).toBe('Ctrl/⌘ + Scroll')
    expect(describeBinding({ type: 'modifier', key: 'shift' })).toBe('Hold Shift')
    expect(describeBinding({ type: 'modifier', key: 'mod' })).toBe('Hold Ctrl/⌘')
  })
  test('lists join with "or"; an empty list reads Unbound', () => {
    const list: Binding[] = DEFAULT_BINDINGS.layersLess
    expect(describeBindings(list)).toBe('[ or Scroll')
    expect(describeBindings([])).toBe('Unbound')
  })
  test('every action has a label', () => {
    for (const a of ACTIONS) expect(ACTION_LABELS[a]).toBeTruthy()
  })
})
