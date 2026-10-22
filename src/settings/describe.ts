// Readable text for bindings and actions: "Ctrl/⌘ + Shift + Z", "Right-drag",
// "Scroll", "Hold Shift". Shared by the shortcut sheet and the settings sheet.
import type { Action, Binding, Mods } from './schema'

export const ACTION_LABELS: Record<Action, string> = {
  fold: 'Fold (grab and drag)',
  orbit: 'Orbit',
  pan: 'Pan',
  zoom: 'Zoom',
  layersLess: 'Fewer layers',
  layersMore: 'More layers',
  angleSnap: 'Angle snap',
  valley: 'Valley',
  mountain: 'Mountain',
  reverse: 'Reverse fold',
  squash: 'Squash fold',
  petal: 'Petal fold',
  turnOver: 'Turn over',
  undo: 'Undo',
  redo: 'Redo',
  cancel: 'Cancel',
  topView: 'Top view',
  resetView: 'Reset view',
  shortcuts: 'Shortcut sheet',
  settings: 'Open settings',
  keyboardFold: 'Keyboard fold',
}

const KEY_NAMES: Record<string, string> = {
  Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Space: 'Space', Backspace: 'Backspace', Delete: 'Delete',
  BracketLeft: '[', BracketRight: ']', Slash: '/', Backslash: '\\', Comma: ',', Period: '.',
  Semicolon: ';', Quote: "'", Backquote: '`', Minus: '-', Equal: '=',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
}

/** A KeyboardEvent.code in words: KeyV -> V, Digit3 -> 3, NumpadAdd -> Numpad +. */
export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code]
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad/.test(code)) return `Numpad ${code.slice(6).replace('Add', '+').replace('Subtract', '-').replace('Multiply', '×').replace('Divide', '÷')}`
  return code
}

const modPrefix = (m: Mods): string[] => [m.mod && 'Ctrl/⌘', m.alt && 'Alt', m.shift && 'Shift'].filter((x): x is string => !!x)

const BUTTONS = ['Left-drag', 'Middle-drag', 'Right-drag'] as const

export function describeBinding(b: Binding): string {
  switch (b.type) {
    case 'key':
      // A character binding is labelled by its character, as printed on the key.
      if (b.key !== undefined) return [...modPrefix(b.mods), b.key.toUpperCase()].join(' + ')
      // (Legacy code binding) Shift + / is the "?" key: say what is printed on it.
      if (b.code === 'Slash' && b.mods.shift && !b.mods.mod && !b.mods.alt) return '?'
      return [...modPrefix(b.mods), keyName(b.code)].join(' + ')
    case 'mouse':
      return [...modPrefix(b.mods), BUTTONS[b.button]].join(' + ')
    case 'wheel':
      return [...modPrefix(b.mods), 'Scroll'].join(' + ')
    case 'modifier':
      return `Hold ${b.key === 'mod' ? 'Ctrl/⌘' : b.key === 'alt' ? 'Alt' : 'Shift'}`
  }
}

export const describeBindings = (list: readonly Binding[]): string =>
  list.length ? list.map(describeBinding).join(' or ') : 'Unbound'

/** "Undo (Ctrl/⌘ + Z)" from the live bindings; just the label when the action is unbound. */
export const withShortcut = (label: string, list: readonly Binding[]): string =>
  list.length ? `${label} (${describeBindings(list)})` : label
