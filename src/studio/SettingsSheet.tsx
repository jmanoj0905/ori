// The settings sheet (spec 04): a modal side sheet (studio UI over the
// settings store; it lives here because it uses studio islands) opened from the top bar's
// gear or the `settings` action. Code-split (React.lazy in SheetHost).
//
// Bindings are edited in a draft: capture a key, mouse button or wheel (with
// modifiers) per action, see conflicts inline, then Save (disabled while any
// conflict stands). "Reset all" restores the defaults at once. Every other
// preference applies immediately and persists through useSettings.
//
// Capture rules: a capture replaces the action's binding of the SAME kind
// (so Fewer layers keeps its scroll wheel when its key changes) and adds one
// when there is none. Esc cancels the capture, Backspace/Delete unbinds, a
// modifier-only press is ignored (except for Angle snap, which is a held
// modifier and takes only those). Because Esc and Backspace are commands there,
// they cannot be captured as bindings from this sheet: Cancel keeps its default
// Esc and "Reset" restores anything remapped away from it.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { version } from '../../package.json'
import { announce } from './announce'
import { useModal } from './useModal'
import { Swatches } from './islands/PaperPanel'
import { DEFAULT_BINDINGS, cloneBindings, findConflicts, sameBinding } from '../settings/bindings'
import { ACTION_LABELS, describeBindings } from '../settings/describe'
import { ACTIONS, type Action, type Binding, type Bindings, type ModKey, type Mods, type SnapSettings } from '../settings/schema'
import { useSettings } from '../settings/store'
import './sheet.css'

export const SOURCE_URL = 'https://github.com/jmanoj0905/ori'

const MODIFIER_CODES: Record<string, ModKey> = {
  ShiftLeft: 'shift', ShiftRight: 'shift', AltLeft: 'alt', AltRight: 'alt',
  ControlLeft: 'mod', ControlRight: 'mod', MetaLeft: 'mod', MetaRight: 'mod',
}

type Modified = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }
const modsOf = (e: Modified): Mods => ({ mod: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey })

/** `list` with `next` replacing the first binding of its kind (in place), or appended. */
export function withBinding(list: readonly Binding[], next: Binding): Binding[] {
  const at = list.findIndex(b => b.type === next.type)
  if (at < 0) return [...list, next]
  return [...list.slice(0, at), next, ...list.slice(at + 1).filter(b => b.type !== next.type)]
}

/** Actions the draft clashes on, by action. */
function clashes(b: Bindings): Map<Action, Action[]> {
  const m = new Map<Action, Action[]>()
  for (const [x, y] of findConflicts(b)) {
    m.set(x, [...(m.get(x) ?? []), y])
    m.set(y, [...(m.get(y) ?? []), x])
  }
  return m
}

const sameList = (a: readonly Binding[], b: readonly Binding[]) =>
  a.length === b.length && a.every((x, i) => sameBinding(x, b[i]!))

const SNAPS: { key: keyof SnapSettings; label: string }[] = [
  { key: 'corners', label: 'Corners' },
  { key: 'midpoints', label: 'Midpoints' },
  { key: 'intersections', label: 'Crossings' },
  { key: 'edges', label: 'Edges' },
  { key: 'angle', label: '22.5° angle snapping' },
  { key: 'axioms', label: 'Construction axioms' },
]

