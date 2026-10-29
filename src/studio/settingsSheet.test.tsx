// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_BINDINGS } from '../settings/bindings'
import { SettingsSheet } from './SettingsSheet'
import { defaultSettings, useSettings } from '../settings/store'

beforeEach(() => useSettings.setState(defaultSettings()))
afterEach(cleanup)

const none = { mod: false, shift: false, alt: false }
const capture = () => document.activeElement as HTMLElement
const row = (label: string) => screen.getByRole('listitem', { name: label })
/** The bindings text of a row (not its action name). */
const binds = (label: string) => row(label).querySelector('[data-binds]') as HTMLElement

function open(onClose = vi.fn()) {
  render(<SettingsSheet onClose={onClose} />)
  return onClose
}

describe('settings sheet: shape', () => {
  test('is a labelled modal dialog with every spec 04 section', () => {
    open()
    const d = screen.getByRole('dialog', { name: 'Settings' })
    expect(d).toHaveAttribute('aria-modal', 'true')
    for (const h of ['Controls', 'Keyboard folding', 'Motion', 'Paper defaults', 'Snapping', 'Behaviour', 'About']) {
      expect(within(d).getByRole('heading', { name: h })).toBeInTheDocument()
    }
  })

  test('Esc closes it; the close button does too', () => {
    const onClose = open()
    fireEvent.keyDown(capture(), { key: 'Escape', code: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('focus moves in on open, is trapped on Tab, and returns to the opener on close', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = render(<SettingsSheet onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    // Shift+Tab from the first focusable wraps to the last; Tab from the last wraps to the first.
    const items = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')]
    items[0]!.focus()
    fireEvent.keyDown(items[0]!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(items[items.length - 1])
    fireEvent.keyDown(items[items.length - 1]!, { key: 'Tab' })
    expect(document.activeElement).toBe(items[0])
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('settings sheet: controls', () => {
  test('captures a new key binding and Save applies it', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change Valley' }))
    expect(screen.getByText('Press a key or mouse button…')).toBeInTheDocument()
    fireEvent.keyDown(capture(), { key: 'b', code: 'KeyB' })
    expect(binds('Valley')).toHaveTextContent(/^B$/)
    expect(screen.queryByText('Press a key or mouse button…')).toBeNull()
    expect(useSettings.getState().bindings.valley[0]).toMatchObject({ key: 'v' }) // not saved yet
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(useSettings.getState().bindings.valley).toEqual([{ type: 'key', key: 'b', mods: none }])
  })

  test('a modifier-only press is ignored while capturing a key; chords keep their modifiers', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change Valley' }))
    fireEvent.keyDown(capture(), { key: 'Shift', code: 'ShiftLeft', shiftKey: true })
    expect(screen.getByText('Press a key or mouse button…')).toBeInTheDocument()
    fireEvent.keyDown(capture(), { key: 'B', code: 'KeyB', shiftKey: true, ctrlKey: true })
    expect(binds('Valley')).toHaveTextContent('Ctrl/⌘ + Shift + B')
  })

  test('captures mouse buttons and the wheel, with modifiers', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change Pan' }))
    fireEvent.mouseDown(capture(), { button: 2, ctrlKey: true }) // (Shift or Alt + drag would clash with the held Angle snap / Force new fold)
    expect(binds('Pan')).toHaveTextContent('Ctrl/⌘ + Right-drag')
    fireEvent.click(screen.getByRole('button', { name: 'Change Zoom' }))
    fireEvent.wheel(capture(), { deltaY: -100, ctrlKey: true, shiftKey: false })
    expect(binds('Zoom')).toHaveTextContent('Ctrl/⌘ + Scroll')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(useSettings.getState().bindings.pan).toEqual([{ type: 'mouse', button: 2, mods: { mod: true, shift: false, alt: false } }])
    expect(useSettings.getState().bindings.zoom).toEqual([{ type: 'wheel', mods: { mod: true, shift: false, alt: false } }])
  })

  test('angle snap captures a held modifier', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change Angle snap' }))
    fireEvent.keyDown(capture(), { key: 'Alt', code: 'AltLeft', altKey: true })
    expect(binds('Angle snap')).toHaveTextContent('Hold Alt')
  })

  test('replacing a binding keeps the other kinds (zoom keeps its scroll wheel)', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change Zoom' }))
    fireEvent.keyDown(capture(), { key: 'q', code: 'KeyQ' })
    expect(binds('Zoom')).toHaveTextContent('Scroll or Q')
  })

  test('a clash is shown inline, Save is disabled, and resolving it re-enables Save', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change Fold (grab and drag)' }))
    fireEvent.mouseDown(capture(), { button: 2 }) // right-drag is Orbit
    const alert = within(row('Fold (grab and drag)')).getByRole('alert')
    expect(alert).toHaveTextContent('Orbit')
    expect(within(row('Orbit')).getByRole('alert')).toHaveTextContent('Fold')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Change Orbit' }))
    fireEvent.mouseDown(capture(), { button: 1, altKey: true }) // Alt is held for Force new fold: still a clash
    expect(within(row('Orbit')).getByRole('alert')).toHaveTextContent('Force a new fold')
    fireEvent.click(screen.getByRole('button', { name: 'Change Orbit' }))
    fireEvent.mouseDown(capture(), { button: 1, ctrlKey: true })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(useSettings.getState().bindings.fold[0]).toMatchObject({ type: 'mouse', button: 2 })
  })

  test('Esc during capture cancels the capture only; Backspace unbinds', () => {
    const onClose = open()
    fireEvent.click(screen.getByRole('button', { name: 'Change Valley' }))
    fireEvent.keyDown(capture(), { key: 'Escape', code: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('Press a key or mouse button…')).toBeNull()
    expect(binds('Valley')).toHaveTextContent(/^V$/)
    fireEvent.click(screen.getByRole('button', { name: 'Change Valley' }))
    fireEvent.keyDown(capture(), { key: 'Backspace', code: 'Backspace' })
    expect(binds('Valley')).toHaveTextContent('Unbound')
  })

  test('reset one restores its default; Reset all restores every default at once', () => {
    useSettings.getState().setBinding('valley', [{ type: 'key', code: 'KeyB', mods: none }])
    open()
    expect(binds('Valley')).toHaveTextContent(/^B$/)
    fireEvent.click(screen.getByRole('button', { name: 'Reset Valley' }))
    expect(binds('Valley')).toHaveTextContent(/^V$/)
    fireEvent.click(screen.getByRole('button', { name: 'Change Mountain' }))
    fireEvent.keyDown(capture(), { key: 'x', code: 'KeyX' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    useSettings.getState().setBinding('undo', [{ type: 'key', code: 'KeyU', mods: none }])
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }))
    expect(useSettings.getState().bindings).toEqual(DEFAULT_BINDINGS)
    expect(binds('Mountain')).toHaveTextContent(/^M$/)
  })

  test('the keyboard fold entry key is listed and remappable', () => {
    open()
    expect(binds('Keyboard fold')).toHaveTextContent(/^F$/)
    fireEvent.click(screen.getByRole('button', { name: 'Change Keyboard fold' }))
    fireEvent.keyDown(capture(), { key: 'k', code: 'KeyK' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(useSettings.getState().bindings.keyboardFold).toEqual([{ type: 'key', key: 'k', mods: none }])
  })
})

describe('settings sheet: preferences', () => {
  test('Motion offers System / Always / Never and applies at once', () => {
    open()
    const group = screen.getByRole('radiogroup', { name: 'Reduced motion' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map(r => (r as HTMLInputElement).value)).toEqual(['system', 'always', 'never'])
    expect(within(group).getByRole('radio', { name: 'System' })).toBeChecked()
    fireEvent.click(within(group).getByRole('radio', { name: 'Always' }))
    expect(useSettings.getState().reducedMotion).toBe('always')
    fireEvent.click(within(group).getByRole('radio', { name: 'Never' }))
    expect(useSettings.getState().reducedMotion).toBe('never')
  })

  test('snapping toggles and the radius slider (2 to 40 px)', () => {
    open()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Corners' }))
    expect(useSettings.getState().snap.corners).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Construction axioms' }))
    expect(useSettings.getState().snap.axioms).toBe(true)
    const slider = screen.getByRole('slider', { name: 'Snap radius' })
    expect(slider).toHaveAttribute('min', '2')
    expect(slider).toHaveAttribute('max', '40')
    fireEvent.change(slider, { target: { value: '30' } })
    expect(useSettings.getState().snapRadiusPx).toBe(30)
    expect(slider).toHaveAttribute('aria-valuetext', '30 pixels')
  })

  test('behaviour toggles', () => {
    open()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tool returns to Fold after one use' }))
    expect(useSettings.getState().toolReturnsToFold).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm before replacing my work with a preset' }))
    expect(useSettings.getState().confirmPresetReplace).toBe(false)
  })

  test('paper defaults for new sheets', () => {
    open()
    fireEvent.change(screen.getByRole('combobox', { name: 'Material' }), { target: { value: 'plain' } })
    expect(useSettings.getState().paperDefaults.mode).toBe('plain')
    fireEvent.change(screen.getByRole('combobox', { name: 'Sheet size' }), { target: { value: 'a4' } })
    expect(useSettings.getState().paperDefaults.size).toBe('a4')
    fireEvent.click(screen.getByRole('button', { name: 'Indigo' }))
    expect(useSettings.getState().paperDefaults.front).toBe('#2F4A8A')
    fireEvent.change(screen.getByRole('slider', { name: 'Thickness' }), { target: { value: '0.8' } })
    expect(useSettings.getState().paperDefaults.thickness).toBeCloseTo(0.8)
  })

  test('About shows the version, GPLv3, the source link and the Rabbit Ear credit', () => {
    open()
    const about = screen.getByRole('region', { name: 'About' })
    expect(within(about).getByText(/Version \d/)).toBeInTheDocument()
    expect(about).toHaveTextContent('GPLv3')
    const src = within(about).getByRole('link', { name: 'https://github.com/jmanoj0905/ori' })
    expect(src).toHaveAttribute('href', 'https://github.com/jmanoj0905/ori')
    expect(about).toHaveTextContent('Rabbit Ear')
  })

  test('Keyboard folding section documents the flow', () => {
    open()
    const s = screen.getByRole('region', { name: 'Keyboard folding' })
    expect(s).toHaveTextContent('Enter')
    expect(s).toHaveTextContent('22.5')
    expect(s).toHaveTextContent('Esc')
  })
})

test('About links the GPL text and the third-party licences', () => {
  render(<SettingsSheet onClose={() => {}} />)
  expect(screen.getByRole('link', { name: 'GNU General Public License v3' })).toHaveAttribute('href', '/LICENSE.txt')
  expect(screen.getByRole('link', { name: 'Third-party licences' })).toHaveAttribute('href', '/THIRD_PARTY_NOTICES.txt')
})
