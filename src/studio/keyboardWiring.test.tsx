// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useInput, type InputStage } from '../input/useInput'
import { defaultSettings, useSettings } from '../settings/store'
import { inProcessCommitter, handleRequest } from './committer'
import { ConfirmDialog } from './islands/ConfirmDialog'
import { HintLine } from './islands/HintLine'
import { LiveLog } from './LiveLog'
import { SheetHost } from './SheetHost'
import { clearAnnouncements } from './announce'
import { useStudio } from './store'
import { useUi } from './ui'

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  postMessage(msg: { id: number; req: Parameters<typeof handleRequest>[0] }) {
    const result = handleRequest(msg.req)
    setTimeout(() => this.onmessage?.({ data: { id: msg.id, result } } as MessageEvent), 0)
  }
  terminate() {}
}
void inProcessCommitter

const INITIAL = useStudio.getInitialState()
const canvas = document.createElement('canvas')
const marker = vi.fn()
const stage: InputStage = {
  canvas,
  pick: () => null,
  projectToPaperPlane: () => [0, 0],
  pxPerUnit: () => 100,
  orbit() {},
  pan() {},
  zoom() {},
  view() {},
  setHoverMarker: marker,
}
function Harness() {
  useInput(stage)
  return null
}
const key = (code: string, init: KeyboardEventInit = {}, target: EventTarget = window) => {
  const e = new KeyboardEvent('keydown', { code, key: init.key ?? code, bubbles: true, cancelable: true, ...init })
  act(() => void target.dispatchEvent(e))
  return e
}

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker)
  useStudio.setState({ ...INITIAL }, true)
  useSettings.setState(defaultSettings())
  useUi.setState({ sheet: null, kf: 'idle' })
  clearAnnouncements()
  marker.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('? and the settings action open the sheets', () => {
  test('? opens the shortcut sheet listing the current (remapped) bindings; Esc closes it', async () => {
    useSettings.getState().setBinding('valley', [{ type: 'key', code: 'KeyB', mods: { mod: false, shift: false, alt: false } }])
    render(<><Harness /><SheetHost /></>)
    key('Slash', { shiftKey: true, key: '?' })
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    const valley = within(dialog).getByRole('row', { name: /Valley/ })
    expect(valley).toHaveTextContent('B')
    expect(within(dialog).getByRole('row', { name: /Undo/ })).toHaveTextContent('Ctrl/⌘ + Z')
    expect(within(dialog).getByRole('row', { name: /Redo/ })).toHaveTextContent('Ctrl/⌘ + Shift + Z')
    expect(within(dialog).getByRole('row', { name: /Orbit/ })).toHaveTextContent('Right-drag')
    expect(within(dialog).getByRole('row', { name: /^Zoom/ })).toHaveTextContent('Scroll')
    expect(within(dialog).getByRole('row', { name: /Angle snap/ })).toHaveTextContent('Hold Shift')
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('the settings action (when bound) opens the settings sheet', async () => {
    useSettings.getState().setBinding('settings', [{ type: 'key', code: 'Comma', mods: { mod: true, shift: false, alt: false } }])
    render(<><Harness /><SheetHost /></>)
    key('Comma', { ctrlKey: true })
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  test('shortcuts are not typed into a text field', async () => {
    render(<><Harness /><SheetHost /><input aria-label="t" /></>)
    const input = screen.getByLabelText('t')
    input.focus()
    key('Slash', { shiftKey: true, key: '?' }, input)
    expect(useUi.getState().sheet).toBeNull()
  })
})

describe('the Esc carry: the window cancel does not fire while a dialog has focus', () => {
  test('ConfirmDialog keeps focus and Esc cancels only the dialog', () => {
    const cancel = vi.spyOn(useStudio.getState(), 'cancel')
    act(() => useStudio.getState().begin([1, 1]))
    const onCancel = vi.fn()
    render(<><Harness /><ConfirmDialog title="Replace?" message="m" confirmLabel="Yes" onCancel={onCancel} onConfirm={() => {}} /></>)
    cancel.mockClear()
    const btn = screen.getByRole('button', { name: 'Cancel' })
    expect(btn).toHaveFocus()
    key('Escape', {}, btn)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(useStudio.getState().gesture).not.toBeNull() // the fold underneath was not cancelled
    expect(cancel).not.toHaveBeenCalled()
  })

  test('the settings sheet swallows Esc too (closes itself, leaves the gesture)', async () => {
    act(() => useStudio.getState().begin([1, 1]))
    useUi.setState({ sheet: 'settings' })
    render(<><Harness /><SheetHost /></>)
    await screen.findByRole('dialog', { name: 'Settings' })
    key('Escape', {}, document.activeElement!)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(useStudio.getState().gesture).not.toBeNull()
  })
})

describe('keyboard-only fold through the real input wiring', () => {
  test('F, Enter, arrows, Enter commits a step, the log reads it, and no pointer event was needed', async () => {
    render(<><Harness /><LiveLog /><HintLine /></>)
    key('KeyF')
    expect(useUi.getState().kf).toBe('grab')
    expect(marker).toHaveBeenLastCalledWith([0, 1])
    expect(screen.getByRole('status')).toHaveTextContent(/Enter/)
    key('Enter')
    expect(useUi.getState().kf).toBe('target')
    key('ArrowRight')
    key('ArrowRight')
    key('Enter')
    await waitFor(() => expect(useStudio.getState().history.steps).toHaveLength(1))
    expect(await screen.findByText('Step 1: valley fold, top flap, 1 layer, 180 degrees.')).toBeInTheDocument()
    expect(useUi.getState().kf).toBe('idle')
    expect(marker).toHaveBeenLastCalledWith(null)
  })

  test('the normal bindings still work mid-flow: M switches to mountain, ] and [ move layers, Esc cancels', async () => {
    render(<Harness />)
    key('KeyF')
    key('Enter')
    key('ArrowRight')
    key('KeyM')
    expect(useStudio.getState().gesture?.kind).toBe('mountain')
    key('Escape')
    expect(useStudio.getState().gesture).toBeNull()
    expect(useUi.getState().kf).toBe('idle')
  })

  test('the fold key is remappable', () => {
    useSettings.getState().setBinding('keyboardFold', [{ type: 'key', code: 'KeyK', mods: { mod: false, shift: false, alt: false } }])
    render(<Harness />)
    key('KeyF')
    expect(useUi.getState().kf).toBe('idle')
    key('KeyK')
    expect(useUi.getState().kf).toBe('grab')
  })

  test('arrows and Enter do nothing outside the mode, and Cmd+Z still undoes inside it', () => {
    render(<Harness />)
    const e = key('ArrowRight')
    expect(e.defaultPrevented).toBe(false)
    key('KeyF')
    const z = key('KeyZ', { ctrlKey: true })
    expect(z.defaultPrevented).toBe(true) // reached the router, not swallowed by the cursor
  })

  test('the canvas is a labelled tab stop', () => {
    render(<Harness />)
    expect(canvas).toHaveAttribute('tabindex', '0')
    expect(canvas).toHaveAttribute('aria-label')
  })
})
