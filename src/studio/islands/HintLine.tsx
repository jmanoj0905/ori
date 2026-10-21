// The quiet sentence at the bottom. Precedence: an engine refusal, then the
// blocked-fold warning, then the active tool's one-sentence explanation.
import type { Tool } from '@engine'
import { useStudio } from '../store'

export const BLOCKED_HINT = 'Flap would pass through paper.'

export const TOOL_HINTS: Record<Tool, string> = {
  fold: 'Drag a corner or an edge across the paper to fold it.',
  reverse: 'Drag a flap that is folded in half: into itself for an inside reverse fold, around it for an outside one.',
  squash: 'Grab a flap and drag it down and open to flatten it symmetrically.',
  petal: 'Grab the lower point of a flap and lift it.',
}

export function HintLine() {
  const refusal = useStudio(s => s.refusal)
  const blocked = useStudio(s => s.preview?.blocked === true)
  const tool = useStudio(s => s.tool)
  const start = useStudio(s => s.history.steps.length === 0)
  const startHint = useStudio(s => s.hint)
  const text = refusal ?? (blocked ? BLOCKED_HINT : tool === 'fold' && start ? startHint : TOOL_HINTS[tool])
  return (
    <p className="hint" role="status" aria-live="polite" data-refusal={refusal ? '' : undefined} data-blocked={!refusal && blocked ? '' : undefined}>
      {text}
    </p>
  )
}
