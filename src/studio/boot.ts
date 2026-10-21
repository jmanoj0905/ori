// Start-up order matters: the autosave restore runs FIRST; only when nothing
// was restored does the studio seed a blank sheet from the paper defaults
// (otherwise the seed would replace the restored model). Autosave subscribes
// after that, so the boot itself never overwrites a save it failed to read.
// Restore and subscription happen once per store (React StrictMode runs effects twice).
import { loadHistory, flushSave, saveHistory } from '../persistence/autosave'
import type { useStudio } from './store'

type Store = typeof useStudio
const booted = new WeakSet<object>()

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
  store.subscribe((s, prev) => {
    if (s.history !== prev.history || s.paper !== prev.paper) saveHistory(s.history, s.paper)
  })
  addEventListener('pagehide', flushSave)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave()
  })
}
