// The fold bar: Valley / Mountain, the angle slider, the layer badge and the
// crease readout (click it to type exact values). It shows while a gesture is
// active and, after release, for the last fold until the next fold begins.
//   - during a gesture the slider sets the live preview angle (Gesture.angleDeg);
//   - after release it re-commits the last step at the new angle (R28), see
//     the store's setLastFold.
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { current, layerAt } from '@engine'
import type { FoldKind, Line, Vec2 } from '@engine'
import { lastFold, useStudio } from '../store'

const COARSE = '(pointer: coarse)'
const coarseQuery = () => (typeof matchMedia === 'function' ? matchMedia(COARSE) : null)
const subscribeCoarse = (cb: () => void) => {
  const q = coarseQuery()
  q?.addEventListener?.('change', cb)
  return () => q?.removeEventListener?.('change', cb)
}
/** True on touch-first devices, where the layer stepper replaces the scroll wheel. */
export const useCoarsePointer = (): boolean => useSyncExternalStore(subscribeCoarse, () => coarseQuery()?.matches === true, () => false)

const fmt = (n: number) => (Math.abs(n) < 0.0005 ? 0 : n).toFixed(2)

/** A crease line as a point on it and its direction in degrees, [0, 180). */
function describe(line: Line): { origin: Vec2; deg: number } {
  let deg = (Math.atan2(line.vector[1], line.vector[0]) * 180) / Math.PI
  deg = ((deg % 180) + 180) % 180
  return { origin: line.origin, deg }
}

const lineOf = (a: Vec2, b: Vec2): Line => ({ origin: a, vector: [b[0] - a[0], b[1] - a[1]] })

function NumericForm({
  crease, angle, canAngle, onApply, onClose,
}: {
  crease: Line | null
  angle: number
  canAngle: boolean
  onApply(e: { crease: Line; angleDeg?: number }): void
  onClose(): void
}) {
  const id = useId()
  const d = crease ? describe(crease) : { origin: [0.5, 0.5] as Vec2, deg: 90 }
  const [mode, setMode] = useState<'points' | 'angle'>('points')
  const [v, setV] = useState({
    x1: fmt(d.origin[0]), y1: fmt(d.origin[1]),
    x2: fmt(crease ? d.origin[0] + crease.vector[0] / Math.hypot(...crease.vector) * 0.5 : 0.5),
    y2: fmt(crease ? d.origin[1] + crease.vector[1] / Math.hypot(...crease.vector) * 0.5 : 1),
    deg: fmt(d.deg), fold: String(Math.round(angle)),
  })
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const n = (s: string) => (s.trim() === '' ? NaN : Number(s))
    const p1: Vec2 = [n(v.x1), n(v.y1)]
    let line: Line
    if (mode === 'points') {
      const p2: Vec2 = [n(v.x2), n(v.y2)]
      if (![...p1, ...p2].every(Number.isFinite)) return setError('Enter all four coordinates.')
      if (p1[0] === p2[0] && p1[1] === p2[1]) return setError('The two points must differ.')
      line = lineOf(p1, p2)
    } else {
      const deg = n(v.deg)
      if (![...p1, deg].every(Number.isFinite)) return setError('Enter a point and an angle.')
      const r = (deg * Math.PI) / 180
      line = { origin: p1, vector: [Math.cos(r), Math.sin(r)] }
    }
    let angleDeg: number | undefined
    if (canAngle) {
      angleDeg = n(v.fold)
      if (!Number.isFinite(angleDeg) || angleDeg < 0 || angleDeg > 180) return setError('The fold angle must be between 0° and 180°.')
    }
    setError(null)
    onApply(angleDeg === undefined ? { crease: line } : { crease: line, angleDeg })
  }

  const field = (k: keyof typeof v, label: string, ref?: React.Ref<HTMLInputElement>) => (
    <label className="nfield">
      <span>{label}</span>
      <input ref={ref} type="number" step="any" inputMode="decimal" value={v[k]} onChange={set(k)} />
    </label>
  )

  return (
    <form
      className="numeric"
      aria-label="Exact crease"
      onSubmit={submit}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div role="group" aria-label="Define the crease by" className="seg">
        {(['points', 'angle'] as const).map(m => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            id={`${id}-${m}`}
            onClick={() => setMode(m)}
          >
            {m === 'points' ? 'Two points' : 'Point + angle'}
          </button>
        ))}
      </div>
      <div className="nrow">
        {field('x1', 'x', first)}
        {field('y1', 'y')}
        {mode === 'points' ? (
          <>
            {field('x2', 'x₂')}
            {field('y2', 'y₂')}
          </>
        ) : (
          field('deg', 'crease °')
        )}
        {canAngle && field('fold', 'fold °')}
      </div>
      {error && <p className="nerror" role="alert">{error}</p>}
      <div className="nactions">
        <button type="submit" className="tbtn text primary">Apply</button>
        <button type="button" className="tbtn text" onClick={onClose}>Close</button>
      </div>
    </form>
  )
}

