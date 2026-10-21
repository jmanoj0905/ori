// Autosave (spec 05 phase 1, R29). Stores the step records, the cursor and the
// paper settings (never geometry) under `ori.autosave.v1`:
//   { version: 1, paper, steps, cursor }
// Redo entries are part of `steps`; `cursor` says how many are applied.
//
// Load replays every step through the engine, synchronously and on the calling
// thread (the Worker committer is async and the restore must land before the
// first paint; a few hundred ms on a long history is acceptable). Each fold is
// re-committed from its recorded {tool, grab, target, layers, kind, crease,
// angleDeg, face} with snapAngle off and progress 1; crease + angleDeg make the
// replay exact for plain folds (compound tools record neither and replay from
// grab / target / layers / kind). Any refusal, throw or malformed field means the save is corrupt:
// loadHistory returns null and shows RESTORE_FAILED once.
import { PAPER_SIZES, commit, createPaper, jumpTo, push, startHistory, turnOver } from '@engine'
import type { Gesture, History, Line, Step, Tool, Vec2 } from '@engine'
import type { PaperSettings, SheetSize } from '../studio/store'
import { AUTOSAVE_OFF, RESTORE_FAILED, noticeOnce } from './notice'

export const AUTOSAVE_KEY = 'ori.autosave.v1'
export const SAVE_DEBOUNCE_MS = 500

export type Restored = { history: History; paper: PaperSettings }

const TOOLS: readonly string[] = ['fold', 'reverse', 'squash', 'petal']
const MODES: readonly string[] = ['kami', 'washi', 'plain', 'custom']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const vec = (v: unknown): v is Vec2 => Array.isArray(v) && v.length === 2 && v.every(num)
const line = (v: unknown): v is Line => isObj(v) && vec(v.origin) && vec(v.vector)

function sizeOf(size: SheetSize): { width: number; height: number } | null {
  if (size === 'square' || size === 'a4') return PAPER_SIZES[size]
  return size.width > 0 && size.height > 0 ? { width: size.width, height: size.height } : null
}

function parsePaper(v: unknown): PaperSettings | null {
  if (!isObj(v) || typeof v.mode !== 'string' || !MODES.includes(v.mode)) return null
  if (typeof v.front !== 'string' || typeof v.back !== 'string' || !num(v.thickness) || !num(v.translucency)) return null
  const s = v.size
  const size: SheetSize | null =
    s === 'square' || s === 'a4' ? s : isObj(s) && num(s.width) && num(s.height) && s.width > 0 && s.height > 0 ? { width: s.width, height: s.height } : null
  if (!size) return null
  const pattern = v.pattern === 'seigaiha' || v.pattern === 'asanoha' ? v.pattern : undefined
  return {
    mode: v.mode as PaperSettings['mode'], front: v.front, back: v.back, thickness: v.thickness,
    translucency: v.translucency, size, ...(pattern ? { pattern } : {}),
  }
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

/** Rebuild the history from a parsed payload, or null if anything does not replay. */
function replay(raw: Record<string, unknown>): Restored | null {
  const paper = parsePaper(raw.paper)
  const { steps, cursor } = raw
  if (!paper || !Array.isArray(steps) || !num(cursor)) return null
  const dims = sizeOf(paper.size)
  if (!dims) return null
  let h = startHistory(createPaper(dims))
  for (const s of steps as unknown[]) {
    if (!isObj(s)) return null
    let res
    if (s.kind === 'turnOver') res = turnOver(h.frames[h.cursor])
    else {
      const g = gestureOf(s.params)
      if (!g || s.kind !== g.tool) return null
      res = commit(h.frames[h.cursor], g)
    }
    if (!res.ok) return null
    h = push(h, res.step, res.frame)
  }
  return { history: jumpTo(h, Math.trunc(cursor)), paper }
}

/**
 * Restore the autosaved model, or null (nothing saved, or the save is unusable).
 * An unusable save (bad JSON, unknown version, a step that does not replay)
 * shows RESTORE_FAILED once; an absent save or unreadable storage is silent.
 */
export function loadHistory(): Restored | null {
  let text: string | null
  try {
    text = globalThis.localStorage?.getItem(AUTOSAVE_KEY) ?? null
  } catch {
    return null
  }
  if (text === null) return null
  try {
    const raw: unknown = JSON.parse(text)
    if (isObj(raw) && raw.version === 1) {
      const r = replay(raw)
      if (r) return r
    }
  } catch {
    /* fall through */
  }
  noticeOnce(RESTORE_FAILED)
  return null
}

let timer: ReturnType<typeof setTimeout> | undefined
let queued: { history: History; paper: PaperSettings } | null = null

function write(): void {
  timer = undefined
  const q = queued
  queued = null
  if (!q) return
  const steps: Step[] = q.history.steps
  try {
    globalThis.localStorage.setItem(
      AUTOSAVE_KEY,
      JSON.stringify({ version: 1, paper: q.paper, steps, cursor: q.history.cursor }),
    )
  } catch {
    noticeOnce(AUTOSAVE_OFF) // quota / private mode: the app keeps working in memory
  }
}

/** Queue a save (debounced 500 ms; the latest state wins). */
export function saveHistory(history: History, paper: PaperSettings): void {
  queued = { history, paper }
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(write, SAVE_DEBOUNCE_MS)
}

/** Write any queued save now (pagehide / tab hidden). */
export function flushSave(): void {
  if (timer !== undefined) clearTimeout(timer)
  write()
}

/** Tests: drop any queued save without writing. */
export function cancelSave(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  queued = null
}
