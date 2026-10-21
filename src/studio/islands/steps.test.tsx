// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PAPER_SIZES, commit, createPaper, current, push, startHistory } from '@engine'
import type { Gesture, History } from '@engine'
import { DASH } from '../../render/creases'
import { PRESETS } from '../../presets'
import { handleRequest } from '../committer'
import { setReducedMotionSource } from '../motion'
import { useStudio } from '../store'
import { useSettings, defaultSettings } from '../../settings/store'
import { MINI_DASH, MiniCP } from './MiniCP'
import { Steps } from './Steps'

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
const g = (o: Partial<Gesture>): Gesture => ({ tool: 'fold', grab: [0, 0], target: [0, 0], layers: 1, kind: 'valley', progress: 1, snapAngle: false, ...o })

/** Valley + mountain + valley on the square. */
function threeFolds(): History {
  let h = startHistory(createPaper(PAPER_SIZES.square))
  const gs = [
    g({ grab: [1, 0.5], target: [0.5, 0.5] }),
    g({ kind: 'mountain', grab: [0.5, 0], target: [0.5, 0.25] }),
    g({ grab: [0, 1], target: [0, 0.75] }),
  ]
  for (const x of gs) {
    const r = commit(current(h), x)
    if (!r.ok) throw new Error(r.reason)
    h = push(h, r.step, r.frame)
  }
  return h
}

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker)
  setReducedMotionSource(() => true)
  useStudio.setState({ ...INITIAL }, true)
  useSettings.setState(defaultSettings())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('step list', () => {
  test('lists "N · label" and disables steps after the cursor', () => {
    const h = threeFolds()
    useStudio.setState({ history: h })
    act(() => useStudio.getState().jumpTo(1))
    render(<Steps />)
    const list = screen.getByRole('list', { name: 'Fold steps' })
    const items = within(list).getAllByRole('button')
    expect(items.map(b => b.textContent)).toEqual(['0 · Blank sheet', ...h.steps.map((s, i) => `${i + 1} · ${s.label}`)])
    expect(items[1]).not.toHaveAttribute('aria-disabled')
    expect(items[2]).toHaveAttribute('aria-disabled', 'true')
    expect(items[3]).toHaveAttribute('aria-disabled', 'true')
  })

  test('clicking a step jumps there (future steps too)', () => {
    useStudio.setState({ history: threeFolds() })
    render(<Steps />)
    fireEvent.click(screen.getByRole('button', { name: /^1 · / }))
    expect(useStudio.getState().history.cursor).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /^3 · / }))
    expect(useStudio.getState().history.cursor).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: /^0 · / }))
    expect(useStudio.getState().history.cursor).toBe(0)
  })

  test('a fold after jumping back shows "Redo history cleared" with Undo', async () => {
    const h = threeFolds()
    useStudio.setState({ history: h })
    act(() => useStudio.getState().jumpTo(1))
    const before = useStudio.getState().history
    render(<Steps />)
    expect(screen.queryByText('Redo history cleared')).toBeNull()
    await act(async () => {
      useStudio.getState().begin([0, 0.5])
      useStudio.getState().drag([0.2, 0.5], 1)
      await useStudio.getState().release()
    })
    expect(useStudio.getState().history.frames).toHaveLength(3)
    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('Redo history cleared')
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(useStudio.getState().history).toBe(before)
    expect(useStudio.getState().history.frames).toHaveLength(4)
    expect(useStudio.getState().history.cursor).toBe(1)
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('redo toast accuracy', () => {
  test('a plain redo or jump to the last step shows no toast', () => {
    useStudio.setState({ history: threeFolds() })
    act(() => useStudio.getState().jumpTo(2))
    render(<Steps />)
    act(() => useStudio.getState().redo())
    expect(useStudio.getState().history.cursor).toBe(3)
    expect(screen.queryByRole('status')).toBeNull()
    act(() => useStudio.getState().jumpTo(2))
    act(() => useStudio.getState().jumpTo(3))
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('toast Undo clears an active gesture', async () => {
    useStudio.setState({ history: threeFolds() })
    act(() => useStudio.getState().jumpTo(1))
    render(<Steps />)
    await act(async () => {
      useStudio.getState().begin([0, 0.5])
      useStudio.getState().drag([0.2, 0.5], 1)
      await useStudio.getState().release()
    })
    act(() => useStudio.getState().begin([0.5, 0.5]))
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }))
    expect(useStudio.getState().gesture).toBeNull()
    expect(useStudio.getState().history.frames).toHaveLength(4)
  })
})

describe('MiniCP', () => {
  test('valley is dashed 6 4, mountain dash-dot 6 3 1.5 3, boundary solid, same ink', () => {
    expect(MINI_DASH.valley).toBe(DASH.valley.join(' '))
    expect(MINI_DASH.mountain).toBe(DASH.mountain.join(' '))
    const { container } = render(<MiniCP frame={current(threeFolds())} />)
    expect(container.querySelectorAll('line[stroke-dasharray="6 4"]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('line[stroke-dasharray="6 3 1.5 3"]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.cp-boundary').length).toBeGreaterThanOrEqual(4)
    expect(container.querySelector('.cp-boundary')).not.toHaveAttribute('stroke-dasharray')
  })

  test('updates live with the history cursor', () => {
    useStudio.setState({ history: threeFolds() })
    const { container } = render(<Steps />)
    const n = () => container.querySelectorAll('.mini-cp line').length
    const full = n()
    act(() => useStudio.getState().jumpTo(0))
    expect(n()).toBeLessThan(full)
    expect(container.querySelectorAll('.mini-cp line[stroke-dasharray]')).toHaveLength(0)
  })
})

describe('presets', () => {
  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

  test('with work present and confirmPresetReplace on, a confirm dialog shows first', async () => {
    useStudio.setState({ history: threeFolds() })
    render(<Steps />)
    click('Cup')
    const dlg = screen.getByRole('alertdialog')
    expect(useStudio.getState().history.steps).toHaveLength(3) // not replaced yet
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useStudio.getState().history.steps).toHaveLength(3)
    click('Cup')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Play preset' }))
    const cup = PRESETS.find(p => p.id === 'cup')!
    await waitFor(() => expect(useStudio.getState().history.steps).toHaveLength(cup.steps.length))
  })

  test('no dialog on an empty sheet or when the setting is off', async () => {
    render(<Steps />)
    click('Cup')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const cup = PRESETS.find(p => p.id === 'cup')!
    await waitFor(() => expect(useStudio.getState().history.steps).toHaveLength(cup.steps.length))
    useSettings.setState({ confirmPresetReplace: false })
    click('Paper plane')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const plane = PRESETS.find(p => p.id === 'plane')!
    await waitFor(() => expect(useStudio.getState().history.steps).toHaveLength(plane.steps.length))
  })

  test('choosing a preset mid-gesture cancels the gesture first, then the dialog shows', () => {
    useStudio.setState({ history: threeFolds() })
    render(<Steps />)
    act(() => {
      useStudio.getState().begin([0, 0.5])
      useStudio.getState().drag([0.2, 0.5], 0.5)
    })
    expect(useStudio.getState().gesture).not.toBeNull()
    click('Crane')
    expect(useStudio.getState().gesture).toBeNull()
    expect(useStudio.getState().preview).toBeNull()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  test('starting a new preset aborts the running one; Stop ends playback', async () => {
    setReducedMotionSource(() => false) // real waits between steps
    useSettings.setState({ confirmPresetReplace: false })
    render(<Steps />)
    click('Crane')
    const stop = await screen.findByRole('button', { name: 'Stop' })
    await waitFor(() => expect(useStudio.getState().history.steps.length).toBeGreaterThan(0))
    click('Paper plane')
    await waitFor(() => expect(useStudio.getState().history.steps.length).toBeLessThanOrEqual(1))
    expect(useStudio.getState().history.steps.length).toBeLessThan(PRESETS.find(p => p.id === 'plane')!.steps.length)
    expect(screen.getByRole('button', { name: 'Paper plane' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Crane' })).toHaveAttribute('aria-pressed', 'false')
    void stop
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    const n = useStudio.getState().history.steps.length
    await new Promise(r => setTimeout(r, 700))
    expect(useStudio.getState().history.steps.length).toBeLessThanOrEqual(n + 1) // at most the in-flight commit
  })
})
