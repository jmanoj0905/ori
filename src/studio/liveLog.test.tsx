// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PAPER_SIZES, commit, createPaper, current, push, startHistory } from '@engine'
import type { Gesture } from '@engine'
import { announce, clearAnnouncements } from './announce'
import { LiveLog } from './LiveLog'
import { useStudio } from './store'
import { BLOCKED_HINT } from './islands/HintLine'

const INITIAL = useStudio.getInitialState()
const g = (over: Partial<Gesture>): Gesture => ({
  tool: 'fold', grab: [1, 1], target: [0, 0], layers: 1, kind: 'valley', progress: 1, snapAngle: false, ...over,
})
const fold = (h = startHistory(createPaper(PAPER_SIZES.square)), over: Partial<Gesture> = {}) => {
  const r = commit(current(h), g(over))
  if (!r.ok) throw new Error(r.reason)
  return push(h, r.step, r.frame)
}

beforeEach(() => {
  useStudio.setState({ ...INITIAL }, true)
  clearAnnouncements()
})
afterEach(cleanup)

describe('live log', () => {
  test('is a polite live region', () => {
    render(<LiveLog />)
    const log = screen.getByRole('log', { name: 'Fold log' })
    expect(log).toHaveAttribute('aria-live', 'polite')
  })

  test('announce() writes to it, and repeats are written again', () => {
    render(<LiveLog />)
    act(() => announce('Hello'))
    act(() => announce('Hello'))
    expect(screen.getAllByText('Hello')).toHaveLength(2)
  })

  test('a committed fold is read as "Step 1: valley fold, top flap, 1 layer, 180 degrees."', () => {
    render(<LiveLog />)
    act(() => useStudio.setState({ history: fold() }))
    expect(screen.getByText('Step 1: valley fold, top flap, 1 layer, 180 degrees.')).toBeInTheDocument()
  })

  test('mountain folds and the step number follow the history', () => {
    render(<LiveLog />)
    const h1 = fold()
    act(() => useStudio.setState({ history: h1 }))
    const h2 = fold(h1, { grab: [0, 1], target: [0, 0.5], kind: 'mountain' })
    act(() => useStudio.setState({ history: h2 }))
    expect(screen.getByText(/^Step 2: mountain fold, top flap, \d layers?, \d+(\.\d)? degrees\.$/)).toBeInTheDocument()
  })

  test('refusals are announced, once per new refusal', () => {
    render(<LiveLog />)
    act(() => useStudio.setState({ refusal: 'Drag further to fold.' }))
    act(() => useStudio.setState({ refusal: 'Drag further to fold.' }))
    expect(screen.getAllByText('Drag further to fold.')).toHaveLength(1)
    act(() => useStudio.setState({ refusal: null }))
    act(() => useStudio.setState({ refusal: 'Flap would pass through paper.' }))
    expect(screen.getByText('Flap would pass through paper.')).toBeInTheDocument()
  })

  test('undo and redo are announced with the step they land on', () => {
    useStudio.setState({ history: fold() })
    render(<LiveLog />)
    act(() => useStudio.getState().undo())
    expect(screen.getByText('Undone. Back to the blank sheet.')).toBeInTheDocument()
    act(() => useStudio.getState().redo())
    expect(screen.getByText('Redone. Now at step 1.')).toBeInTheDocument()
  })

  test('a blocked preview is announced', () => {
    render(<LiveLog />)
    expect(BLOCKED_HINT).toBe('Flap would pass through paper.')
    act(() => {
      useStudio.setState({ preview: { blocked: true } as never })
    })
    expect(screen.getByText(BLOCKED_HINT)).toBeInTheDocument()
  })

  test('keeps only the most recent entries', () => {
    render(<LiveLog />)
    act(() => {
      for (let i = 0; i < 50; i++) announce(`m${i}`)
    })
    expect(screen.queryByText('m0')).toBeNull()
    expect(screen.getByText('m49')).toBeInTheDocument()
    vi.useRealTimers()
  })
})
