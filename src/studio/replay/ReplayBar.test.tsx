// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PRESETS, runPreset } from '../../presets'
import { useSettings, defaultSettings } from '../../settings/store'
import { useStudio } from '../store'
import { ReplayBar } from './ReplayBar'
import { drawView } from './draw'
import { Player } from './Player'

const INITIAL = useStudio.getInitialState()
const cup = () => {
  const r = runPreset(PRESETS.find(p => p.id === 'cup')!)
  if (!r.ok) throw new Error(r.reason)
  return r.history
}

function fakeStage() {
  return {
    setFrame: vi.fn(),
    setPreview: vi.fn(),
    fitModel: vi.fn(),
  }
}

beforeEach(() => {
  useStudio.setState({ ...INITIAL, history: cup() }, true)
  useStudio.getState().setReplaying(true)
  // Reduced motion off, so the scrub is continuous.
  useSettings.setState({ ...defaultSettings(), reducedMotion: 'never' })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useSettings.setState(defaultSettings())
})

describe('ReplayBar', () => {
  test('is a labelled region with named controls and a scrub slider reading "Step N of M"', () => {
    const stage = fakeStage()
    render(<ReplayBar stage={stage} onExit={() => {}} />)
    const bar = screen.getByRole('region', { name: 'Replay' })
    expect(within(bar).getByRole('button', { name: 'Pause' })).toBeInTheDocument() // it starts playing
    const slider = within(bar).getByRole('slider', { name: 'Replay position' })
    expect(slider).toHaveAttribute('aria-valuetext', 'Step 0 of 6')
    const speeds = within(bar).getByRole('group', { name: 'Speed' })
    expect(within(speeds).getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(bar).getByRole('checkbox', { name: 'Auto-frame camera' })).not.toBeChecked()
    expect(within(bar).getByRole('button', { name: 'Exit replay' })).toBeInTheDocument()
    // The first view is drawn at once: the blank sheet.
    expect(stage.setFrame).toHaveBeenLastCalledWith(cup().frames[0], expect.any(Array))
  })

  test('scrubbing to 2.5 draws frames[2] with step 3 swinging as solid paper', () => {
    const stage = fakeStage()
    render(<ReplayBar stage={stage} onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const slider = screen.getByRole('slider', { name: 'Replay position' })
    fireEvent.change(slider, { target: { value: '2.5' } })
    expect(slider).toHaveAttribute('aria-valuetext', 'Step 3 of 6')
    const [, style] = stage.setPreview.mock.lastCall!
    expect(stage.setPreview.mock.lastCall![0]).not.toBeNull()
    expect(style).toMatchObject({ solid: true, tool: 'fold' })
    expect(useStudio.getState().history.cursor).toBe(6) // replay never touches the history
  })

  test('arrow keys on the slider move whole steps; speed and auto-frame toggle', () => {
    const stage = fakeStage()
    render(<ReplayBar stage={stage} onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const slider = screen.getByRole('slider', { name: 'Replay position' })
    fireEvent.change(slider, { target: { value: '2.5' } })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider).toHaveAttribute('aria-valuetext', 'Step 3 of 6')
    expect(Number((slider as HTMLInputElement).value)).toBe(3)
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(Number((slider as HTMLInputElement).value)).toBe(2)
    fireEvent.keyDown(slider, { key: 'End' })
    expect(Number((slider as HTMLInputElement).value)).toBe(6)
    fireEvent.click(screen.getByRole('button', { name: '2×' }))
    expect(screen.getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-frame camera' }))
    expect(stage.fitModel).toHaveBeenCalled()
  })

  test('Esc and the Exit button leave replay', () => {
    const onExit = vi.fn()
    render(<ReplayBar stage={fakeStage()} onExit={onExit} />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onExit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Exit replay' }))
    expect(onExit).toHaveBeenCalledTimes(2)
  })
})

test('Exit stops the Player before leaving: no replay frame draws after the restore', () => {
  let frameCb: FrameRequestCallback | null = null
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameCb = cb
    return 1
  })
  const stage = fakeStage()
  let drawsAtExit = -1
  render(<ReplayBar stage={stage} onExit={() => { drawsAtExit = stage.setFrame.mock.calls.length }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Exit replay' }))
  expect(drawsAtExit).toBeGreaterThan(0)
  ;(frameCb as FrameRequestCallback | null)?.(performance.now() + 5000)
  expect(stage.setFrame.mock.calls.length).toBe(drawsAtExit)
})

describe('drawView', () => {
  test('a whole step clears the swing once; auto-frame re-frames when the frame changes', () => {
    const h = cup()
    const p = new Player(h, { reduced: () => false })
    const stage = fakeStage()
    const draw = drawView(stage, () => true)
    draw(p.viewAt(1))
    draw(p.viewAt(1.5))
    draw(p.viewAt(2))
    draw(p.viewAt(2))
    expect(stage.setPreview.mock.calls.map(c => c[0] === null)).toEqual([true, false, true])
    expect(stage.fitModel).not.toHaveBeenCalled()
    draw({ ...p.viewAt(3), autoFrame: true })
    expect(stage.fitModel).toHaveBeenCalledTimes(1)
    draw({ ...p.viewAt(3), autoFrame: true })
    expect(stage.fitModel).toHaveBeenCalledTimes(1)
  })
})
