// Keyboard folding (spec 04 section 2): a complete fold path with no mouse.
//
//   F (the remappable `keyboardFold` action)  the landmark cursor appears
//   Tab / Shift+Tab, arrows                   move the cursor
//   Enter                                     set the grab point
//   Tab / arrows                              cycle target landmarks (live preview)
//   L  V M                                    layer belt, fold kind (the normal bindings)
//
// The layer belt (spec 09), once a grab point is set: L opens it at the grab
// with the top layer hovered. Up / Down move through the stack, Enter takes the
// hovered layer and those above it, Esc closes the belt only. Each row is
// announced ("Layer 2 of 4: top flap and 1 below").
//   + -                                       fold angle in 22.5 degree steps
//   Enter                                     commit        Esc  cancel
//
// Tool modes (Reverse, Squash, Petal) use the same flow: the grab begins with
// whatever tool is active. The cursor is the Stage's landmark marker.
//
// Cursor movement
//  - Arrows: the nearest landmark inside a +-45 degree cone around the arrow's
//    direction, 45 degrees exclusive ("up" is +y, as drawn). No landmark in the cone: the cursor stays.
//  - Tab: reading order of the folded model as seen from above, top to bottom
//    (descending y) and, within a row, left to right (ascending x). Shift+Tab
//    goes back. Both wrap. From no position, Tab starts at the first landmark.
//
// Lessons (spec 06: completable by keyboard): the current step's demo grab and
// target points (lessons/lessonSlice lessonPoints) join the landmarks, named
// "lesson grab point" / "lesson target point", and the cursor starts on the
// grab point.
import { current, landmarks, stackProfile } from '@engine'
import type { Landmark, Vec2 } from '@engine'
import { dragProgress } from './useFoldGesture'
import { announce as defaultAnnounce, foldWords } from './announce'
import { useUi, type KeyboardPhase } from './ui'
import { layerWords } from './belt'
import type { StudioState } from './store'
import { lessonPoints } from '../lessons/lessonSlice'

export type Dir = 'tab' | 'up' | 'down' | 'left' | 'right'

const ROW_EPS = 1e-6
const SAME = 1e-6
const CONE = Math.PI / 4
export const ANGLE_STEP = 22.5

const DIRS: Record<Exclude<Dir, 'tab'>, Vec2> = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] }

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Reading order: top to bottom, then left to right. */
function reading(a: Landmark, b: Landmark): number {
  if (Math.abs(a.p[1] - b.p[1]) > ROW_EPS) return b.p[1] - a.p[1]
  return a.p[0] - b.p[0]
}

/**
 * The next cursor position (see the header). `ls` must not be empty. `reverse`
 * (Shift+Tab) walks the reading order backwards; it only matters for 'tab'.
 */
export function nextLandmark(ls: readonly Landmark[], from: Vec2 | null, dir: Dir, reverse = false): Landmark {
  if (ls.length === 0) throw new Error('nextLandmark needs at least one landmark')
  const sorted = [...ls].sort(reading)
  if (from === null) return sorted[0]!

  if (dir === 'tab') {
    const here = sorted.findIndex(l => dist(l.p, from) < SAME)
    if (here >= 0) return sorted[(here + (reverse ? sorted.length - 1 : 1)) % sorted.length]!
    // `from` is not a landmark: the first one after it in reading order (before it, reversed).
    const probe: Landmark = { p: from, kind: 'corner' }
    const after = reverse
      ? [...sorted].reverse().find(l => reading(l, probe) < 0)
      : sorted.find(l => reading(l, probe) > 0)
    return after ?? (reverse ? sorted[sorted.length - 1]! : sorted[0]!)
  }

  const d = DIRS[dir]
  let best: { l: Landmark; d: number; a: number } | null = null
  for (const l of sorted) {
    const v: Vec2 = [l.p[0] - from[0], l.p[1] - from[1]]
    const r = Math.hypot(v[0], v[1])
    if (r < SAME) continue
    const a = Math.acos(Math.min(1, Math.max(-1, (v[0] * d[0] + v[1] * d[1]) / r)))
    if (a >= CONE - 1e-9) continue // exactly diagonal is outside the cone
    if (!best || r < best.d - 1e-9 || (Math.abs(r - best.d) <= 1e-9 && a < best.a)) best = { l, d: r, a }
  }
  if (best) return best.l
  // Nothing that way: stay on the current landmark (or the closest one if `from` is off the grid).
  return sorted.reduce((m, l) => (dist(l.p, from) < dist(m.p, from) ? l : m))
}

const KIND_NAMES: Record<Landmark['kind'], string> = {
  corner: 'corner', midpoint: 'edge midpoint', intersection: 'crease crossing', edge: 'edge',
}

