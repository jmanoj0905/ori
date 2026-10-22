// The autosave payload, parsed and replayed (spec 05 phase 1, R29, R52).
// Pure: no storage, no notices, no DOM, so the replay can run in the engine
// Worker (studio/engineWorker.ts) while the main thread shows a light loading
// state. autosave.ts reads the storage and calls these.
//
// Payload: { version: 1, paper, steps, cursor }. Each fold step is re-committed
// from its recorded {tool, grab, target, layers, kind, crease, angleDeg, face}
// with snapAngle off and progress 1; crease + angleDeg make the replay exact
// for plain folds (compound tools record neither and replay from grab /
// target / layers / kind). Any refusal, throw or malformed field means the save
// is corrupt (null).
import { PAPER_SIZES, commit, createPaper, jumpTo, push, startHistory, turnOver } from '@engine'
import type { Gesture, History, Line, Tool, Vec2 } from '@engine'
import { cleanPaper, type PaperSettings, type SheetSize } from '../paper'

/**
 * Saves with more steps than this are not replayed (an absurd or hostile
 * payload must not tie up the engine). Far above any real session: the crane
 * preset is 22 steps.
 */
export const MAX_RESTORE_STEPS = 1000

export type ReplayStep = { turnOver: true } | { gesture: Gesture }

/** A validated save, ready to replay. */
export type SavedModel = { paper: PaperSettings; steps: ReplayStep[]; cursor: number }

export type Restored = { history: History; paper: PaperSettings }

const TOOLS: readonly string[] = ['fold', 'reverse', 'squash', 'petal']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const vec = (v: unknown): v is Vec2 => Array.isArray(v) && v.length === 2 && v.every(num)
const line = (v: unknown): v is Line => isObj(v) && vec(v.origin) && vec(v.vector)

function sizeOf(size: SheetSize): { width: number; height: number } {
  if (size === 'square' || size === 'a4') return PAPER_SIZES[size]
  return { width: size.width, height: size.height }
}

/** The replay Gesture for a recorded fold step, or null when its params are malformed. */
function gestureOf(params: unknown): Gesture | null {
  if (!isObj(params)) return null
  const { tool, grab, target, layers, kind, angleDeg, crease, face } = params
  if (typeof tool !== 'string' || !TOOLS.includes(tool) || !vec(grab) || !vec(target)) return null
  if (!num(layers) || (kind !== 'valley' && kind !== 'mountain')) return null
  if (face !== undefined && !num(face)) return null
  // Plain folds record crease + angleDeg (exact replay). Compound tools (reverse,
  // squash, petal) record neither: the engine derives their geometry from the gesture.
  const exact = tool === 'fold'
  if (exact ? !num(angleDeg) || !line(crease) : (angleDeg !== undefined && !num(angleDeg)) || (crease !== undefined && !line(crease))) return null
  return {
    tool: tool as Tool, grab, target, layers, kind, progress: 1, snapAngle: false,
    ...(crease === undefined ? {} : { crease: crease as Line }),
    ...(angleDeg === undefined ? {} : { angleDeg: angleDeg as number }),
    ...(face === undefined ? {} : { face }),
  }
}

/**
 * A parsed JSON payload → a SavedModel, or null when it is not a usable save:
 * unknown version, malformed step, more than MAX_RESTORE_STEPS steps. The
 * paper must be an object; its fields are cleaned like the settings' paper
 * defaults (cleanPaper: #rrggbb colours, thickness / translucency in [0, 1]).
 */
export function parseSave(raw: unknown): SavedModel | null {
  if (!isObj(raw) || raw.version !== 1 || !isObj(raw.paper)) return null
  const { steps, cursor } = raw
  if (!Array.isArray(steps) || steps.length > MAX_RESTORE_STEPS || !num(cursor)) return null
  const out: ReplayStep[] = []
  for (const s of steps as unknown[]) {
    if (!isObj(s)) return null
    if (s.kind === 'turnOver') {
      out.push({ turnOver: true })
      continue
    }
    const g = gestureOf(s.params)
    if (!g || s.kind !== g.tool) return null
    out.push({ gesture: g })
  }
  const c = Math.min(out.length, Math.max(0, Math.trunc(cursor)))
  return { paper: cleanPaper(raw.paper), steps: out, cursor: c }
}

/** Rebuild the history from a save, or null if any step does not replay. */
export function replaySave(saved: SavedModel): Restored | null {
  if (saved.steps.length > MAX_RESTORE_STEPS) return null
  let h = startHistory(createPaper(sizeOf(saved.paper.size)))
  for (const s of saved.steps) {
    const frame = h.frames[h.cursor]
    const res = 'turnOver' in s ? turnOver(frame) : commit(frame, s.gesture)
    if (!res.ok) return null
    h = push(h, res.step, res.frame)
  }
  return { history: jumpTo(h, saved.cursor), paper: saved.paper }
}
