// The soft-paper controls in the Tools island (spec 08; Plan 6 Task 4): Soft
// paper on / off, Wet, and — when the model has curved creases — a Curve
// fold slider. Shown only when Settings → Soft paper is on. Without WebGPU
// the controls are hidden; a short note says why (its tooltip has the
// details), and the rest of the app is unaffected.
import { useSettings } from '../settings/store'
import { useStudio } from './store'
import { NO_WEBGPU, NOT_IN_LESSON, hasWebGPU, useSoftUi } from './softUi'

export type SoftModeToggleProps = {
  /** Whether WebGPU is available (detected by default). */
  gpu?: boolean
  onToggle?: (on: boolean) => void
  onWet?: (on: boolean) => void
  onCurve?: (deg: number) => void
}

export function SoftModeToggle({ gpu = hasWebGPU(), onToggle, onWet, onCurve }: SoftModeToggleProps) {
  const enabled = useSettings(s => s.softPaper)
  const { active, busy, wet, curves, curveDeg, solver, message } = useSoftUi()
  const inLesson = useStudio(s => s.lesson !== null)
  if (!enabled) return null
  if (!gpu) {
    return (
      <p className="soft-unavailable" role="note" title={NO_WEBGPU} aria-label={NO_WEBGPU}>
        Soft paper unavailable
      </p>
    )
  }
  return (
    <div role="group" aria-label="Soft paper" className="stack soft">
      <span className="group-label" aria-hidden="true">Soft</span>
      <button
        type="button"
        className="tool"
        aria-pressed={active}
        disabled={busy || !onToggle || (inLesson && !active)}
        title={inLesson && !active ? NOT_IN_LESSON : 'Soft paper: the sheet bends and settles; leaving keeps exact folds or a sculpted step'}
        onClick={() => onToggle?.(!active)}
      >
        Soft paper
      </button>
      <button
        type="button"
        className="tool"
        aria-pressed={wet}
        disabled={!active || busy}
        title="Wet folding: softer paper you can sculpt; it dries in place when you let go"
        onClick={() => onWet?.(!wet)}
      >
        Wet
      </button>
      {active && curves > 0 && (
        <label className="soft-curve">
          <span>Curve fold</span>
          <input type="range" min={0} max={60} step={1} value={curveDeg} aria-label="Curve fold" aria-valuetext={`${curveDeg}°`} onChange={e => onCurve?.(Number(e.target.value))} />
        </label>
      )}
      {active && solver === 'cpu' && <span className="soft-note" role="status">CPU fallback</span>}
      {message && <span className="soft-note" role="status">{message}</span>}
    </div>
  )
}
