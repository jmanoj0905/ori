// Draws Player views on the Stage (R61, R62). Shared by the ReplayBar and the
// recorder (Task 5), so a recording looks exactly like the replay.
//
// frames[n] goes in through setFrame (rebuilt only when the frame object
// changes: Player caches poses per frame), and the fold in progress through
// setPreview with the `solid` style, so it reads as the paper folding, not the
// translucent ghost of a live drag. With auto-frame on, the camera re-frames
// to the model whenever the committed frame changes (once per step, eased
// unless `animate()` is false) rather than every frame, so the view does not
// pump while a flap swings.
import type { FacePose, Frame, Preview } from '@engine'
import type { PreviewStyle } from '../../render/Stage'
import type { ReplayView } from './Player'

/** The part of the Stage a replay draws on. */
export interface ReplayStage {
  setFrame(frame: Frame, poses: FacePose[]): void
  setPreview(p: Preview | null, style?: PreviewStyle): void
  fitModel(animate: boolean): void
}

export function drawView(stage: ReplayStage, animate: () => boolean): (v: ReplayView) => void {
  let frame: Frame | null = null
  let swing: Preview | null | undefined
  let framed = false
  return v => {
    const changed = v.frame !== frame
    frame = v.frame
    stage.setFrame(v.frame, v.poses)
    if (v.swing || swing !== null) {
      stage.setPreview(v.swing, v.swing ? { kind: v.style.kind, tool: v.style.tool, progress: 1, solid: true } : {})
    }
    swing = v.swing
    if (v.autoFrame && (changed || !framed)) stage.fitModel(animate())
    framed = v.autoFrame
  }
}
