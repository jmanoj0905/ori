// The quiet sentence at the bottom. Precedence: a slow commit / restore
// ("Folding…" after BUSY_AFTER_MS, R52), an engine refusal, then the
// blocked-fold warning, the keyboard-fold prompt, then the active tool's
// one-sentence explanation. It is a status line but not a live region of its
// own (aria-live off): the visually hidden LiveLog announces refusals and the
// blocked warning, so a screen reader hears each once.
import { useEffect, useState } from 'react'
import type { Tool } from '@engine'
import { useStudio } from '../store'
import { stageDown, useUi } from '../ui'
import { announce } from '../announce'

/** A commit or restore pending this long shows FOLDING / RESTORING (R52): quick ones never flash. */
export const BUSY_AFTER_MS = 300
export const FOLDING = 'Folding…'
export const RESTORING = 'Opening your last model…'

export const BLOCKED_HINT = 'Flap would pass through paper.'

export const TOOL_HINTS: Record<Tool, string> = {
  fold: 'Drag a corner or an edge across the paper to fold it.',
  reverse: 'Drag a flap that is folded in half: into itself for an inside reverse fold, around it for an outside one.',
  squash: 'Grab a flap and drag it down and open to flatten it symmetrically.',
  petal: 'Grab the lower point of a flap and lift it.',
}

export const KEYBOARD_HINTS = {
  grab: 'Keyboard fold: arrows or Tab choose a grab point, Enter grabs, Esc stops.',
  target: 'Choose where to fold to. Enter commits, [ ] layers, V M fold type, + − angle, Esc cancels.',
} as const

/** True once `on` has held for `ms` (false again as soon as it drops). */
function useHeldFor(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!on) {
      setHeld(false)
      return
    }
    const t = setTimeout(() => setHeld(true), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return on && held
}

export function HintLine() {
  const pending = useStudio(s => s.pending)
  const restoring = useStudio(s => s.restoring)
  const busy = useHeldFor(pending, BUSY_AFTER_MS)
  // The hint is not a live region: say a slow wait once through the fold log.
  useEffect(() => {
    if (busy) announce(useStudio.getState().restoring ? RESTORING : FOLDING)
  }, [busy])
  const kf = useUi(s => s.kf)
  const stage = useUi(s => s.stage)
  const refusal = useStudio(s => s.refusal)
  const blocked = useStudio(s => s.preview?.blocked === true)
  const tool = useStudio(s => s.tool)
  const start = useStudio(s => s.history.steps.length === 0)
  const startHint = useStudio(s => s.hint)
  // The 3D view is unavailable: the stage message (App) says why; no folding hint.
  if (stageDown(stage)) return null
  const text = busy ? (restoring ? RESTORING : FOLDING) :
    refusal ?? (blocked ? BLOCKED_HINT : kf !== 'idle' ? KEYBOARD_HINTS[kf] : tool === 'fold' && start ? startHint : TOOL_HINTS[tool])
  return (
    <p className="hint" role="status" aria-live="off" data-refusal={refusal ? '' : undefined} data-blocked={!busy && !refusal && blocked ? '' : undefined} data-busy={busy ? '' : undefined} aria-busy={busy || undefined}>
      {text}
    </p>
  )
}
