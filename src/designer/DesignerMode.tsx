// Designer mode (spec 07 UI; Plan 5): the crease pattern editor beside the 3D
// view, with its tools island and the exact numeric input. Code-split: the
// app loads this module only when the top bar switches to Designer.
import './designer.css'
import { useEffect, useRef, useState } from 'react'
import type { Frame, Vec2 } from '@engine'
import { Editor } from './Editor'
import { DesignerTools } from './DesignerTools'
import { IssuesPanel } from './IssuesPanel'
import { designerStore, useDesigner, type DesignerStore } from './designerSlice'
import { checkPattern, foldAll, type DesignerWorker } from './foldAll'
import type { VertexIssue } from './checks'

/** The checks run this long after the last edit (Review Focus 4: debounced, in the worker). */
export const CHECK_DEBOUNCE_MS = 150

const FIELDS = [
  ['x1', 'From x'],
  ['y1', 'From y'],
  ['x2', 'To x'],
  ['y2', 'To y'],
] as const
type Field = (typeof FIELDS)[number][0]

/** Exact numeric input: a crease between two typed points (spec 07 "Precise numeric input"). */
export function NumericInput({ store }: { store: DesignerStore }) {
  const [values, setValues] = useState<Record<Field, string>>({ x1: '0', y1: '0', x2: '1', y2: '1' })
  const [error, setError] = useState<string | null>(null)
  const add = () => {
    const n = FIELDS.map(([k]) => Number(values[k].trim() === '' ? NaN : values[k]))
    if (!n.every(Number.isFinite)) return setError('Each coordinate must be a number.')
    setError(null)
    store.getState().addSegment([n[0]!, n[1]!] as Vec2, [n[2]!, n[3]!] as Vec2)
  }
  return (
    <div role="group" aria-label="Exact crease" className="island cp-numeric">
      {FIELDS.map(([k, label]) => (
        <label key={k}>
          <span>{label}</span>
          <input
            aria-label={label}
            className="mono"
            type="number"
            step="any"
            value={values[k]}
            onChange={e => setValues(v => ({ ...v, [k]: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && add()}
          />
        </label>
      ))}
      <button type="button" className="tool primary" onClick={add}>Add crease</button>
      {error && <p role="alert" className="cp-error">{error}</p>}
    </div>
  )
}

export type DesignerModeProps = {
  store?: DesignerStore
  /** The checks / Fold all worker (tests pass an in-process one). */
  worker?: DesignerWorker
  /** Fold all succeeded: show the folded frame in 3D. */
  onFolded?: (frame: Frame) => void
}

/** Live Kawasaki / Maekawa issues of the store's pattern, debounced and computed in the worker. */
export function useIssues(store: DesignerStore, worker?: DesignerWorker): { issues: VertexIssue[]; checking: boolean } {
  const cp = useDesigner(store, s => s.cp)
  const [state, setState] = useState<{ issues: VertexIssue[]; checking: boolean }>({ issues: [], checking: true })
  useEffect(() => {
    const ctl = new AbortController()
    setState(s => ({ ...s, checking: true }))
    const timer = setTimeout(() => {
      checkPattern(cp, { worker, signal: ctl.signal }).then(
        issues => !ctl.signal.aborted && setState({ issues, checking: false }),
        () => !ctl.signal.aborted && setState(s => ({ ...s, checking: false })),
      )
    }, CHECK_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
  }, [cp, worker])
  return state
}

export function FoldAllButton({ store, worker, onFolded }: Omit<DesignerModeProps, 'store'> & { store: DesignerStore }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const ctl = useRef<AbortController | null>(null)
  useEffect(() => () => ctl.current?.abort(), [])
  const run = async () => {
    ctl.current?.abort()
    const c = (ctl.current = new AbortController())
    setBusy(true)
    setResult(null)
    const r = await foldAll(store.getState().cp, c.signal, { worker })
    if (c.signal.aborted && r.ok === false && ctl.current !== c) return
    setBusy(false)
    if (r.ok) {
      setResult({ ok: true, text: `Folded flat: ${r.frame.faces_vertices.length} faces.` })
      onFolded?.(r.frame)
    } else setResult({ ok: false, text: r.reason })
  }
  return (
    <div className="island fold-all">
      <button type="button" className="tool primary" onClick={() => void run()} disabled={busy} aria-busy={busy}>
        {busy ? 'Folding…' : 'Fold all'}
      </button>
      {busy && (
        <button type="button" className="tool" onClick={() => ctl.current?.abort()}>Cancel</button>
      )}
      <p className="fold-all-result" role={result && !result.ok ? 'alert' : 'status'}>{result?.text ?? ''}</p>
    </div>
  )
}

export default function DesignerMode({ store = designerStore(), worker, onFolded }: DesignerModeProps) {
  // Leaving designer mode writes any pending autosave at once (Review Focus 5).
  useEffect(() => () => store.flush(), [store])
  const { issues, checking } = useIssues(store, worker)
  return (
    <section className="designer" aria-label="Designer">
      <DesignerTools store={store} />
      <div className="island cp-panel">
        <Editor store={store} issues={issues} />
      </div>
      <NumericInput store={store} />
      <FoldAllButton store={store} worker={worker} onFolded={onFolded} />
      <IssuesPanel issues={issues} checking={checking} />
    </section>
  )
}
