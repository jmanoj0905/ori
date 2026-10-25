// Keyboard bindings that follow the user's layout (final review item 5).
//
// Design
//  - A key binding is either by CHARACTER ({ key }) or by PHYSICAL KEY ({ code }).
//  - Letters, digits and punctuation are stored by character: `key` is what the
//    key types (letters lower-case). The label is that character, so it matches
//    what is printed on the user's keyboard (QWERTZ: the key printed Z, which
//    sends code KeyY, undoes).
//      * letters: Shift is compared like any modifier (Ctrl+Z ≠ Ctrl+Shift+Z);
//        when the event's key is not a Latin letter (a Cyrillic or Greek layout,
//        macOS Option producing a symbol, a synthetic event with no key) the
//        letter falls back to its physical key (code `Key<LETTER>`), so such
//        layouts still reach every action.
//      * other characters ("?", "[", "]", digits): Shift is NOT compared — the
//        character already says whether it took Shift (US Shift+/, German
//        Shift+ß and French Shift+, all type "?"). Ctrl/⌘ and Alt still are.
//      * AltGr (reported as Ctrl+Alt on Windows) is the layout's third level,
//        not a chord: with AltGraph down, Ctrl and Alt are ignored (German
//        AltGr+8 types "[").
//  - Named keys (Escape, Enter, Tab, Space, arrows, F-keys, …) keep `code`:
//    they are the same on every layout.
//  - Saved settings from before this change stored every key by code; loading
//    migrates the ones with a layout-free character (migrateKeyBinding).
import type { Binding, KeyBinding, Mods } from './schema'

/** The KeyboardEvent fields the bindings read. */
export type KeyEventLike = {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  getModifierState?(key: string): boolean
}

const LETTER = /^[a-z]$/

/** The event's modifiers; AltGr is a character level, not Ctrl + Alt. */
export function keyMods(e: KeyEventLike): Mods {
  const altGraph = e.getModifierState?.('AltGraph') === true
  return { mod: !altGraph && (e.ctrlKey || e.metaKey), shift: e.shiftKey, alt: !altGraph && e.altKey }
}

/** The single character the event types, letters lower-cased; '' for named keys and Space. */
function charOf(e: KeyEventLike): string {
  const k = e.key
  if (!k || [...k].length !== 1 || k === ' ') return ''
  return k.toLowerCase()
}

const sameMods = (a: Mods, b: Mods) => a.mod === b.mod && a.shift === b.shift && a.alt === b.alt

/** Whether the key event triggers `b`. */
export function matchesKey(b: KeyBinding, e: KeyEventLike): boolean {
  const mods = keyMods(e)
  if (b.key === undefined) return b.code === e.code && sameMods(b.mods, mods)
  const ch = charOf(e)
  if (LETTER.test(b.key)) {
    const hit = LETTER.test(ch) ? ch === b.key : e.code === `Key${b.key.toUpperCase()}`
    return hit && sameMods(b.mods, mods)
  }
  return ch === b.key && b.mods.mod === mods.mod && b.mods.alt === mods.alt
}

/** The binding a captured key press stands for (the settings sheet's "Change"). */
export function bindingFromKeyEvent(e: KeyEventLike): KeyBinding {
  const mods = keyMods(e)
  const ch = charOf(e)
  if (!ch) return { type: 'key', code: e.code, mods }
  // macOS Option+letter types a symbol (Option+P → π): keep the letter of the key.
  if (!LETTER.test(ch) && mods.alt && /^Key[A-Z]$/.test(e.code)) return { type: 'key', key: e.code.slice(3).toLowerCase(), mods }
  if (LETTER.test(ch)) return { type: 'key', key: ch, mods }
  return { type: 'key', key: ch, mods: { ...mods, shift: false } }
}

/** US-layout characters of the unshifted punctuation codes (the pre-migration defaults were US). */
const US_CHARS: Record<string, string> = {
  BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Semicolon: ';',
  Quote: "'", Backquote: '`', Minus: '-', Equal: '=', Backslash: '\\',
}

/**
 * A code-based key binding → its character binding where that is layout-free:
 * KeyA–KeyZ (any modifiers), unshifted digits and US punctuation, and Shift+/
 * ("?"). Anything else (named keys, other shifted symbols) is returned as is,
 * and keeps working on its physical key.
 */
export function migrateKeyBinding<B extends Binding>(b: B): B | KeyBinding {
  if (b.type !== 'key' || b.key !== undefined) return b
  const { code, mods } = b
  if (/^Key[A-Z]$/.test(code)) return { type: 'key', key: code.slice(3).toLowerCase(), mods: { ...mods } }
  if (code === 'Slash' && mods.shift) return { type: 'key', key: '?', mods: { ...mods, shift: false } }
  if (mods.shift) return b
  if (/^Digit\d$/.test(code)) return { type: 'key', key: code.slice(5), mods: { ...mods } }
  if (US_CHARS[code]) return { type: 'key', key: US_CHARS[code]!, mods: { ...mods } }
  return b
}
