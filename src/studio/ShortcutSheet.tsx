// The shortcut sheet (`?`): every action with its CURRENT binding (remaps
// included), plus the fixed keys of the keyboard-fold flow. Esc closes.
import { useId } from 'react'
import { ACTION_LABELS, describeBindings } from '../settings/describe'
import { ACTIONS } from '../settings/schema'
import { useSettings } from '../settings/store'
import '../settings/sheet.css'
import { useModal } from './useModal'

const FIXED: [string, string][] = [
  ['Move the landmark cursor', 'Tab, Shift + Tab, arrow keys'],
  ['Set the grab point / commit the fold', 'Enter'],
  ['Fold angle in 22.5° steps', '+ and −'],
  ['Cancel the fold', 'Esc'],
]

export function ShortcutSheet({ onClose, onSettings }: { onClose(): void; onSettings?: () => void }) {
  const { ref, onKeyDown } = useModal(onClose)
  const id = useId()
  const bindings = useSettings(s => s.bindings)
  return (
    <div className="scrim" onKeyDown={onKeyDown}>
      <aside ref={ref} className="island sheet center" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
        <header className="sheet-head">
          <h2 id={`${id}-t`}>Keyboard shortcuts</h2>
        </header>
        <div className="sheet-body">
          <table className="shortcuts">
            <caption className="sr-only">Current controls</caption>
            <tbody>
              {ACTIONS.map(a => {
                const text = describeBindings(bindings[a])
                return (
                  <tr key={a}>
                    <th scope="row">{ACTION_LABELS[a]}</th>
                    <td className="mono" data-unbound={bindings[a].length ? undefined : ''}>{text}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <h3 className="sub">While keyboard folding</h3>
          <table className="shortcuts">
            <caption className="sr-only">Keyboard folding keys</caption>
            <tbody>
              {FIXED.map(([what, keys]) => (
                <tr key={what}>
                  <th scope="row">{what}</th>
                  <td className="mono">{keys}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="sheet-foot">
          {onSettings && <button type="button" className="tbtn text" onClick={onSettings}>Change in Settings</button>}
          <button type="button" className="tbtn text primary" data-autofocus onClick={onClose}>Close</button>
        </footer>
      </aside>
    </div>
  )
}
