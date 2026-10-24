// Designer mode (spec 07 UI; Plan 5): the crease pattern editor beside the 3D
// view, with its tools island and the exact numeric input. Code-split: the
// app loads this module only when the top bar switches to Designer.
import './designer.css'
import { useEffect, useRef, useState } from 'react'
import type { StoreApi } from 'zustand'
import { patternFrame, type Frame, type Vec2 } from '@engine'
import { Editor } from './Editor'
import { DesignerTools } from './DesignerTools'
import { IssuesPanel } from './IssuesPanel'
import { cpGeometry, designerStore, useDesigner, type DesignerStore } from './designerSlice'
import { checkPattern, foldAll, importPattern, type DesignerWorker } from './foldAll'
import type { VertexIssue } from './checks'
import { linkDesigner, type Link, type StudioLike } from './sync'
import { useStudio } from '../studio/store'
import { notify } from '../persistence/notice'
import { MAX_IMPORT_BYTES, toCp, toFold } from '../persistence/cpFormats'
import { toCreasePatternSvg } from '../persistence/svgExport'
import { download } from '../persistence/png'

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
  /** The checks / Fold all / import worker (tests pass an in-process one). */
  worker?: DesignerWorker
  /** The studio to sync with (spec 07 "Crease pattern ↔ 3D sync"); the app's by default. */
  studio?: StoreApi<StudioLike> | null
  /** Fold all succeeded (after the 3D view took the folded frame). */
  onFolded?: (frame: Frame) => void
  /** The panel appeared or went: the app re-frames the 3D view beside it. */
  onLayout?: () => void
}

const IMPORT_FAILED = 'That file could not be read.'

/** Import (.cp, .fold) and export (.fold, .cp, SVG) of the designer's pattern. */
export function PatternFiles({ store, worker }: { store: DesignerStore; worker?: DesignerWorker }) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const pick = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_IMPORT_BYTES) return setStatus({ ok: false, text: 'That file is too large to import.' })
    const format = /\.cp$/i.test(file.name) ? 'cp' : 'fold'
    setStatus({ ok: true, text: `Importing ${file.name}…` })
    let text: string
    try {
      text = await file.text()
    } catch {
      return setStatus({ ok: false, text: IMPORT_FAILED })
    }
    const r = await importPattern(format, text, { worker })
    if (!r.ok) return setStatus({ ok: false, text: r.reason })
    store.getState().load(r.cp, true)
    const n = r.cp.edges_assignment.filter(a => a !== 'B').length
    setStatus({ ok: true, text: `Imported ${n} creases from ${file.name}.` })
  }
  const save = (kind: 'fold' | 'cp' | 'svg') => {
    const { cp } = store.getState()
    const date = new Date().toISOString().slice(0, 10)
    if (kind === 'cp') return download(new Blob([toCp(cp)], { type: 'text/plain' }), `ori-crease-pattern-${date}.cp`)
    if (kind === 'svg') return download(new Blob([toCreasePatternSvg(cp, { style: 'diagram' })], { type: 'image/svg+xml' }), `ori-crease-pattern-${date}.svg`)
    const faces = patternFrame(cp)
    download(
      new Blob([toFold({ ...cpGeometry(cp), faces_vertices: faces.ok ? faces.frame.faces_vertices : [] })], { type: 'application/json' }),
      `ori-crease-pattern-${date}.fold`,
    )
  }
  return (
    <div role="group" aria-label="Pattern files" className="island cp-files">
      <button type="button" className="tool" onClick={() => input.current?.click()}>Import…</button>
      <input ref={input} type="file" accept=".cp,.fold,application/json,text/plain" hidden aria-label="Import a crease pattern" onChange={e => void pick(e.target.files?.[0])} />
      <span className="sep" aria-hidden="true" />
      <span className="files-label">Export</span>
      <button type="button" className="tool" onClick={() => save('fold')}>.fold</button>
      <button type="button" className="tool" onClick={() => save('cp')}>.cp</button>
      <button type="button" className="tool" onClick={() => save('svg')}>SVG</button>
      {status && <p className="cp-files-status" role={status.ok ? 'status' : 'alert'}>{status.text}</p>}
    </div>
  )
}

/** The branch warning (sync.ts), with the way back to the folded steps. */
function BranchBanner({ store, link }: { store: DesignerStore; link: Link | null }) {
  const branched = useDesigner(store, s => s.branchedFrom !== null)
  const detached = useDesigner(store, s => s.detached)
  if (!branched && !detached) return null
  return (
    <div className="island designer-banner" role="status">
      {branched && (
        <p>
          Editing the crease pattern started a new branch: your folded steps are kept.{' '}
          <button type="button" className="tool" onClick={() => link?.backToFolded()} disabled={!link}>Back to folded steps</button>{' '}
          <button type="button" className="tool" onClick={() => store.setState({ branchedFrom: null })}>Dismiss</button>
        </p>
      )}
      {detached && <p>This pattern is large: the 3D view shows it when you Fold all.</p>}
    </div>
  )
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

export function FoldAllButton({ store, worker, onFolded }: { store: DesignerStore; worker?: DesignerWorker; onFolded?: (frame: Frame) => void }) {
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
    if (ctl.current !== c) return
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

export default function DesignerMode({ store = designerStore(), worker, studio = useStudio, onFolded, onLayout }: DesignerModeProps) {
  // Leaving designer mode writes any pending autosave at once (Review Focus 5).
  useEffect(() => () => store.flush(), [store])
  const layoutRef = useRef(onLayout)
  layoutRef.current = onLayout
  useEffect(() => {
    layoutRef.current?.()
    return () => void requestAnimationFrame(() => layoutRef.current?.())
  }, [])
  const [link, setLink] = useState<Link | null>(null)
  useEffect(() => {
    if (!studio) return
    const l = linkDesigner(studio, store, notify)
    setLink(l)
    return () => {
      l.unlink()
      setLink(null)
    }
  }, [studio, store])
  const { issues, checking } = useIssues(store, worker)
  return (
    <section className="designer" aria-label="Designer">
      <DesignerTools store={store} />
      <BranchBanner store={store} link={link} />
      <div className="island cp-panel">
        <Editor store={store} issues={issues} />
      </div>
      <NumericInput store={store} />
      <FoldAllButton
        store={store}
        worker={worker}
        onFolded={frame => {
          link?.folded(frame)
          onFolded?.(frame)
        }}
      />
      <PatternFiles store={store} worker={worker} />
      <IssuesPanel issues={issues} checking={checking} />
    </section>
  )
}
