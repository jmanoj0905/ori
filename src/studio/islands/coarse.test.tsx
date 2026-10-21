// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Gesture } from '@engine'
import { useStudio } from '../store'
import { FoldBar } from './FoldBar'

const INITIAL = useStudio.getInitialState()
const gesture = (): Gesture => ({ tool: 'fold', grab: [0.5, 0.5], target: [0.5, 0.5], layers: 1, kind: 'valley', progress: 0, snapAngle: false })

const media = (coarse: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('coarse') ? coarse : false, media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }))

beforeEach(() => useStudio.setState({ ...INITIAL }, true))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('fold bar layer stepper on touch', () => {
  test('a coarse pointer marks the bar for touch and the - / + buttons call setLayers', () => {
    media(true)
    useStudio.setState({ gesture: { ...gesture(), layers: 2 } })
    render(<FoldBar />)
    expect(screen.getByRole('region', { name: 'Fold' })).toHaveAttribute('data-coarse')
    const spy = vi.fn()
    act(() => useStudio.setState({ setLayers: spy }))
    fireEvent.click(screen.getByRole('button', { name: 'Fewer layers' }))
    expect(spy).toHaveBeenCalledWith(1)
  })

  test('a fine pointer leaves the bar unmarked', () => {
    media(false)
    useStudio.setState({ gesture: gesture() })
    render(<FoldBar />)
    expect(screen.getByRole('region', { name: 'Fold' })).not.toHaveAttribute('data-coarse')
  })

  test('the mark follows the pointer capability changing', () => {
    let listener: (() => void) | undefined
    const mql = { matches: false, addEventListener: (_: string, l: () => void) => (listener = l), removeEventListener() {} }
    vi.stubGlobal('matchMedia', () => mql)
    useStudio.setState({ gesture: gesture() })
    render(<FoldBar />)
    mql.matches = true
    act(() => listener?.())
    expect(screen.getByRole('region', { name: 'Fold' })).toHaveAttribute('data-coarse')
  })
})

describe('bottom sheet', () => {
  test('keeps its landmarks; the handle toggles the steps and paper panels', async () => {
    const { App } = await import('../App')
    render(<App />)
    const handle = screen.getByRole('button', { name: /Steps, presets and paper/ })
    expect(handle).toHaveAttribute('aria-expanded', 'false')
    for (const name of ['Tools']) expect(screen.queryByRole('region', { name }) ?? screen.queryByLabelText(name)).not.toBeNull()
    fireEvent.click(handle)
    expect(handle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('dock-body')).toBeInTheDocument()
  })
})
