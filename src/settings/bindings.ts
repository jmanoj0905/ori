import { migrateKeyBinding } from './keys'
import type { Action, Binding, Bindings, Mods } from './schema'

const NONE: Mods = { mod: false, shift: false, alt: false }
/** A character key (layout-aware, keys.ts). */
const key = (k: string, mods: Partial<Mods> = {}): Binding => ({ type: 'key', key: k, mods: { ...NONE, ...mods } })
/** A named key, by physical code. */
const named = (code: string): Binding => ({ type: 'key', code, mods: { ...NONE } })
const mouse = (button: 0 | 1 | 2): Binding => ({ type: 'mouse', button, mods: { ...NONE } })
const wheel = (): Binding => ({ type: 'wheel', mods: { ...NONE } })

/**
 * Spec 04 default table. Unbound by default (the table has no entry): topView,
 * resetView, settings. `keyboardFold` (F), `layerPicker` (L) and `forceNewFold`
 * (hold Alt) are additions to the table. The plain wheel is always zoom; layers
 * are chosen from the layer belt, never stepped blind.
 */
export const DEFAULT_BINDINGS: Bindings = {
  fold: [mouse(0)],
  orbit: [mouse(2)],
  pan: [mouse(1)],
  zoom: [wheel()],
  layerPicker: [key('l')],
  forceNewFold: [{ type: 'modifier', key: 'alt' }],
  angleSnap: [{ type: 'modifier', key: 'shift' }],
  valley: [key('v')],
  mountain: [key('m')],
  reverse: [key('r')],
  squash: [key('s')],
  petal: [key('p')],
  turnOver: [key('t')],
  undo: [key('z', { mod: true })],
  redo: [key('z', { mod: true, shift: true })],
  cancel: [named('Escape')],
  topView: [],
  resetView: [],
  shortcuts: [key('?')],
  settings: [],
  // Not in the spec 04 table: the keyboard-only entry point (Task 10). Remappable.
  keyboardFold: [key('f')],
}

export const cloneBindings = (b: Bindings): Bindings =>
  JSON.parse(JSON.stringify(b)) as Bindings

const sameMods = (a: Mods, b: Mods) => a.mod === b.mod && a.shift === b.shift && a.alt === b.alt

export function sameBinding(a: Binding, b: Binding): boolean {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'key': {
      // Compare in the migrated form, so a legacy code binding equals its character binding.
      const x = migrateKeyBinding(a)
      const y = migrateKeyBinding(b as typeof a)
      return x.key === y.key && x.code === y.code && sameMods(x.mods, y.mods)
    }
    case 'mouse': return a.button === (b as typeof a).button && sameMods(a.mods, (b as typeof a).mods)
    case 'wheel': return sameMods(a.mods, (b as typeof a).mods)
    case 'modifier': return a.key === (b as typeof a).key
  }
}

/**
 * Two actions conflict when they hold an identical binding (same type, code or
 * button, same modifier set). Rules:
 *  - `modifier` bindings are their own class: compared only with each other.
 * Returns each conflicting pair once, in ACTION declaration order.
 */
export function findConflicts(b: Bindings): [Action, Action][] {
  const actions = Object.keys(b) as Action[]
  const out: [Action, Action][] = []
  for (let i = 0; i < actions.length; i++) {
    for (let j = i + 1; j < actions.length; j++) {
      const x = actions[i], y = actions[j]
      const clash = b[x].some(p =>
        b[y].some(q => sameBinding(p, q)))
      if (clash) out.push([x, y])
    }
  }
  return out
}
