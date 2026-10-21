import type { Action, Binding, Bindings, Mods } from './schema'

const NONE: Mods = { mod: false, shift: false, alt: false }
const key = (code: string, mods: Partial<Mods> = {}): Binding => ({ type: 'key', code, mods: { ...NONE, ...mods } })
const mouse = (button: 0 | 1 | 2): Binding => ({ type: 'mouse', button, mods: { ...NONE } })
const wheel = (): Binding => ({ type: 'wheel', mods: { ...NONE } })

/**
 * Spec 04 default table. Unbound by default (the table has no entry): topView,
 * resetView, settings. Wheel: zoom and layersLess/layersMore all hold a plain
 * wheel; the router picks the meaning by context (folding -> layers).
 */
export const DEFAULT_BINDINGS: Bindings = {
  fold: [mouse(0)],
  orbit: [mouse(2)],
  pan: [mouse(1)],
  zoom: [wheel()],
  layersLess: [key('BracketLeft'), wheel()],
  layersMore: [key('BracketRight'), wheel()],
  angleSnap: [{ type: 'modifier', key: 'shift' }],
  valley: [key('KeyV')],
  mountain: [key('KeyM')],
  reverse: [key('KeyR')],
  squash: [key('KeyS')],
  petal: [key('KeyP')],
  turnOver: [key('KeyT')],
  undo: [key('KeyZ', { mod: true })],
  redo: [key('KeyZ', { mod: true, shift: true })],
  cancel: [key('Escape')],
  topView: [],
  resetView: [],
  shortcuts: [key('Slash', { shift: true })],
  settings: [],
}

export const cloneBindings = (b: Bindings): Bindings =>
  JSON.parse(JSON.stringify(b)) as Bindings

const sameMods = (a: Mods, b: Mods) => a.mod === b.mod && a.shift === b.shift && a.alt === b.alt

export function sameBinding(a: Binding, b: Binding): boolean {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'key': return a.code === (b as typeof a).code && sameMods(a.mods, (b as typeof a).mods)
    case 'mouse': return a.button === (b as typeof a).button && sameMods(a.mods, (b as typeof a).mods)
    case 'wheel': return sameMods(a.mods, (b as typeof a).mods)
    case 'modifier': return a.key === (b as typeof a).key
  }
}

/** Wheel actions that the router separates by context (folding vs not). */
const WHEEL_CONTEXTS: ReadonlySet<Action> = new Set<Action>(['zoom', 'layersLess', 'layersMore'])

/**
 * Two actions conflict when they hold an identical binding (same type, code or
 * button, same modifier set). Rules:
 *  - `modifier` bindings are their own class: compared only with each other.
 *  - an identical wheel binding shared by zoom / layersLess / layersMore is NOT
 *    a conflict: zoom applies when not folding, layers while folding, and
 *    less/more are the two scroll directions.
 * Returns each conflicting pair once, in ACTION declaration order.
 */
export function findConflicts(b: Bindings): [Action, Action][] {
  const actions = Object.keys(b) as Action[]
  const out: [Action, Action][] = []
  for (let i = 0; i < actions.length; i++) {
    for (let j = i + 1; j < actions.length; j++) {
      const x = actions[i], y = actions[j]
      const clash = b[x].some(p =>
        b[y].some(q => {
          if (!sameBinding(p, q)) return false
          if (p.type === 'wheel' && WHEEL_CONTEXTS.has(x) && WHEEL_CONTEXTS.has(y)) return false
          return true
        }))
      if (clash) out.push([x, y])
    }
  }
  return out
}