const MODES = [
  { mode: 'kami', label: 'Kami' },
  { mode: 'washi', label: 'Washi' },
  { mode: 'plain', label: 'Plain' },
  { mode: 'custom', label: 'Editor' },
] as const

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function ControlRow({
  action, list, capturing, conflictWith, onChange, onCapture, onReset,
}: {
  action: Action
  list: readonly Binding[]
  capturing: boolean
  conflictWith: Action[]
  onChange(list: Binding[]): void
  onCapture(on: boolean): void
  onReset(): void
}) {
  const label = ACTION_LABELS[action]
  const modifierOnly = action === 'angleSnap'
  const isDefault = sameList(list, DEFAULT_BINDINGS[action])
  const change = useRef<HTMLButtonElement>(null)
  const was = useRef(false)
  // When the capture box goes away focus would fall to <body>: put it back on Change.
  useEffect(() => {
    const a = document.activeElement
    if (was.current && !capturing && (!a || a === document.body)) change.current?.focus()
    was.current = capturing
  }, [capturing])

  const done = (next: Binding[]) => {
    onChange(next)
    onCapture(false)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation() // the sheet's own Esc / Tab handling must not see a capture
    e.preventDefault()
    if (e.repeat) return
    if (e.code === 'Escape') return onCapture(false)
    if (e.code === 'Backspace' || e.code === 'Delete') return done([])
    const mk = MODIFIER_CODES[e.code]
    if (modifierOnly) {
      if (mk) done([{ type: 'modifier', key: mk }])
      return
    }
    if (mk) return // wait for the key the modifier belongs to
    done(withBinding(list, { type: 'key', code: e.code, mods: modsOf(e) }))
  }
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    if (modifierOnly || e.button > 2) return
    done(withBinding(list, { type: 'mouse', button: e.button as 0 | 1 | 2, mods: modsOf(e) }))
  }
  const onWheel = (e: React.WheelEvent) => {
    if (modifierOnly) return
    done(withBinding(list, { type: 'wheel', mods: modsOf(e) }))
  }

  return (
    <li className="ctl-row" aria-label={label} data-conflict={conflictWith.length ? '' : undefined}>
      <span className="ctl-name" aria-hidden="true">{label}</span>
      {capturing ? (
        <div
          className="capture"
          role="group"
          tabIndex={-1}
          aria-label={`New binding for ${label}`}
          data-autofocus
          ref={el => el?.focus()}
          onKeyDown={onKeyDown}
          onMouseDown={onMouseDown}
          onWheel={onWheel}
          onContextMenu={e => e.preventDefault()}
          onBlur={() => onCapture(false)}
        >
          <span>Press a key or mouse button…</span>
          <span className="capture-note">{modifierOnly ? 'Press Shift, Alt or Ctrl/⌘.' : 'Or scroll. Esc cancels, Backspace unbinds.'}</span>
        </div>
      ) : (
        <span className="binds mono" data-binds>{describeBindings(list)}</span>
      )}
      <span className="ctl-actions">
        <button ref={change} type="button" className="tbtn text" aria-label={`Change ${label}`} onClick={() => onCapture(true)}>Change</button>
        <button type="button" className="tbtn text" aria-label={`Reset ${label}`} disabled={isDefault} onClick={onReset}>Reset</button>
      </span>
      {conflictWith.length > 0 && (
        <p className="clash" role="alert">
          Clashes with {conflictWith.map(a => ACTION_LABELS[a]).join(', ')}. Change one of them to save.
        </p>
      )}
    </li>
  )
}

