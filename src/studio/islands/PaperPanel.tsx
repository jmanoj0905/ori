// Paper panel: material (4 modes), colours, washi pattern, size.
// Changing the size starts a new sheet. When there is work on the page
// (history has steps) the user is asked first with window.confirm; an empty
// history changes size silently.
import { useRef, useState } from 'react'
import { SWATCHES, useStudio, type PaperSettings, type SheetSize } from '../store'

const MODES: { mode: PaperSettings['mode']; label: string; note: string }[] = [
  { mode: 'kami', label: 'Kami', note: 'Coloured front, white back' },
  { mode: 'washi', label: 'Washi', note: 'Patterned, fibrous' },
  { mode: 'plain', label: 'Plain', note: 'Technical white' },
  { mode: 'custom', label: 'Editor', note: 'Every setting' },
]

const KAMI_BACK = '#FFFFFF'

const sizeKey = (s: SheetSize): 'square' | 'a4' | 'custom' => (s === 'square' || s === 'a4' ? s : 'custom')

export const CONFIRM_RESIZE = 'Changing the size starts a new sheet and clears your folds. Continue?'

function Swatches({ value, onPick }: { value: string; onPick(c: string): void }) {
  return (
    <div className="swatches" role="group" aria-label="Colour">
      {Object.entries(SWATCHES).map(([name, hex]) => (
        <button
          key={name}
          type="button"
          className="swatch"
          style={{ background: hex }}
          aria-label={name[0]!.toUpperCase() + name.slice(1)}
          aria-pressed={value.toLowerCase() === hex.toLowerCase()}
          onClick={() => onPick(hex)}
        />
      ))}
      <label className="swatch custom" title="Custom colour">
        <input type="color" aria-label="Custom colour" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#d9472b'} onChange={e => onPick(e.target.value)} />
      </label>
    </div>
  )
}

export function PaperPanel({ onClose }: { onClose(): void }) {
  const paper = useStudio(s => s.paper)
  const setPaper = useStudio(s => s.setPaper)
  const newSheet = useStudio(s => s.newSheet)
  const hasWork = useStudio(s => s.history.steps.length > 0)
  const [dims, setDims] = useState(() =>
    typeof paper.size === 'object' ? { w: String(paper.size.width), h: String(paper.size.height) } : { w: '1', h: '1' })
  const [customOpen, setCustomOpen] = useState(false)
  const ref = useRef<HTMLElement>(null)

  const chooseSize = (size: SheetSize) => {
    if (hasWork && !window.confirm(CONFIRM_RESIZE)) return
    newSheet(size)
  }
  const customSize = (): SheetSize | null => {
    const width = Number(dims.w)
    const height = Number(dims.h)
    return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null
  }
  const setMode = (mode: PaperSettings['mode']) => {
    if (mode === 'kami') setPaper({ mode, back: KAMI_BACK, pattern: undefined })
    else if (mode === 'washi') setPaper({ mode, pattern: paper.pattern ?? 'seigaiha' })
    else setPaper({ mode })
  }
  const size = sizeKey(paper.size)

  return (
    <section
      id="paper-panel"
      ref={ref}
      className="island paper-panel"
      aria-label="Paper"
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="panel-head">
        <h2>Paper</h2>
        <button type="button" className="tbtn" aria-label="Close paper panel" onClick={onClose}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
        </button>
      </div>

      <div role="group" aria-label="Material" className="modes">
        {MODES.map(m => (
          <button key={m.mode} type="button" className="mode" aria-pressed={paper.mode === m.mode} onClick={() => setMode(m.mode)}>
            <span>{m.label}</span>
            <small>{m.note}</small>
          </button>
        ))}
      </div>

      {(paper.mode === 'kami' || paper.mode === 'washi') && (
        <Swatches value={paper.front} onPick={front => setPaper({ front })} />
      )}

      {paper.mode === 'washi' && (
        <div role="group" aria-label="Pattern" className="seg">
          {(['seigaiha', 'asanoha'] as const).map(p => (
            <button key={p} type="button" aria-pressed={(paper.pattern ?? 'seigaiha') === p} onClick={() => setPaper({ pattern: p })}>
              {p[0]!.toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      )}

      {paper.mode === 'plain' && <p className="note">White front and back, no texture.</p>}

      {paper.mode === 'custom' && (
        <div className="editor">
          <div className="field-row"><span>Front</span><Swatches value={paper.front} onPick={front => setPaper({ front })} /></div>
          <label className="field-row">
            <span>Back</span>
            <input type="color" aria-label="Back colour" value={/^#[0-9a-f]{6}$/i.test(paper.back) ? paper.back : '#ffffff'} onChange={e => setPaper({ back: e.target.value })} />
          </label>
          <div role="group" aria-label="Pattern" className="seg">
            {([undefined, 'seigaiha', 'asanoha'] as const).map(p => (
              <button key={p ?? 'none'} type="button" aria-pressed={paper.pattern === p} onClick={() => setPaper({ pattern: p })}>
                {p ? p[0]!.toUpperCase() + p.slice(1) : 'None'}
              </button>
            ))}
          </div>
          <label className="field-row">
            <span>Thickness</span>
            <input type="range" min={0} max={1} step={0.05} value={paper.thickness} onChange={e => setPaper({ thickness: Number(e.target.value) })} />
          </label>
          <label className="field-row">
            <span>Translucency</span>
            <input type="range" min={0} max={1} step={0.05} value={paper.translucency} onChange={e => setPaper({ translucency: Number(e.target.value) })} />
          </label>
        </div>
      )}

      <div role="group" aria-label="Size" className="seg sizes">
        <button type="button" aria-pressed={size === 'square'} onClick={() => chooseSize('square')}>Square</button>
        <button type="button" aria-pressed={size === 'a4'} onClick={() => chooseSize('a4')}>A4</button>
        <button type="button" aria-pressed={size === 'custom'} aria-expanded={customOpen || size === 'custom'} onClick={() => setCustomOpen(true)}>Custom</button>
      </div>
      {(customOpen || size === 'custom') && (
        <form
          className="dims"
          aria-label="Custom size"
          onSubmit={e => {
            e.preventDefault()
            const s = customSize()
            if (s) chooseSize(s)
          }}
        >
          <label>W <input type="number" min="0.1" step="0.1" value={dims.w} onChange={e => setDims({ ...dims, w: e.target.value })} /></label>
          <label>H <input type="number" min="0.1" step="0.1" value={dims.h} onChange={e => setDims({ ...dims, h: e.target.value })} /></label>
          <button type="submit" className="tbtn text" disabled={!customSize()}>New sheet</button>
        </form>
      )}
    </section>
  )
}
