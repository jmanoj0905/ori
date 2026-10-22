// Left island: the tool modes, Turn over, the camera views (R54) and the snap toggles.
import { useEffect } from 'react'
import type { Tool } from '@engine'
import { useStudio } from '../store'
import { useSettings } from '../../settings/store'
import { stageDown, useUi } from '../ui'
import type { SnapSettings } from '../../settings/schema'
import { withShortcut } from '../../settings/describe'

// Tooltips name the live bindings (describe.withShortcut), never a hard-coded key.
const TOOLS: { tool: Tool; label: string; title: string; action?: 'reverse' | 'squash' | 'petal' }[] = [
  { tool: 'fold', label: 'Fold', title: 'Fold: drag the paper' },
  { tool: 'reverse', label: 'Reverse', title: 'Reverse fold', action: 'reverse' },
  { tool: 'squash', label: 'Squash', title: 'Squash fold', action: 'squash' },
  { tool: 'petal', label: 'Petal', title: 'Petal fold', action: 'petal' },
]

const SNAPS: { key: keyof SnapSettings; label: string }[] = [
  { key: 'corners', label: 'Corners' },
  { key: 'midpoints', label: 'Midpoints' },
  { key: 'intersections', label: 'Crossings' },
  { key: 'edges', label: 'Edges' },
  { key: 'angle', label: '22.5° angle' },
]

/** After one committed fold the tool returns to Fold, if the setting is on. */
export function useToolReturnsToFold(): void {
  useEffect(
    () =>
      useStudio.subscribe((s, prev) => {
        if (s.tool === 'fold') return
        const a = s.history
        const b = prev.history
        // A pushed step (undo / redo / jump reuse the steps array), not a turn over (no tool mode).
        if (a.steps === b.steps || a.cursor !== b.cursor + 1) return
        const step = a.steps[a.cursor - 1]
        if (!step || step.kind === 'turnOver') return
        if (useSettings.getState().toolReturnsToFold) s.setTool('fold')
      }),
    [],
  )
}

export type ToolsProps = {
  /** Camera views (R54); the buttons are disabled when absent (no Stage). */
  onView?: (view: 'top' | 'reset') => void
}

const VIEWS = [
  { view: 'top', label: 'Top view', title: 'Top view: look straight down' },
  { view: 'reset', label: 'Reset view', title: 'Reset view: back to the studio angle' },
] as const

export function Tools({ onView }: ToolsProps = {}) {
  useToolReturnsToFold()
  const tool = useStudio(s => s.tool)
  const setTool = useStudio(s => s.setTool)
  const turnOver = useStudio(s => s.turnOver)
  const pending = useStudio(s => s.pending)
  const down = useUi(s => stageDown(s.stage))
  const snap = useSettings(s => s.snap)
  const keys = useSettings(s => s.bindings)
  const update = useSettings(s => s.update)
  return (
    <section className="island tools" aria-label="Tools">
      <div role="group" aria-label="Fold tool" className="stack">
        {TOOLS.map(t => (
          <button
            key={t.tool}
            type="button"
            className="tool"
            aria-pressed={tool === t.tool}
            disabled={down}
            title={t.action ? withShortcut(t.title, keys[t.action]) : t.title}
            onClick={() => setTool(t.tool)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <button type="button" className="tool action" disabled={pending || down} onClick={() => void turnOver()} title={withShortcut('Turn the model over', keys.turnOver)}>
        Turn over
      </button>
      <div role="group" aria-label="View" className="stack views">
        <span className="group-label" aria-hidden="true">View</span>
        {VIEWS.map(v => (
          <button key={v.view} type="button" className="tool view" title={withShortcut(v.title, keys[v.view === 'top' ? 'topView' : 'resetView'])} disabled={!onView} onClick={() => onView?.(v.view)}>
            {v.label}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Snap" className="stack snaps">
        <span className="group-label" aria-hidden="true">Snap</span>
        {SNAPS.map(s => (
          <button
            key={s.key}
            type="button"
            className="tool snap"
            aria-pressed={snap[s.key]}
            onClick={() => update({ snap: { ...snap, [s.key]: !snap[s.key] } })}
          >
            {s.label}
          </button>
        ))}
      </div>
    </section>
  )
}
