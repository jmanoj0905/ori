// Autosave (spec 05 phase 1, R29). Stores the step records, the cursor and the
// paper settings (never geometry) under `ori.autosave.v1`:
//   { version: 1, paper, steps, cursor }
// Redo entries are part of `steps`; `cursor` says how many are applied.
//
// Restore (R52) is bounded: `readSave` reads and validates the payload on the
// main thread (cheap: JSON plus shape checks, at most MAX_RESTORE_STEPS steps),
// and the replay itself (`replaySave`, persistence/replay.ts) runs through the
// engine Worker at boot (studio/boot.ts), behind a light loading state, with a
// timeout. `loadHistory` is the synchronous read + replay, for tests and tools.
// An unusable save (bad JSON, unknown version, too many steps, a step that does
// not replay) shows RESTORE_FAILED once; an absent save or unreadable storage
// is silent.
import type { History, Step } from '@engine'
import type { PaperSettings } from '../paper'
import { AUTOSAVE_OFF, RESTORE_FAILED, noticeOnce } from './notice'
import { parseSave, replaySave, type Restored, type SavedModel } from './replay'

export { MAX_RESTORE_STEPS, type Restored, type SavedModel } from './replay'

export const AUTOSAVE_KEY = 'ori.autosave.v1'
export const SAVE_DEBOUNCE_MS = 500

/**
 * The saved model, validated and ready to replay; null when nothing is saved,
 * storage is unreadable (silent) or the save is unusable (RESTORE_FAILED once).
 */
export function readSave(): SavedModel | null {
  let text: string | null
  try {
    text = globalThis.localStorage?.getItem(AUTOSAVE_KEY) ?? null
  } catch {
    return null
  }
  if (text === null) return null
  let saved: SavedModel | null = null
  try {
    saved = parseSave(JSON.parse(text))
  } catch {
    /* bad JSON: fall through */
  }
  if (!saved) noticeOnce(RESTORE_FAILED)
  return saved
}

/** Restore the autosaved model synchronously (read + replay on this thread), or null. */
export function loadHistory(): Restored | null {
  const saved = readSave()
  if (!saved) return null
  let r: Restored | null = null
  try {
    r = replaySave(saved)
  } catch {
    /* an engine throw is a corrupt save */
  }
  if (!r) noticeOnce(RESTORE_FAILED)
  return r
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