export function SettingsSheet({ onClose }: { onClose(): void }) {
  const { ref, onKeyDown } = useModal(onClose)
  const id = useId()
  const stored = useSettings(s => s.bindings)
  const setBindings = useSettings(s => s.setBindings)
  const resetAll = useSettings(s => s.resetAllBindings)
  const update = useSettings(s => s.update)
  const reducedMotion = useSettings(s => s.reducedMotion)
  const snap = useSettings(s => s.snap)
  const snapRadiusPx = useSettings(s => s.snapRadiusPx)
  const toolReturnsToFold = useSettings(s => s.toolReturnsToFold)
  const confirmPresetReplace = useSettings(s => s.confirmPresetReplace)
  const paper = useSettings(s => s.paperDefaults)

  const [draft, setDraft] = useState<Bindings>(() => cloneBindings(stored))
  const [capturing, setCapturing] = useState<Action | null>(null)
  const clash = useMemo(() => clashes(draft), [draft])
  const dirty = useMemo(() => ACTIONS.some(a => !sameList(draft[a], stored[a])), [draft, stored])
  const blocked = clash.size > 0

  const save = () => {
    if (blocked) return
    const r = setBindings(draft)
    if (r.ok) announce('Controls saved.')
  }
  const doResetAll = () => {
    resetAll()
    setDraft(cloneBindings(DEFAULT_BINDINGS))
    setCapturing(null)
    announce('All controls reset to their defaults.')
  }
  const setPaper = (p: Partial<typeof paper>) => update({ paperDefaults: { ...paper, ...p } })

  return (
    <div className="scrim sheet-scrim" onKeyDown={onKeyDown}>
      <div
        ref={ref}
        className="island sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <header className="sheet-head">
          <h2 id={`${id}-title`}>Settings</h2>
          <button type="button" className="tbtn text" aria-label="Close settings" onClick={onClose}>Close</button>
        </header>

        <div className="sheet-body">
          <section aria-labelledby={`${id}-controls`} className="sheet-sec">
            <h3 id={`${id}-controls`}>Controls</h3>
            <p className="note">Every input can be remapped: a key or chord, a mouse button, or the scroll wheel, each with or without modifiers.</p>
            <ul className="ctl-list">
              {ACTIONS.map(a => (
                <ControlRow
                  key={a}
                  action={a}
                  list={draft[a]}
                  capturing={capturing === a}
                  conflictWith={clash.get(a) ?? []}
                  onChange={list => setDraft(d => ({ ...d, [a]: list }))}
                  onCapture={on => setCapturing(c => (on ? a : c === a ? null : c))}
                  onReset={() => setDraft(d => ({ ...d, [a]: cloneBindings(DEFAULT_BINDINGS)[a] }))}
                />
              ))}
            </ul>
            <div className="ctl-foot">
              <button type="button" className="tbtn text" onClick={doResetAll}>Reset all</button>
              <span className="status" aria-live="polite">
                {blocked ? 'Resolve the clashes to save.' : dirty ? 'Unsaved changes.' : ''}
              </span>
              <button type="button" className="tbtn text primary" disabled={blocked || !dirty} onClick={save}>Save</button>
            </div>
          </section>

          <section aria-labelledby={`${id}-kb`} className="sheet-sec">
            <h3 id={`${id}-kb`}>Keyboard folding</h3>
            <p className="note">A complete fold with no mouse.</p>
            <ol className="steps-info">
              <li>Press the Keyboard fold key (<b className="mono">{describeBindings(stored.keyboardFold)}</b>). The landmark cursor appears.</li>
              <li>Tab, Shift+Tab or the arrow keys move the cursor; Enter sets the grab point.</li>
              <li>Cycle to the target the same way. The fold previews live.</li>
              <li>[ and ] change layers, V and M the fold type, + and − the angle in 22.5° steps.</li>
              <li>Enter commits. Esc cancels.</li>
            </ol>
            <p className="note">Tool modes (Reverse, Squash, Petal) use the same flow.</p>
          </section>

          <section aria-labelledby={`${id}-motion`} className="sheet-sec">
            <h3 id={`${id}-motion`}>Motion</h3>
            <fieldset className="radios" role="radiogroup" aria-label="Reduced motion">
              <legend className="sr-only">Reduced motion</legend>
              {(['system', 'always', 'never'] as const).map(v => (
                <label key={v} className="check">
                  <input
                    type="radio"
                    name={`${id}-motion`}
                    value={v}
                    checked={reducedMotion === v}
                    onChange={() => update({ reducedMotion: v })}
                  />
                  <span>{v === 'system' ? 'System' : v === 'always' ? 'Always' : 'Never'}</span>
                </label>
              ))}
            </fieldset>
            <p className="note">System follows your device&apos;s reduce-motion setting. Reduced motion makes fold settling and camera moves instant, and preset playback steps through frames.</p>
          </section>

          <section aria-labelledby={`${id}-paper`} className="sheet-sec">
            <h3 id={`${id}-paper`}>Paper defaults</h3>
            <p className="note">Used when the app opens and for each new sheet. The sheet you are folding keeps its paper.</p>
            <div className="field-grid">
              <label className="field">
                <span>Material</span>
                <select value={paper.mode} onChange={e => setPaper({ mode: e.target.value as typeof paper.mode })}>
                  {MODES.map(m => <option key={m.mode} value={m.mode}>{m.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Sheet size</span>
                <select
                  value={typeof paper.size === 'object' ? 'custom' : paper.size}
                  onChange={e => setPaper({ size: e.target.value as 'square' | 'a4' })}
                >
                  <option value="square">Square</option>
                  <option value="a4">A4</option>
                  {typeof paper.size === 'object' && <option value="custom" disabled>Custom</option>}
                </select>
              </label>
              {paper.mode === 'washi' && (
                <label className="field">
                  <span>Pattern</span>
                  <select
                    value={paper.pattern ?? ''}
                    onChange={e => setPaper({ pattern: (e.target.value || undefined) as typeof paper.pattern })}
                  >
                    <option value="">None</option>
                    <option value="seigaiha">Seigaiha</option>
                    <option value="asanoha">Asanoha</option>
                  </select>
                </label>
              )}
            </div>
            <div className="field">
              <span>Front colour</span>
              <Swatches value={paper.front} onPick={front => setPaper({ front })} />
            </div>
            <label className="field inline">
              <span>Back colour</span>
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(paper.back) ? paper.back : '#ffffff'}
                onChange={e => setPaper({ back: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Thickness</span>
              <input type="range" min={0} max={1} step={0.05} value={paper.thickness} onChange={e => setPaper({ thickness: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>Translucency</span>
              <input type="range" min={0} max={1} step={0.05} value={paper.translucency} onChange={e => setPaper({ translucency: Number(e.target.value) })} />
            </label>
          </section>

          <section aria-labelledby={`${id}-snap`} className="sheet-sec">
            <h3 id={`${id}-snap`}>Snapping</h3>
            <div className="checks">
              {SNAPS.map(s => (
                <Check key={s.key} label={s.label} checked={snap[s.key]} onChange={v => update({ snap: { ...snap, [s.key]: v } })} />
              ))}
            </div>
            <label className="field">
              <span aria-hidden="true">Snap radius: <output className="mono">{snapRadiusPx} px</output></span>
              <input
                type="range"
                min={2}
                max={40}
                step={1}
                value={snapRadiusPx}
                aria-label="Snap radius"
                aria-valuetext={`${snapRadiusPx} pixels`}
                onChange={e => update({ snapRadiusPx: Number(e.target.value) })}
              />
            </label>
          </section>

          <section aria-labelledby={`${id}-beh`} className="sheet-sec">
            <h3 id={`${id}-beh`}>Behaviour</h3>
            <div className="checks">
              <Check label="Tool returns to Fold after one use" checked={toolReturnsToFold} onChange={v => update({ toolReturnsToFold: v })} />
              <Check label="Confirm before replacing my work with a preset" checked={confirmPresetReplace} onChange={v => update({ confirmPresetReplace: v })} />
            </div>
          </section>

          <section aria-labelledby={`${id}-about`} className="sheet-sec">
            <h3 id={`${id}-about`}>About</h3>
            <p>Ori · 折り, a browser origami studio. Version {version}.</p>
            <p>Free software under the GNU General Public License v3 (GPLv3).</p>
            <p>
              Source:{' '}
              <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">{SOURCE_URL}</a>
            </p>
            <p>
              Credits: folding geometry by{' '}
              <a href="https://rabbitear.org" target="_blank" rel="noopener noreferrer">Rabbit Ear</a>
              {' '}(Robby Kraft), drawn with Three.js.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