/** "top left corner", "bottom centre edge midpoint": where the landmark sits on the model. */
export function describeLandmark(l: Landmark, ls: readonly Landmark[]): string {
  const xs = ls.map(x => x.p[0])
  const ys = ls.map(x => x.p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const third = (v: number, lo: number, hi: number, names: [string, string, string]) => {
    if (hi - lo < ROW_EPS) return names[1]
    const f = (v - lo) / (hi - lo)
    return f < 0.25 ? names[0] : f > 0.75 ? names[2] : names[1]
  }
  const vert = third(l.p[1], y0, y1, ['bottom', 'middle', 'top'])
  const horiz = third(l.p[0], x0, x1, ['left', 'centre', 'right'])
  const where = vert === 'middle' && horiz === 'centre' ? 'centre' : `${vert} ${horiz}`
  return `${where} ${KIND_NAMES[l.kind]}`
}

export type KeyInfo = { key: string; shiftKey?: boolean }
type StoreLike = {
  getState(): StudioState
  subscribe(listener: (s: StudioState, prev: StudioState) => void): () => void
}
export type KeyboardFoldDeps = {
  stage?: { setHoverMarker?(p: Vec2 | null): void; clientOf?(p: Vec2): Vec2 }
  store: StoreLike
  announce?: (text: string) => void
  onPhase?: (p: KeyboardPhase) => void
}

const bisector = (grab: Vec2, target: Vec2) => {
  const d: Vec2 = [target[0] - grab[0], target[1] - grab[1]]
  if (Math.hypot(d[0], d[1]) < 1e-4) return null
  return { origin: [(grab[0] + target[0]) / 2, (grab[1] + target[1]) / 2] as Vec2, vector: [-d[1], d[0]] as Vec2 }
}

const ANGLE_KEYS = { '+': 1, '=': 1, '-': -1, '_': -1 } as const
const ARROWS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

export function createKeyboardFold({ stage, store, announce = defaultAnnounce, onPhase = p => useUi.getState().setKf(p) }: KeyboardFoldDeps) {
  let phase: KeyboardPhase = 'idle'
  let cursor: Landmark | null = null
  let ls: Landmark[] = []
  let grab: Vec2 | null = null
  /** Lesson points among `ls` (see the header), by landmark. */
  let lessonNames = new Map<Landmark, string>()
  /** Lesson points that are not engine landmarks (named by place only). */
  const own = new WeakSet<Landmark>()
  const nameOf = (l: Landmark) => {
    const extra = lessonNames.get(l)
    if (!extra) return describeLandmark(l, ls)
    const place = describeLandmark(l, ls)
    return own.has(l) ? `${place.slice(0, place.length - KIND_NAMES[l.kind].length).trim()}, ${extra}` : `${place}, ${extra}`
  }

  const setPhase = (p: KeyboardPhase) => {
    phase = p
    onPhase(p)
  }
  const marker = (p: Vec2 | null) => stage?.setHoverMarker?.(p)

  const reset = (cancelGesture: boolean) => {
    if (phase === 'idle') return
    if (cancelGesture && store.getState().gesture) store.getState().cancel()
    useUi.getState().closeBelt()
    cursor = null
    grab = null
    ls = []
    lessonNames = new Map()
    marker(null)
    setPhase('idle')
  }

  /** The words for the live preview. A refusal is announced by the log watcher, not here. */
  const previewWords = (): string => {
    const { gesture, preview, refusal } = store.getState()
    if (refusal) return ''
    if (!gesture || !preview) return ''
    return `Preview: ${foldWords(gesture.tool, gesture.kind, gesture.layers, preview.angleDeg)}.`
  }

  const moveTo = (l: Landmark) => {
    cursor = l
    marker(l.p)
    const name = nameOf(l)
    if (phase === 'target' && grab) {
      const crease = bisector(grab, l.p)
      if (crease) {
        store.getState().drag(l.p, dragProgress(grab, crease, l.p))
        announce(`${name}. ${previewWords()}`.trim())
        return
      }
      // Back on the grab point: there is nothing to fold to. Drop the previous target's preview
      // (a fresh begun gesture) so Enter cannot commit a fold to where the cursor no longer is.
      store.getState().begin(grab)
    }
    announce(`${name}.`)
  }

  const unsub = store.subscribe((s, prev) => {
    if (phase === 'idle') return
    // The model changed under the cursor (commit, undo, new sheet): its landmarks are stale.
    if (s.history !== prev.history) reset(true)
    // The gesture was ended elsewhere (Esc via the router, a pointer fold).
    else if (phase === 'target' && !s.gesture) reset(false)
  })

  const stepAngle = (sign: 1 | -1) => {
    const { gesture, preview } = store.getState()
    if (phase !== 'target' || !gesture || !preview) {
      announce('Choose a point to fold to first.')
      return
    }
    const cur = gesture.angleDeg ?? preview.angleDeg
    const next = Math.min(180, Math.max(ANGLE_STEP, Math.round(cur / ANGLE_STEP) * ANGLE_STEP + sign * ANGLE_STEP))
    store.getState().setNumeric({ angleDeg: next })
    const after = store.getState()
    announce(`Angle ${Number(next.toFixed(1))} degrees. ${after.refusal ? '' : previewWords()}`.trim())
  }

  const enter = () => {
    if (!cursor) return
    if (phase === 'grab') {
      grab = cursor.p
      store.getState().begin(cursor.p)
      setPhase('target')
      announce(`Grab point set at ${nameOf(cursor)}. Choose where to fold to, then press Enter.`)
      return
    }
    const { preview, refusal } = store.getState()
    if (refusal) {
      announce('Choose another point.')
      return
    }
    if (!preview) {
      announce('Choose a point to fold to first.')
      return
    }
    // The commit's own result (a new step, or a refusal) is announced by the log watcher.
    void store.getState().release()
  }

  /** Up / Down / Enter / Esc while the belt is open (see the header). */
  const beltKey = (key: string): boolean => {
    const ui = useUi.getState()
    const belt = ui.belt!
    const n = belt.stack.faces.length
    const at = belt.hovered ?? 0
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const next = Math.min(n - 1, Math.max(0, at + (key === 'ArrowDown' ? 1 : -1)))
      ui.hoverBelt(next)
      announce(layerWords(next + 1, n))
    } else if (key === 'Enter') {
      store.getState().setLayers(at + 1)
      ui.closeBelt()
      announce(`${layerWords(at + 1, n)}. ${previewWords()}`.trim())
    } else if (key === 'Escape') ui.closeBelt()
    // The cursor's other keys wait for the belt to close; the normal bindings (V, M, L) stay live.
    else return key === 'Tab' || key in ANGLE_KEYS
    return true
  }

  return {
    phase: (): KeyboardPhase => phase,

    /** The layerPicker key: open the layer belt at the grab point. True when it opened. */
    openBelt(): boolean {
      const { gesture, history } = store.getState()
      if (phase !== 'target' || !grab || !gesture) return false
      const stack = stackProfile(current(history), grab)
      if (stack.faces.length < 2) {
        announce('One layer here: nothing to pick.')
        return false
      }
      const [clientX, clientY] = stage?.clientOf?.(grab) ?? [0, 0]
      useUi.getState().openBelt({ clientX, clientY, stack, hovered: 0, keyboard: true })
      announce(layerWords(1, stack.faces.length))
      return true
    },

    /** The fold key: show the landmark cursor and wait for a grab point. */
    start(): void {
      if (phase !== 'idle') return
      // Not while a fold is live (a mouse drag): begin() would clobber it under the pointer.
      if (store.getState().pending || store.getState().gesture) return
      ls = landmarks(current(store.getState().history))
      if (ls.length === 0) return
      let start: Landmark | null = null
      const lp = lessonPoints(store.getState())
      if (lp) {
        for (const [p, name] of [[lp.grab, 'lesson grab point'], [lp.target, 'lesson target point']] as const) {
          let l = ls.find(x => dist(x.p, p) < SAME)
          if (!l) {
            l = { p: [p[0], p[1]], kind: 'edge' }
            own.add(l)
            ls.push(l)
          }
          lessonNames.set(l, lessonNames.has(l) ? `${lessonNames.get(l)} and ${name}` : name)
          if (name === 'lesson grab point') start = l
        }
      }
      cursor = start ?? nextLandmark(ls, null, 'tab')
      setPhase('grab')
      marker(cursor.p)
      announce(`Keyboard fold. Choose a grab point with the arrow keys or Tab, then press Enter. ${nameOf(cursor)}.`)
    },

    /** Returns true when the key was consumed (the caller then preventDefault()s it). */
    key(e: KeyInfo): boolean {
      if (phase === 'idle') return false
      if (useUi.getState().belt?.keyboard) return beltKey(e.key)
      if (e.key === 'Escape') {
        reset(true)
        announce('Keyboard fold cancelled.')
        return true
      }
      if (e.key === 'Enter') {
        enter()
        return true
      }
      if (e.key === 'Tab') {
        if (cursor) moveTo(nextLandmark(ls, cursor.p, 'tab', e.shiftKey === true))
        return true
      }
      const dir = ARROWS[e.key]
      if (dir) {
        if (!cursor) return true
        const next = nextLandmark(ls, cursor.p, dir)
        if (next === cursor || dist(next.p, cursor.p) < SAME) announce('No landmark that way.')
        else moveTo(next)
        return true
      }
      if (e.key === '+' || e.key === '=') {
        stepAngle(1)
        return true
      }
      if (e.key === '-' || e.key === '_') {
        stepAngle(-1)
        return true
      }
      return false
    },

    /** Leave the mode, cancelling any gesture it began. */
    cancel(): void {
      reset(true)
    },

    dispose(): void {
      unsub()
      reset(false)
    },
  }
}
export type KeyboardFold = ReturnType<typeof createKeyboardFold>
