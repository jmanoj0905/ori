// Top island: wordmark, undo / redo, paper, export and settings.
import { canRedo, canUndo } from '@engine'
import { useStudio } from '../store'

export type TopBarProps = {
  paperOpen: boolean
  onTogglePaper(): void
  /** Wired by Task 11 (PNG export); the button is disabled until then. */
  onExport?: () => void
  /** Wired by Task 10 (settings sheet); the button is disabled until then. */
  onSettings?: () => void
}

export function TopBar({ paperOpen, onTogglePaper, onExport, onSettings }: TopBarProps) {
  const undoable = useStudio(s => canUndo(s.history))
  const redoable = useStudio(s => canRedo(s.history))
  const undo = useStudio(s => s.undo)
  const redo = useStudio(s => s.redo)
  return (
    <header className="island topbar" role="banner" aria-label="Studio bar">
      <h1 className="wordmark">ori · 折り</h1>
      <div className="bar-actions">
        <button type="button" className="tbtn" onClick={undo} disabled={!undoable} aria-label="Undo" title="Undo (Ctrl+Z)">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4 3 8l4 4M3.5 8H12a4.5 4.5 0 0 1 0 9H8" /></svg>
        </button>
        <button type="button" className="tbtn" onClick={redo} disabled={!redoable} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m13 4 4 4-4 4M16.5 8H8a4.5 4.5 0 0 0 0 9h4" /></svg>
        </button>
        <span className="sep" aria-hidden="true" />
        <button
          type="button"
          className="tbtn text"
          aria-expanded={paperOpen}
          aria-controls="paper-panel"
          onClick={onTogglePaper}
        >
          Paper
        </button>
        <button type="button" className="tbtn text" onClick={onExport} disabled={!onExport}>
          Export
        </button>
        <button type="button" className="tbtn" aria-label="Settings" title="Settings" onClick={onSettings} disabled={!onSettings}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="2.6" />
            <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" />
          </svg>
        </button>
      </div>
    </header>
  )
}