export function FoldBar() {
  const gesture = useStudio(s => s.gesture)
  const preview = useStudio(s => s.preview)
  const history = useStudio(s => s.history)
  const kind = useStudio(s => s.kind)
  const pending = useStudio(s => s.pending)
  const setKind = useStudio(s => s.setKind)
  const setLayers = useStudio(s => s.setLayers)
  const setNumeric = useStudio(s => s.setNumeric)
  const setLastFold = useStudio(s => s.setLastFold)
  const last = useMemo(() => lastFold(history), [history])
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<number | null>(null)
  const readout = useRef<HTMLButtonElement>(null)
  const sliderId = useId()
  const coarse = useCoarsePointer()

  // The fold the bar describes: the live gesture, else the last committed fold.
  const live = gesture !== null
  const subject = live ? gesture : last
  const tool = subject?.tool ?? 'fold'
  const grab = subject?.grab
  // N: how many layers the grab can take (against the frame the fold was made on).
  const total = useMemo(() => {
    if (!grab) return 0
    const frame = live ? current(history) : history.frames[history.cursor - 1]
    return frame ? Math.max(1, layerAt(frame, grab).length) : 0
  }, [grab, live, history])

  // Close the form when the bar goes away or the next fold begins.
  useEffect(() => {
    if (!subject) setOpen(false)
  }, [subject])
  // ...and when a gesture starts or ends, or the cursor moves to another step (stale values).
  useEffect(() => setOpen(false), [live, gesture?.grab, history.cursor, history.steps.length])

  if (!subject) return null

  const k = live ? gesture.layers : subject.layers
  const shownKind: FoldKind = live ? kind : subject.kind
  const liveAngle = live ? (gesture.angleDeg ?? preview?.angleDeg ?? 0) : last!.angleDeg
  const angle = local ?? liveAngle
  const canAngle = tool === 'fold'
  const canCrease = tool === 'fold' || tool === 'reverse'
  const crease: Line | null = live
    ? (gesture.crease ?? (preview?.crease[0] ? lineOf(preview.crease[0][0], preview.crease[0][1]) : null))
    : last!.crease
  const d = crease ? describe(crease) : null

  const onKind = (next: FoldKind) => {
    if (live) setKind(next)
    else void setLastFold({ kind: next })
  }
  const onAngle = (deg: number) => {
    if (live) return setNumeric({ angleDeg: deg })
    setLocal(deg)
    void setLastFold({ angleDeg: deg }).then(() => setLocal(null))
  }
  const apply = (e: { crease: Line; angleDeg?: number }) => {
    setNumeric(e)
    setOpen(false)
    readout.current?.focus()
  }

  return (
    <section className="island foldbar" aria-label="Fold" data-live={live ? '' : undefined} data-coarse={coarse ? '' : undefined}>
      {open && (
        <NumericForm
          crease={crease}
          angle={angle}
          canAngle={canAngle}
          onApply={apply}
          onClose={() => {
            setOpen(false)
            readout.current?.focus()
          }}
        />
      )}
      <div className="fold-row">
        <div role="group" aria-label="Fold direction" className="seg kinds">
          <button type="button" aria-pressed={shownKind === 'valley'} disabled={pending} onClick={() => onKind('valley')}>
            <span className="glyph" aria-hidden="true">┄┄</span> Valley
          </button>
          <button type="button" aria-pressed={shownKind === 'mountain'} disabled={pending} onClick={() => onKind('mountain')}>
            <span className="glyph" aria-hidden="true">┄·┄</span> Mountain
          </button>
        </div>

        <label className="angle" htmlFor={sliderId}>
          <span className="sr-only">Fold angle</span>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={180}
            step={1}
            value={Math.round(angle)}
            disabled={!canAngle || (live && pending)}
            aria-valuetext={`${Math.round(angle)} degrees`}
            onChange={e => onAngle(Number(e.target.value))}
          />
          <output className="mono" aria-hidden="true">{Math.round(angle)}°</output>
        </label>

        <div className="badge" role="group" aria-label="Layers">
          <button type="button" className="step" aria-label="Fewer layers" disabled={!live || k <= 1} onClick={() => setLayers(k - 1)}>−</button>
          <span className="mono" data-testid="layer-badge">{k} of {total} {total === 1 ? 'layer' : 'layers'}</span>
          <button type="button" className="step" aria-label="More layers" disabled={!live || k >= total} onClick={() => setLayers(k + 1)}>+</button>
        </div>

        <button
          ref={readout}
          type="button"
          className="readout mono"
          aria-expanded={open}
          disabled={!canCrease}
          onClick={() => setOpen(o => !o)}
        >
          {/* The visible readout is part of the accessible name (WCAG 2.5.3, label in name). */}
          <span className="sr-only">Edit crease numerically: </span>
          {d ? `(${fmt(d.origin[0])}, ${fmt(d.origin[1])}) · ${Math.round(d.deg)}°` : 'crease —'}
        </button>
      </div>
    </section>
  )
}
