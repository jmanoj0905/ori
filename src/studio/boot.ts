// Start-up order matters: the autosave restore runs FIRST; only when nothing
// was restored does the studio seed a blank sheet from the paper defaults
// (otherwise the seed would replace the restored model). Autosave subscribes
// after that, so the boot itself never overwrites a save it failed to read.
// Restore and subscription happen once per store (React StrictMode runs effects twice).
//
// Bounded restore (R52): the save is read and validated here (cheap; at most
// MAX_RESTORE_STEPS steps), then replayed by the restorer — the engine Worker
// in the app, with a timeout — while the store is `pending` + `restoring`
// (fold input waits; the hint line says so after a moment). Undo / redo /
// new sheet / presets stay live as during any commit: if the history moved
// meanwhile, the restored model is dropped and the user's choice is saved. A
// restore that fails (a step does not replay, the worker dies or times out)
// shows RESTORE_FAILED once and opens a blank sheet.
import { flushSave, readSave, saveHistory } from '../persistence/autosave'
import { RESTORE_FAILED, noticeOnce } from '../persistence/notice'
import { isShareHash, openFromHash } from '../persistence/openFromHash'
import { askReplace } from './openPrompt'
import { createWorkerRestorer, inProcessRestorer, type Restorer } from './committer'
import type { History } from '@engine'
import type { SavedModel } from '../persistence/replay'
import type { useStudio } from './store'

type Store = typeof useStudio
let booted = new WeakMap<object, Promise<void>>()
let restoring = new WeakSet<object>()
let teardown: (() => void)[] = []

/** Tests: forget that any store booted and drop its subscription and listeners. */
export function resetBootForTests(): void {
  teardown.forEach(f => f())
  teardown = []
  booted = new WeakMap()
  restoring = new WeakSet()
}

export type BootOptions = {
  /** Replays the save. Default: a Worker restorer where Workers exist, else in-process. */
  restorer?: Restorer
  /** Asks "Replace your current model?" when a share link meets autosaved work. Default: the in-app dialog. */
  confirm?: () => Promise<boolean>
}

function defaultRestorer(): { restore: Restorer; dispose(): void } {
  if (typeof Worker !== 'function') return { restore: inProcessRestorer, dispose() {} }
  const r = createWorkerRestorer()
  return { restore: r, dispose: r.dispose }
}

/** Every change to the model or the paper queues a debounced save; flush when the page hides. */
function startAutosave(store: Store, opts: BootOptions = {}): void {
  teardown.push(store.subscribe((s, prev) => {
    if (s.history !== prev.history || s.paper !== prev.paper) saveHistory(s.history, s.paper)
  }))
  const onHide = () => {
    if (document.visibilityState === 'hidden') flushSave()
  }
  startShareListener(store, opts)
  addEventListener('pagehide', flushSave)
  document.addEventListener('visibilitychange', onHide)
  teardown.push(() => {
    removeEventListener('pagehide', flushSave)
    document.removeEventListener('visibilitychange', onHide)
  })
}

/**
 * A share link pasted into an open tab changes only the hash (no reload), so
 * listen for it: ask if there is work, replay, replace, save, clear the hash.
 * Our own clearHash uses replaceState (no hashchange); a non-share hash is ignored.
 */
