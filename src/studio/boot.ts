// Start-up order matters: the autosave restore runs FIRST; only when nothing
// was restored does the studio seed a blank sheet from the paper defaults
// (otherwise the seed would replace the restored model). Autosave subscribes
// after that, so the boot itself never overwrites a save it failed to read.
// Restore and subscription happen once per store (React StrictMode runs effects twice).
import { loadHistory, flushSave, saveHistory } from '../persistence/autosave'
import type { useStudio } from './store'

type Store = typeof useStudio
let booted = new WeakSet<object>()
let teardown: (() => void)[] = []

/** Tests: forget that any store booted and drop its subscription and listeners. */
export function resetBootForTests(): void {
  teardown.forEach(f => f())
  teardown = []
  booted = new WeakSet()
}

export function bootStudio(store: Store): void {
  if (booted.has(store)) {
    // A remount (StrictMode, tests): never restore or subscribe twice, but an
    // empty studio still opens on the paper defaults.
    if (store.getState().history.steps.length === 0) store.getState().newSheet()
    return
  }
  booted.add(store)
  const restored = loadHistory()
  if (restored) {
    store.getState().restoreHistory(restored.history)
    store.getState().setPaper(restored.paper)
  } else if (store.getState().history.steps.length === 0) {
    store.getState().newSheet()
  }
  // Every change to the model or the paper (commit, undo, redo, jumpTo, R28
  // replacement, turnOver, newSheet, paper edits) queues a debounced save.
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
