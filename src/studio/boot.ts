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
import { createWorkerRestorer, inProcessRestorer, type Restorer } from './committer'
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
}

function defaultRestorer(): { restore: Restorer; dispose(): void } {
  if (typeof Worker !== 'function') return { restore: inProcessRestorer, dispose() {} }
  const r = createWorkerRestorer()
  return { restore: r, dispose: r.dispose }
}

/** Every change to the model or the paper queues a debounced save; flush when the page hides. */
function startAutosave(store: Store): void {
  teardown.push(store.subscribe((s, prev) => {
    if (s.history !== prev.history || s.paper !== prev.paper) saveHistory(s.history, s.paper)
  }))
  const onHide = () => {
    if (document.visibilityState === 'hidden') flushSave()
  }
  addEventListener('pagehide', flushSave)
  document.addEventListener('visibilitychange', onHide)
  teardown.push(() => {
    removeEventListener('pagehide', flushSave)
    document.removeEventListener('visibilitychange', onHide)
  })
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
  const saved = readSave()
  if (!saved) {
    if (store.getState().history.steps.length === 0) store.getState().newSheet()
    startAutosave(store)
    const p = Promise.resolve()
    booted.set(store, p)
    return p
  }
  const base = store.getState().history
  const worker = opts.restorer ? { restore: opts.restorer, dispose() {} } : defaultRestorer()
  restoring.add(store)
  store.setState({ pending: true, restoring: true })
  const p = worker
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
      startAutosave(store)
      // The user started over while the save was replaying: that is what to keep.
      if (moved) saveHistory(store.getState().history, store.getState().paper)
    })
  booted.set(store, p)
  return p
}
