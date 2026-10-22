// Top island: wordmark, undo / redo, paper, export and settings.
import { useState } from 'react'
import { canRedo, canUndo } from '@engine'
import { useStudio } from '../store'
import { useSettings } from '../../settings/store'
import { withShortcut } from '../../settings/describe'

export type TopBarProps = {
  paperOpen: boolean
  onTogglePaper(): void
  /** PNG export of the current view; the button is disabled when absent. */
  onExport?: (transparent: boolean) => void
  /** .fold or crease-pattern SVG export; the file items are disabled when absent. */
  onExportFile?: (kind: 'fold' | 'svg', opts: { grid: boolean; style: 'diagram' | 'mv-color' }) => void
  /** Opens the settings sheet (the gear). */
  onSettings?: () => void
  /** Opens the Share dialog; the button is disabled when there is nothing to share. */
  onShare?: () => void
}

export function TopBar({ paperOpen, onTogglePaper, onExport, onExportFile, onSettings, onShare }: TopBarProps) {
  const undoable = useStudio(s => canUndo(s.history))
  const redoable = useStudio(s => canRedo(s.history))
  const undo = useStudio(s => s.undo)
  const redo = useStudio(s => s.redo)
  const shareable = useStudio(s => s.history.cursor > 0)
  const keys = useSettings(s => s.bindings)
  const [exportOpen, setExportOpen] = useState(false)
  const [grid, setGrid] = useState(false)
  const [mvColor, setMvColor] = useState(false)
  const chooseFile = (kind: 'fold' | 'svg') => {
    setExportOpen(false)
    onExportFile?.(kind, { grid, style: mvColor ? 'mv-color' : 'diagram' })
  }
  const choose = (transparent: boolean) => {
    setExportOpen(false)
    onExport?.(transparent)
  }
  return (
    <header className="island topbar" role="banner" aria-label="Studio bar">
      <h1 className="wordmark">ori · 折り</h1>
      <div className="bar-actions">
        <button type="button" className="tbtn" onClick={undo} disabled={!undoable} aria-label="Undo" title={withShortcut('Undo', keys.undo)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4 3 8l4 4M3.5 8H12a4.5 4.5 0 0 1 0 9H8" /></svg>
        </button>
        <button type="button" className="tbtn" onClick={redo} disabled={!redoable} aria-label="Redo" title={withShortcut('Redo', keys.redo)}>
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
        <span className="export-wrap">
          <button
            type="button"
            className="tbtn text"
            aria-expanded={exportOpen}
            aria-haspopup="true"
            onClick={() => setExportOpen(o => !o)}
            onKeyDown={e => e.key === 'Escape' && setExportOpen(false)}
            disabled={!onExport}
          >
            Export
          </button>
          {exportOpen && (
            <div className="export-menu" role="group" aria-label="Export">
              <button type="button" className="tbtn text" onClick={() => choose(false)}>PNG · washi background</button>
              <button type="button" className="tbtn text" onClick={() => choose(true)}>PNG · transparent</button>
              <button type="button" className="tbtn text" onClick={() => chooseFile('fold')} disabled={!onExportFile}>.fold file</button>
              <button type="button" className="tbtn text" onClick={() => chooseFile('svg')} disabled={!onExportFile}>Crease pattern (SVG)</button>
              <label className="export-opt">
                <input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} /> Grid
              </label>
              <label className="export-opt">
                <input type="checkbox" checked={mvColor} onChange={e => setMvColor(e.target.checked)} /> Colour mountain / valley
              </label>
            </div>
          )}
        </span>
        <button type="button" className="tbtn text" onClick={onShare} disabled={!onShare || !shareable} title={shareable ? 'Share a link to this model' : 'Fold something to share it'}>
          Share
        </button>
        <button type="button" className="tbtn" aria-label="Settings" title={withShortcut('Settings', keys.settings)} onClick={onSettings} disabled={!onSettings}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="2.6" />
            <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" />
          </svg>
        </button>
      </div>
    </header>
  )
}
