// Designer mode (spec 07 UI; Plan 5): the crease pattern editor beside the 3D
// view, with its tools island and the exact numeric input. Code-split: the
// app loads this module only when the top bar switches to Designer.
import './designer.css'
import { useEffect, useState } from 'react'
import type { Vec2 } from '@engine'
import { Editor } from './Editor'
import { DesignerTools } from './DesignerTools'
import { designerStore, type DesignerStore } from './designerSlice'

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

export default function DesignerMode({ store = designerStore() }: { store?: DesignerStore }) {
  // Leaving designer mode writes any pending autosave at once (Review Focus 5).
  useEffect(() => () => store.flush(), [store])
  return (
    <section className="designer" aria-label="Designer">
      <DesignerTools store={store} />
      <div className="island cp-panel">
        <Editor store={store} />
      </div>
      <NumericInput store={store} />
    </section>
  )
}
