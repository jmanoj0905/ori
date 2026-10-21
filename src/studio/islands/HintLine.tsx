// The quiet sentence at the bottom. Precedence: an engine refusal, then the
// blocked-fold warning, the keyboard-fold prompt, then the active tool's
// one-sentence explanation. It is a status line but not a live region of its
// own (aria-live off): the visually hidden LiveLog announces refusals and the
// blocked warning, so a screen reader hears each once.
import type { Tool } from '@engine'
import { useStudio } from '../store'
import { useUi } from '../ui'

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

export function HintLine() {
  const kf = useUi(s => s.kf)
  const refusal = useStudio(s => s.refusal)
  const blocked = useStudio(s => s.preview?.blocked === true)
  const tool = useStudio(s => s.tool)
  const start = useStudio(s => s.history.steps.length === 0)
  const startHint = useStudio(s => s.hint)
  const text =
    refusal ?? (blocked ? BLOCKED_HINT : kf !== 'idle' ? KEYBOARD_HINTS[kf] : tool === 'fold' && start ? startHint : TOOL_HINTS[tool])
  return (
    <p className="hint" role="status" aria-live="off" data-refusal={refusal ? '' : undefined} data-blocked={!refusal && blocked ? '' : undefined}>
      {text}
    </p>
  )
}
