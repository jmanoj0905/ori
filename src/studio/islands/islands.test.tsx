// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PAPER_SIZES, commit, createPaper, current, layerAt, push, startHistory } from '@engine'
import type { Gesture, History, Vec2 } from '@engine'
import { App } from '../App'
import { handleRequest } from '../committer'
import { lastFold, useStudio } from '../store'
import { useSettings, defaultSettings } from '../../settings/store'
import { FoldBar } from './FoldBar'
import { BUSY_AFTER_MS, FOLDING, HintLine, RESTORING } from './HintLine'
import { PaperPanel } from './PaperPanel'
import { Tools } from './Tools'
import { TopBar } from './TopBar'

// jsdom has no Worker: a stand-in that runs the engine request and replies asynchronously.
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  postMessage(msg: { id: number; req: Parameters<typeof handleRequest>[0] }) {
    const result = handleRequest(msg.req)
    setTimeout(() => this.onmessage?.({ data: { id: msg.id, result } } as MessageEvent), 0)
  }
  terminate() {}
}

const INITIAL = useStudio.getInitialState()
const base = (): Gesture => ({ tool: 'fold', grab: [0, 0], target: [0, 0], layers: 1, kind: 'valley', progress: 0, snapAngle: false })

/** Fold the square in half twice: 4 layers at x = 0.4. Returns the history. */
function quarterFolded(): History {
  let h = startHistory(createPaper(PAPER_SIZES.square))
  const folds: { grab: Vec2; target: Vec2; layers: number }[] = [
    { grab: [1, 0.5], target: [0, 0.5], layers: 1 },
    { grab: [0, 0.5], target: [0.5, 0.5], layers: 2 },
  ]
  for (const g of folds) {
    const r = commit(current(h), { ...base(), ...g, progress: 1 })
    if (!r.ok) throw new Error(r.reason)
    h = push(h, r.step, r.frame)
  }
  return h
}

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker)
  useStudio.setState({ ...INITIAL }, true)
  useSettings.setState(defaultSettings())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fold bar', () => {
  test('shows the live reading and disables the V/M toggle during a swing', () => {
    useStudio.setState({ history: quarterFolded() })
    useStudio.getState().begin([1, 1])
    act(() => useStudio.setState({ reading: 'swing' }))
    render(<FoldBar />)
    expect(screen.getByText('Swing on crease')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Valley/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Mountain/ })).toBeDisabled()
    act(() => useStudio.setState({ reading: 'new' }))
    expect(screen.getByText('New fold')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Valley/ })).not.toBeDisabled()
  })

  test('renders only while a gesture is set, and shows "2 of 4 layers"', () => {
    useStudio.setState({ history: quarterFolded() })
    render(<FoldBar />)
    // The last fold keeps the bar until the next fold starts...
    expect(screen.getByRole('region', { name: 'Fold' })).toBeInTheDocument()
    // ...a fresh sheet has none.
    cleanup()
    useStudio.setState({ ...INITIAL }, true)
    render(<FoldBar />)
    expect(screen.queryByRole('region', { name: 'Fold' })).toBeNull()
    act(() => useStudio.setState({ history: quarterFolded() }))
    cleanup()

    const h = quarterFolded()
    expect(layerAt(current(h), [0.4, 0.5])).toHaveLength(4)
    useStudio.setState({ ...INITIAL, history: h }, true)
    render(<FoldBar />)
    act(() => {
      useStudio.getState().begin([0.4, 0.5])
      useStudio.getState().setLayers(2)
    })
    expect(screen.getByTestId('layer-badge')).toHaveTextContent('2 of 4 layers')
  })

  test('the angle slider ranges 0 to 180', () => {
    render(<FoldBar />)
    act(() => useStudio.getState().begin([1, 1]))
    const slider = screen.getByRole('slider', { name: 'Fold angle' })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '180')
  })

  test('during a gesture the slider sets the live preview angle', () => {
    render(<FoldBar />)
    act(() => {
      useStudio.getState().begin([1, 1])
      useStudio.getState().drag([0, 0], 1)
    })
    fireEvent.change(screen.getByRole('slider', { name: 'Fold angle' }), { target: { value: '60' } })
    expect(useStudio.getState().gesture?.angleDeg).toBe(60)
    expect(useStudio.getState().preview?.angleDeg).toBeCloseTo(60)
    expect(useStudio.getState().history.steps).toHaveLength(0)
  })

  test('Valley / Mountain toggles the kind mid-gesture', async () => {
    render(<FoldBar />)
    act(() => {
      useStudio.getState().begin([1, 1])
      useStudio.getState().drag([0, 0], 1)
    })
    fireEvent.click(screen.getByRole('button', { name: /Mountain/ }))
    expect(useStudio.getState().gesture?.kind).toBe('mountain')
    expect(screen.getByRole('button', { name: /Mountain/ })).toHaveAttribute('aria-pressed', 'true')
  })

  test('R28: after release the slider re-commits the last step at the new angle', async () => {
    useStudio.setState({ history: quarterFolded() })
    render(<FoldBar />)
    const before = useStudio.getState().history
    const slider = screen.getByRole('slider', { name: 'Fold angle' })
    await act(async () => {
      fireEvent.change(slider, { target: { value: '90' } })
      await vi.waitFor(() => expect(lastFold(useStudio.getState().history)?.angleDeg).toBeCloseTo(90))
    })
    const h = useStudio.getState().history
    expect(h.steps).toHaveLength(before.steps.length) // replaced, not appended
    expect(h.frames[0]).toBe(before.frames[0])
    expect(slider).toHaveValue('90')
  })

  test('R53: jumped back to an earlier step, the bar (slider and kind toggle) is not offered', () => {
    const h = quarterFolded()
    useStudio.setState({ history: h })
    render(<FoldBar />)
    expect(screen.getByRole('region', { name: 'Fold' })).toBeInTheDocument()
    act(() => useStudio.getState().undo()) // cursor 1 of 2 steps
    expect(screen.queryByRole('region', { name: 'Fold' })).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Fold angle' })).toBeNull()
    act(() => useStudio.getState().redo())
    expect(screen.getByRole('slider', { name: 'Fold angle' })).toBeInTheDocument()
  })

  test('R28: a refused re-commit snaps the slider back and the hint shows the reason', async () => {
    useStudio.setState({ history: quarterFolded() })
    render(
      <>
        <FoldBar />
        <HintLine />
      </>,
    )
    const was = lastFold(useStudio.getState().history)!.angleDeg
    const spy = vi.spyOn(useStudio.getState(), 'setLastFold').mockResolvedValue(false)
    act(() => useStudio.setState({ setLastFold: spy, refusal: 'Something is in the way of this fold.' }))
    const slider = screen.getByRole('slider', { name: 'Fold angle' })
    await act(async () => {
      fireEvent.change(slider, { target: { value: '10' } })
    })
    expect(slider).toHaveValue(String(Math.round(was)))
    expect(screen.getByRole('status')).toHaveTextContent('Something is in the way of this fold.')
  })

  test('clicking the crease readout opens a numeric form: a point plus an angle commits through Gesture.crease', async () => {
    render(<FoldBar />)
    act(() => {
      useStudio.getState().begin([1, 0.5])
      useStudio.getState().drag([0.5, 0.5], 0.5)
    })
    fireEvent.click(screen.getByRole('button', { name: /^Edit crease numerically/ }))
    const form = screen.getByRole('form', { name: 'Exact crease' })
    fireEvent.click(within(form).getByRole('button', { name: 'Point + angle' }))
    const [x, y, deg, fold] = within(form).getAllByRole('spinbutton')
    for (const [el, val] of [[x, '0.75'], [y, '0.2'], [deg, '90'], [fold, '120']] as const) {
      fireEvent.change(el, { target: { value: val } })
    }
    fireEvent.click(within(form).getByRole('button', { name: 'Apply' }))
    const g = useStudio.getState().gesture!
    expect(g.crease?.origin).toEqual([0.75, 0.2])
    expect(g.crease?.vector[0]).toBeCloseTo(0, 9)
    expect(g.crease?.vector[1]).toBeCloseTo(1, 9)
    expect(g.angleDeg).toBe(120)
    expect(screen.queryByRole('form', { name: 'Exact crease' })).toBeNull()
  })

  test('the numeric form closes when a new gesture starts', () => {
    render(<FoldBar />)
    act(() => {
      useStudio.getState().begin([1, 0.5])
      useStudio.getState().drag([0.5, 0.5], 0.5)
    })
    fireEvent.click(screen.getByRole('button', { name: /^Edit crease numerically/ }))
    expect(screen.getByRole('form', { name: 'Exact crease' })).toBeInTheDocument()
    act(() => {
      useStudio.getState().cancel()
      useStudio.getState().begin([0, 0])
    })
    expect(screen.queryByRole('form', { name: 'Exact crease' })).toBeNull()
  })

  test('two points make a crease line; identical points are rejected; Esc closes the form', async () => {
    render(<FoldBar />)
    act(() => {
      useStudio.getState().begin([1, 0.5])
      useStudio.getState().drag([0.5, 0.5], 0.5)
    })
    fireEvent.click(screen.getByRole('button', { name: /^Edit crease numerically/ }))
    const form = screen.getByRole('form', { name: 'Exact crease' })
    const [x1, y1, x2, y2] = within(form).getAllByRole('spinbutton')
    for (const [el, val] of [[x1, '0.7'], [y1, '0'], [x2, '0.7'], [y2, '0']] as const) {
      fireEvent.change(el, { target: { value: val } })
    }
    fireEvent.click(within(form).getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The two points must differ.')
    fireEvent.change(y2, { target: { value: '1' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Apply' }))
    expect(useStudio.getState().gesture?.crease).toEqual({ origin: [0.7, 0], vector: [0, 1] })

    fireEvent.click(screen.getByRole('button', { name: /^Edit crease numerically/ }))
    expect(screen.getByRole('form', { name: 'Exact crease' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getAllByRole('spinbutton')[0]!, { key: 'Escape' })
    expect(screen.queryByRole('form', { name: 'Exact crease' })).toBeNull()
  })
})

describe('tools island', () => {
  test('R54: Top view and Reset view buttons drive the camera, with tooltips; disabled without a Stage', () => {
    const onView = vi.fn()
    const { rerender } = render(<Tools onView={onView} />)
    const view = screen.getByRole('group', { name: 'View' })
    fireEvent.click(within(view).getByRole('button', { name: 'Top view' }))
    fireEvent.click(within(view).getByRole('button', { name: 'Reset view' }))
    expect(onView.mock.calls).toEqual([['top'], ['reset']])
    expect(within(view).getByRole('button', { name: 'Top view' })).toHaveAttribute('title', 'Top view: look straight down')
    expect(within(view).getByRole('button', { name: 'Reset view' })).toHaveAttribute('title', 'Reset view: back to the studio angle')
    rerender(<Tools />)
    expect(within(view).getByRole('button', { name: 'Top view' })).toBeDisabled()
  })

  test('choosing a tool sets the tool', async () => {
    render(<Tools />)
    fireEvent.click(screen.getByRole('button', { name: 'Squash' }))
    expect(useStudio.getState().tool).toBe('squash')
    expect(screen.getByRole('button', { name: 'Squash' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Fold' })).toHaveAttribute('aria-pressed', 'false')
  })

  const commitOne = () => {
    const h = startHistory(createPaper(PAPER_SIZES.square))
    const r = commit(current(h), { ...base(), grab: [1, 1], target: [0, 0], progress: 1 })
    if (!r.ok) throw new Error(r.reason)
    act(() => useStudio.setState({ history: push(h, r.step, r.frame) }))
  }

  test('after one commit the tool returns to Fold when toolReturnsToFold is on', () => {
    render(<Tools />)
    act(() => useStudio.getState().setTool('petal'))
    commitOne()
    expect(useStudio.getState().tool).toBe('fold')
  })

  test('the tool stays when toolReturnsToFold is off', () => {
    useSettings.getState().update({ toolReturnsToFold: false })
    render(<Tools />)
    act(() => useStudio.getState().setTool('petal'))
    commitOne()
    expect(useStudio.getState().tool).toBe('petal')
  })

  test('undo and redo do not reset the tool', () => {
    render(<Tools />)
    commitOne()
    act(() => {
      useStudio.getState().undo()
      useStudio.getState().setTool('squash')
      useStudio.getState().redo()
    })
    expect(useStudio.getState().tool).toBe('squash')
  })

  test('snap toggles bind to the settings store', async () => {
    render(<Tools />)
    const corners = screen.getByRole('button', { name: 'Corners' })
    expect(corners).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(corners)
    expect(useSettings.getState().snap.corners).toBe(false)
    expect(corners).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('paper panel', () => {
  test('offers exactly 4 modes, with 5 kami swatches plus a custom colour', () => {
    render(<PaperPanel onClose={() => {}} />)
    const modes = within(screen.getByRole('group', { name: 'Material' })).getAllByRole('button')
    expect(modes.map(b => b.textContent)).toEqual([
      expect.stringContaining('Kami'), expect.stringContaining('Washi'), expect.stringContaining('Plain'), expect.stringContaining('Editor'),
    ])
    const swatches = within(screen.getByRole('group', { name: 'Colour' }))
    expect(swatches.getAllByRole('button')).toHaveLength(5)
    expect(swatches.getByLabelText('Custom colour')).toHaveAttribute('type', 'color')
  })

  test('picking a swatch and a mode updates the paper; washi offers seigaiha and asanoha', async () => {
    render(<PaperPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Indigo' }))
    expect(useStudio.getState().paper.front).toBe('#2F4A8A')
    fireEvent.click(screen.getByRole('button', { name: /Washi/ }))
    expect(useStudio.getState().paper.mode).toBe('washi')
    fireEvent.click(screen.getByRole('button', { name: 'Asanoha' }))
    expect(useStudio.getState().paper.pattern).toBe('asanoha')
    expect(screen.getByRole('button', { name: 'Seigaiha' })).toBeInTheDocument()
  })

  test('size: an empty sheet changes silently; with work an in-app dialog asks first', () => {
    const confirm = vi.spyOn(window, 'confirm')
    render(<PaperPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'A4' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useStudio.getState().paper.size).toBe('a4')

    act(() => useStudio.setState({ history: quarterFolded() }))
    fireEvent.click(screen.getByRole('button', { name: 'Square' }))
    const dialog = screen.getByRole('alertdialog')
    expect(confirm).not.toHaveBeenCalled()
    expect(useStudio.getState().paper.size).toBe('a4')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    // Esc cancels: nothing changes.
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Cancel' }), { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useStudio.getState().history.steps).toHaveLength(2)

    // Cancel button: nothing changes. Confirm: new sheet.
    fireEvent.click(screen.getByRole('button', { name: 'Square' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(useStudio.getState().paper.size).toBe('a4')
    fireEvent.click(screen.getByRole('button', { name: 'Square' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'New sheet' }))
    expect(useStudio.getState().paper.size).toBe('square')
    expect(useStudio.getState().history.steps).toHaveLength(0)
  })

  test('the dialog traps Tab and returns focus to the trigger; Esc does not also close the panel', () => {
    const onClose = vi.fn()
    act(() => useStudio.setState({ history: quarterFolded() }))
    render(<PaperPanel onClose={onClose} />)
    const trigger = screen.getByRole('button', { name: 'A4' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('alertdialog')
    const [cancel, ok] = within(dialog).getAllByRole('button')
    ok!.focus()
    fireEvent.keyDown(ok!, { key: 'Tab' })
    expect(cancel).toHaveFocus()
    fireEvent.keyDown(cancel!, { key: 'Tab', shiftKey: true })
    expect(ok).toHaveFocus()
    fireEvent.keyDown(ok!, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
  })

  test('Esc closes the panel', async () => {
    const onClose = vi.fn()
    render(<PaperPanel onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /Kami/ }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('hint line', () => {
  test('shows the first-visit hint, then the tool sentence', () => {
    render(<HintLine />)
    expect(screen.getByRole('status')).toHaveTextContent('Grab a corner and drag it across.')
    act(() => useStudio.getState().setTool('petal'))
    expect(screen.getByRole('status')).toHaveTextContent('Grab the lower point of a flap and lift it.')
  })

  test('shows the refusal text when it is set, over everything else', () => {
    render(<HintLine />)
    act(() => useStudio.setState({ refusal: 'Drag further to fold.' }))
    expect(screen.getByRole('status')).toHaveTextContent('Drag further to fold.')
  })

  test('a blocked preview reads exactly "Flap would pass through paper."', () => {
    render(<HintLine />)
    act(() => {
      const preview = { blocked: true } as never
      useStudio.setState({ preview })
    })
    expect(screen.getByRole('status')).toHaveTextContent(/^Flap would pass through paper\.$/)
  })

  test(`a commit pending for ${BUSY_AFTER_MS} ms shows "Folding…" (not before), and it clears when the commit lands`, () => {
    vi.useFakeTimers()
    render(<HintLine />)
    act(() => useStudio.setState({ pending: true }))
    act(() => vi.advanceTimersByTime(BUSY_AFTER_MS - 1))
    expect(screen.getByRole('status')).not.toHaveTextContent(FOLDING)
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('status')).toHaveTextContent(/^Folding…$/)
    expect(screen.getByRole('status')).toHaveAttribute('data-busy', '')
    act(() => useStudio.setState({ pending: false }))
    expect(screen.getByRole('status')).not.toHaveTextContent(FOLDING)
    vi.useRealTimers()
  })

  test('a slow autosave restore says so', () => {
    vi.useFakeTimers()
    render(<HintLine />)
    act(() => useStudio.setState({ pending: true, restoring: true }))
    act(() => vi.advanceTimersByTime(BUSY_AFTER_MS))
    expect(screen.getByRole('status')).toHaveTextContent(RESTORING)
    vi.useRealTimers()
  })
})

describe('top bar', () => {
  test('undo and redo are disabled per history; the wordmark is present', async () => {
    render(<TopBar paperOpen={false} onTogglePaper={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ori · 折り')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
    act(() => useStudio.setState({ history: quarterFolded() }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()
  })

  test('button tooltips name the live bindings, not hard-coded keys (item 11)', () => {
    render(
      <>
        <TopBar paperOpen={false} onTogglePaper={() => {}} />
        <Tools />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo (Ctrl/⌘ + Z)')
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveAttribute('title', 'Redo (Ctrl/⌘ + Shift + Z)')
    expect(screen.getByRole('button', { name: 'Reverse' })).toHaveAttribute('title', 'Reverse fold (R)')
    expect(screen.getByRole('button', { name: 'Turn over' })).toHaveAttribute('title', 'Turn the model over (T)')
    act(() => {
      useSettings.getState().setBinding('undo', [{ type: 'key', key: 'u', mods: { mod: true, shift: false, alt: false } }])
      useSettings.getState().setBinding('reverse', [])
    })
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo (Ctrl/⌘ + U)')
    expect(screen.getByRole('button', { name: 'Reverse' })).toHaveAttribute('title', 'Reverse fold')
  })

  test('export and settings render, disabled until wired', () => {
    render(<TopBar paperOpen={false} onTogglePaper={() => {}} />)
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeDisabled()
  })

  test('the export menu offers .fold and SVG with the grid and colour options', () => {
    const onExportFile = vi.fn()
    render(<TopBar paperOpen={false} onTogglePaper={() => {}} onExport={() => {}} onExportFile={onExportFile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('button', { name: '.fold file' }))
    expect(onExportFile).toHaveBeenLastCalledWith('fold', { grid: false, style: 'diagram' })
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Grid' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Colour/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Crease pattern (SVG)' }))
    expect(onExportFile).toHaveBeenLastCalledWith('svg', { grid: true, style: 'mv-color' })
  })
})

describe('shell', () => {
  test('islands are named landmarks and fade while a gesture is active', () => {
    const { container } = render(<App />)
    for (const name of ['Studio bar', 'Tools']) expect(screen.getByLabelText(name, { selector: '.island' })).toBeInTheDocument()
    const main = container.querySelector('.studio')!
    // The top bar is a top-level banner, beside <main> (not nested in it).
    expect(container.querySelector('main [role="banner"]')).toBeNull()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(main).not.toHaveAttribute('data-folding')
    act(() => useStudio.getState().begin([1, 1]))
    expect(main).toHaveAttribute('data-folding')
    expect(screen.getByRole('region', { name: 'Fold' })).toBeInTheDocument()
    act(() => useStudio.getState().cancel())
    expect(main).not.toHaveAttribute('data-folding')
  })

  test('the Paper button opens the paper panel', async () => {
    render(<App />)
    expect(screen.queryByRole('region', { name: 'Paper' })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /^Paper/ })[0]!)
    expect(screen.getByRole('region', { name: 'Paper' })).toBeInTheDocument()
  })
})