function startShareListener(store: Store, opts: BootOptions): void {
  const untouchedPaper = store.getState().paper
  let opening = false
  const onHash = async () => {
    const hash = location.hash
    if (!isShareHash(hash) || opening || restoring.has(store)) return
    opening = true
    const worker = opts.restorer ? { restore: opts.restorer, dispose() {} } : defaultRestorer()
    try {
      store.getState().cancel() // a live gesture or keyboard fold ends; preset playback stops when the history moves
      const s = store.getState()
      const r = await openFromHash(hash, {
        hasWork: s.history.steps.length > 0 || s.paper !== untouchedPaper,
        confirm: opts.confirm ?? askReplace,
        onReplaying: async () => {
          for (let i = 0; i < 400 && store.getState().pending; i++) await new Promise(res => setTimeout(res, 5))
          store.setState({ pending: true, restoring: true })
        },
        restore: worker.restore,
      }).catch(() => ({ kind: 'kept' as const }))
      store.setState({ pending: false, restoring: false })
      if (r.kind === 'opened') {
        store.getState().restoreHistory(r.restored.history)
        store.getState().setPaper(r.restored.paper)
        saveHistory(store.getState().history, store.getState().paper)
      }
    } finally {
      worker.dispose()
      opening = false
    }
  }
  const listener = () => void onHash()
  addEventListener('hashchange', listener)
  teardown.push(() => removeEventListener('hashchange', listener))
}

/** Restore the autosave (or seed a blank sheet), then start autosaving. Resolves when the restore has landed. */
export function bootStudio(store: Store, opts: BootOptions = {}): Promise<void> {
  const done = booted.get(store)
  if (done) {
    // A remount (StrictMode, tests): never restore or subscribe twice, but an
    // empty studio still opens on the paper defaults (not mid-restore: the seed
    // would count as the user moving the history and drop the restore).
    if (!restoring.has(store) && store.getState().history.steps.length === 0) store.getState().newSheet()
    return done
  }
  const hash = typeof location === 'undefined' ? '' : location.hash
  const share = isShareHash(hash)
  const saved = readSave()
  const worker = opts.restorer ? { restore: opts.restorer, dispose() {} } : defaultRestorer()
  const base = store.getState().history
  if (share) {
    // R59: the link takes precedence. Fold input waits while it decodes, is
    // confirmed and replays; any outcome other than "opened" carries on below.
    restoring.add(store)
    store.setState({ pending: true })
    const p = openFromHash(hash, {
      hasWork: saved !== null && saved.steps.length > 0,
      confirm: opts.confirm ?? askReplace,
      onReplaying: () => void store.setState({ restoring: true }),
      restore: worker.restore,
    })
      .catch(() => ({ kind: 'kept' as const }))
      .then(async r => {
        if (r.kind === 'opened') {
          worker.dispose()
          restoring.delete(store)
          store.setState({ pending: false, restoring: false })
          if (store.getState().history === base) {
            store.getState().restoreHistory(r.restored.history)
            store.getState().setPaper(r.restored.paper)
          }
          startAutosave(store, opts)
          saveHistory(store.getState().history, store.getState().paper) // the opened model is now the autosave
          return
        }
        restoring.delete(store)
        store.setState({ pending: false, restoring: false })
        await restoreOrSeed(store, saved, base, worker, opts)
      })
    booted.set(store, p)
    return p
  }
  const p = restoreOrSeed(store, saved, base, worker, opts)
  booted.set(store, p)
  return p
}

/** The normal start: replay the save (in the worker), or seed a blank sheet when there is none. */
function restoreOrSeed(store: Store, saved: SavedModel | null, base: History, worker: { restore: Restorer; dispose(): void }, opts: BootOptions): Promise<void> {
  if (!saved) {
    worker.dispose()
    if (store.getState().history.steps.length === 0) store.getState().newSheet()
    startAutosave(store, opts)
    return Promise.resolve()
  }
  restoring.add(store)
  store.setState({ pending: true, restoring: true })
  return worker
    .restore(saved)
    .catch(() => null)
    .then(r => {
      worker.dispose()
      restoring.delete(store)
      const moved = store.getState().history !== base
      store.setState({ pending: false, restoring: false })
      if (!r) noticeOnce(RESTORE_FAILED)
      if (!moved) {
        if (r) {
          store.getState().restoreHistory(r.history)
          store.getState().setPaper(r.paper)
        } else store.getState().newSheet()
      }
      startAutosave(store, opts)
      // The user started over while the save was replaying: that is what to keep.
      if (moved) saveHistory(store.getState().history, store.getState().paper)
    })
}
