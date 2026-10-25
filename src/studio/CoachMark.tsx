// The first-visit coach mark (spec 03 "Empty state and onboarding": a single
// dismissible coach mark points at a corner, then never shows again; R55).
//
// A small note anchored to the sheet's top-right corner (it follows the camera
// framing), with "Got it". Dismissed for good by the button or by the first
// fold (a model with steps), persisted in localStorage under COACH_KEY; when
// storage is blocked it is dismissed for the session only. Hidden (not
// dismissed) while a fold gesture or a restore is in progress. The corner ring
// pulses gently unless motion is reduced. No modal tour.
import { useEffect, useLayoutEffect, useState } from 'react'
import { current } from '@engine'
import type { Vec2 } from '@engine'
import { useStudio } from './store'

export const COACH_KEY = 'ori.coach.v1'
export const COACH_TEXT = 'Start here: grab this corner and fold it across.'

/** What the coach mark needs from the Stage: where a paper point is on screen. */
export type CoachStage = { clientOf(p: Vec2): Vec2 }

let dismissedThisSession = false

function isDismissed(): boolean {
  if (dismissedThisSession) return true
  try {
    return globalThis.localStorage?.getItem(COACH_KEY) === '1'
  } catch {
    return false
  }
}

function dismissForGood(): void {
  dismissedThisSession = true
  try {
    globalThis.localStorage?.setItem(COACH_KEY, '1')
  } catch {
    /* private mode: once per session */
  }
}

/** Tests: forget a session-only dismissal. */
export function resetCoachForTests(): void {
  dismissedThisSession = false
}

/** The blank sheet's top-right corner (paper units). */
function cornerOf(): Vec2 {
  const coords = current(useStudio.getState().history).vertices_coords
  let x = 0
  let y = 0
  for (const p of coords) {
    if (p[0] > x) x = p[0]
    if (p[1] > y) y = p[1]
  }
  return [x || 1, y || 1]
}

export function CoachMark({ stage, reduced }: { stage: CoachStage | null; reduced: boolean }) {
  const [dismissed, setDismissed] = useState(isDismissed)
  const hasSteps = useStudio(s => s.history.steps.length > 0)
  const busy = useStudio(s => s.gesture !== null || s.restoring)
  const [at, setAt] = useState<Vec2 | null>(null)

  // The first fold (or a restored model) ends onboarding for good.
  useEffect(() => {
    if (hasSteps && !dismissed) {
      dismissForGood()
      setDismissed(true)
    }
  }, [hasSteps, dismissed])

  const shown = !dismissed && !hasSteps && stage !== null
  // Follow the corner as the camera frames and the window resizes.
  useLayoutEffect(() => {
    if (!shown || !stage) return
    const place = () => {
      const p = stage.clientOf(cornerOf())
      setAt(prev => (prev && prev[0] === p[0] && prev[1] === p[1] ? prev : p))
    }
    place()
    let raf = 0
    const loop = () => {
      place()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [shown, stage])

  if (!shown || busy || !at) return null
  return (
    <div className="coach" data-motion={reduced ? undefined : ''} style={{ left: `${at[0]}px`, top: `${at[1]}px` }}>
      <span className="coach-ring" aria-hidden="true" />
      <div className="coach-bubble" role="note" aria-label="Tip">
        <p>{COACH_TEXT}</p>
        <button
          type="button"
          className="tbtn text"
          onClick={() => {
            dismissForGood()
            setDismissed(true)
          }}
        >
          Got it
        </button>
      </div>
    </div>
  )
}
