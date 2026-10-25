// The screen-reader step log (spec 04 section 3): a polite ARIA live region
// that announces each committed or refused fold, undo / redo, and a blocked
// preview. It is visually hidden; the visible mirror is the Steps list and the
// hint line. `announce` is re-exported for code that wants to write to it.
import { useEffect } from 'react'
import { useStudio } from './store'
import { announce, stepSentence, useAnnouncements } from './announce'
import { BLOCKED_HINT } from './islands/HintLine'

export { announce } from './announce'

/** Words the change between two history snapshots, or null for "nothing worth saying". */
function historyWords(a: ReturnType<typeof useStudio.getState>['history'], b: typeof a): string | null {
  if (a === b) return null
  if (a.steps !== b.steps) {
    // A step was pushed (or the last one re-committed), or the sheet was replaced.
    if (a.steps.length === 0) return 'New blank sheet.'
    if (a.cursor === 0) return `Jumped to the blank sheet.`
    // restoreHistory (toast Undo) reuses an earlier snapshot: its cursor sits on an older step.
    return stepSentence(a.steps[a.cursor - 1]!, a.cursor)
  }
  if (a.cursor === b.cursor) return null
  const where = a.cursor === 0 ? 'the blank sheet' : `step ${a.cursor}`
  if (a.cursor === b.cursor - 1) return a.cursor === 0 ? 'Undone. Back to the blank sheet.' : `Undone. Now at ${where}.`
  if (a.cursor === b.cursor + 1) return `Redone. Now at ${where}.`
  return `Jumped to ${where}.`
}

export function LiveLog() {
  const items = useAnnouncements(s => s.items)
  useEffect(
    () =>
      useStudio.subscribe((s, prev) => {
        const words = historyWords(s.history, prev.history)
        if (words) announce(words)
        if (s.refusal && s.refusal !== prev.refusal) announce(s.refusal)
        if (s.preview?.blocked && !prev.preview?.blocked) announce(BLOCKED_HINT)
      }),
    [],
  )
  return (
    <div className="sr-only" role="log" aria-live="polite" aria-relevant="additions" aria-label="Fold log">
      {items.map(i => (
        <p key={i.id}>{i.text}</p>
      ))}
    </div>
  )
}
