// The designer's tools island (spec 07 UI): the line, select and axiom tools,
// the assignment for new creases (and the selected one), the grid presets,
// edit actions on the selected crease, designer undo / redo, and the tool
// prompt (a polite status line saying what to pick next).
import { AXIOM_INPUTS, AXIOM_TEXT, type AxiomNumber } from './axioms'
import type { Assignment } from './cp'
import { useDesigner, type DesignerState, type DesignerStore, type GridName } from './designerSlice'

const AXIOMS: AxiomNumber[] = [1, 2, 3, 4, 5, 6, 7]
const ASSIGNMENTS: { a: Assignment; label: string }[] = [
  { a: 'M', label: 'Mountain' },
  { a: 'V', label: 'Valley' },
  { a: 'U', label: 'Unassigned' },
]
const GRIDS: { g: GridName; label: string }[] = [
  { g: '8x8', label: '8 × 8' },
  { g: '16x16', label: '16 × 16' },
  { g: '22.5', label: '22.5°' },
  { g: 'custom', label: 'Custom' },
]

const count = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** What the active tool needs next. */
export function promptFor(s: Pick<DesignerState, 'tool' | 'points' | 'lines' | 'selected' | 'message' | 'candidates'>): string {
  if (s.message) return s.message
  const { tool } = s
  if (tool.kind === 'line') return s.points.length === 0 ? 'Click the crease’s start point.' : 'Click the crease’s end point.'
  if (tool.kind === 'select') return s.selected === null ? 'Click a crease to select it.' : 'Crease selected: assign, flip or delete it.'
  const need = AXIOM_INPUTS[tool.n]
  const parts = [need.lines ? count(need.lines, 'crease') : '', need.points ? count(need.points, 'point') : ''].filter(Boolean)
  const got = s.lines.length + s.points.length
  const next = s.lines.length < need.lines ? 'a crease' : 'a point'
  return `Axiom ${tool.n}: ${AXIOM_TEXT[tool.n]}. Pick ${parts.join(', then ')} (${got} of ${need.lines + need.points}). Next: ${next}.`
}

export function DesignerTools({ store }: { store: DesignerStore }) {
  const s = useDesigner(store, x => x)
  const { tool, assignment, grid, customDivisions, selected, candidates, past, future } = s
  return (
    <section className="island designer-tools" aria-label="Designer tools">
      <div role="group" aria-label="Draw" className="row">
        <button type="button" className="tool" aria-pressed={tool.kind === 'line'} onClick={() => s.setTool({ kind: 'line' })}>Line</button>
        <button type="button" className="tool" aria-pressed={tool.kind === 'select'} onClick={() => s.setTool({ kind: 'select' })}>Select</button>
      </div>
      <div role="group" aria-label="Axioms" className="row axioms">
        <span className="group-label" aria-hidden="true">Axiom</span>
        {AXIOMS.map(n => (
          <button
            key={n}
            type="button"
            className="tool axiom"
            aria-label={`Axiom ${n}`}
            title={`Axiom ${n}: ${AXIOM_TEXT[n]}`}
            aria-pressed={tool.kind === 'axiom' && tool.n === n}
            onClick={() => s.setTool({ kind: 'axiom', n })}
          >
            {n}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Assignment" className="row">
        {ASSIGNMENTS.map(({ a, label }) => (
          <button key={a} type="button" className="tool" aria-pressed={assignment === a} onClick={() => s.assignSelected(a)}>
            {label}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Selected crease" className="row">
        <button type="button" className="tool" disabled={selected === null} onClick={s.flipSelected}>Flip</button>
        <button type="button" className="tool" disabled={selected === null} onClick={s.deleteSelected}>Delete crease</button>
      </div>
      <div className="row grid-row">
        <label>
          Grid{' '}
          <select aria-label="Grid" value={grid} onChange={e => s.setGrid(e.target.value as GridName)}>
            {GRIDS.map(({ g, label }) => (
              <option key={g} value={g}>{label}</option>
            ))}
          </select>
        </label>
        {grid === 'custom' && (
          <label>
            Divisions{' '}
            <input
              aria-label="Divisions"
              className="mono"
              type="number"
              min={1}
              max={256}
              value={customDivisions}
              onChange={e => s.setGrid('custom', Number(e.target.value))}
            />
          </label>
        )}
      </div>
      <div role="group" aria-label="Edits" className="row">
        <button type="button" className="tool" aria-label="Undo edit" disabled={past.length === 0} onClick={s.undo}>Undo</button>
        <button type="button" className="tool" aria-label="Redo edit" disabled={future.length === 0} onClick={s.redo}>Redo</button>
      </div>
      {candidates.length > 0 && (
        <div role="group" aria-label="Solutions" className="row">
          {candidates.map((_, i) => (
            <button key={i} type="button" className="tool primary" onClick={() => s.chooseCandidate(i)}>Solution {i + 1}</button>
          ))}
        </div>
      )}
      <p id="designer-prompt" className="designer-prompt" role="status" aria-label="Tool prompt" aria-live="polite">
        {promptFor(s)}
      </p>
    </section>
  )
}
