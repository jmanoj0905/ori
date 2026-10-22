// Opening a share link (spec 05 "Share link", ruling R59). React-free: boot
// calls this with a confirm callback and a restorer, so the studio decides how
// to ask and where the replay runs (the engine Worker in the app).
//
// A hash that starts with `#v` is a share link and takes precedence over the
// autosave. The codec (and fflate) load on demand (R58), so a normal start
// never fetches them. A link that cannot be decoded, or whose steps the engine
// refuses, toasts and leaves everything as it was (never overwriting the
// autosave). The hash is always removed afterwards so a reload does not ask again.
import { notify } from './notice'
import { MAX_RESTORE_STEPS, replayStepOf, type ReplayStep, type Restored, type SavedModel } from './replay'

export const DAMAGED_LINK = 'This link is damaged.'
export const REPLACE_TITLE = 'Replace your current model?'
export const REPLACE_MESSAGE = 'This link carries a model. Opening it replaces the model you were working on.'

export type OpenDeps = {
  /** Is there autosaved work the link would replace? */
  hasWork: boolean
  /** Ask whether to replace it; resolves true to replace. */
  confirm(): Promise<boolean>
  /** Replay the decoded steps (a Worker in the app). Null when a step does not replay. */
  restore(saved: SavedModel): Promise<Restored | null>
}

/** 'none': not a share link. 'kept': carry on with the autosave. 'opened': the shared model. */
export type OpenResult = { kind: 'none' } | { kind: 'kept' } | { kind: 'opened'; restored: Restored }

export const isShareHash = (hash: string): boolean => hash.startsWith('#v')

/** Drop the hash (keeping path and query) without adding a history entry. */
export function clearHash(): void {
  try {
    history.replaceState(history.state, '', location.pathname + location.search)
  } catch {
    /* sandboxed frames may refuse: harmless */
  }
}

export async function openFromHash(hash: string, deps: OpenDeps): Promise<OpenResult> {
  if (!isShareHash(hash)) return { kind: 'none' }
  try {
    let decoded
    try {
      decoded = (await import('./shareCodec')).decodeShare(hash)
    } catch {
      notify(DAMAGED_LINK) // the codec chunk failed to load (offline)
      return { kind: 'kept' }
    }
    if (!decoded.ok) {
      notify(decoded.reason)
      return { kind: 'kept' }
    }
    const steps: ReplayStep[] = []
    for (const s of decoded.steps) {
      const r = replayStepOf(s)
      if (!r) {
        notify(DAMAGED_LINK)
        return { kind: 'kept' }
      }
      steps.push(r)
    }
    if (steps.length > MAX_RESTORE_STEPS) {
      notify(DAMAGED_LINK)
      return { kind: 'kept' }
    }
    if (deps.hasWork && !(await deps.confirm())) return { kind: 'kept' }
    const restored = await deps.restore({ paper: decoded.paper, steps, cursor: steps.length }).catch(() => null)
    if (!restored) {
      notify(DAMAGED_LINK)
      return { kind: 'kept' }
    }
    return { kind: 'opened', restored }
  } finally {
    clearHash()
  }
}
