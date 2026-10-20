// Presets: classic models as data, and the player that folds them through
// the public engine API (the same calls the UI makes for a user's gesture).
import { PAPER_SIZES, commit, createPaper, current, push, startHistory, turnOver } from '@engine'
import type { History, Result } from '@engine'
import { crane } from './crane'
import { cup } from './cup'
import { plane } from './plane'
import type { Preset } from './types'

export type { Preset, PresetStep, TurnOverStep } from './types'

export const PRESETS: Preset[] = [plane, cup, crane]

/**
 * Fold a preset from a blank sheet: each step is committed (or the model
 * turned over) on the current frame and pushed onto the history. The first
 * refusal stops it, its reason prefixed with the 1-based step number
 * ("Step 4: That crease misses the paper.").
 */
export function runPreset(p: Preset): Result<{ history: History }> {
  let history = startHistory(createPaper(PAPER_SIZES[p.paper]))
  for (const [i, s] of p.steps.entries()) {
    const r = s.tool === 'turnOver' ? turnOver(current(history)) : commit(current(history), s)
    if (!r.ok) return { ok: false, reason: `Step ${i + 1}: ${r.reason}` }
    history = push(history, r.step, r.frame)
  }
  return { ok: true, history }
}
