// @vitest-environment jsdom
// The first-visit coach mark (spec 03 "a single dismissible coach mark points
// at a corner, then never shows again"; R55).
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { COACH_KEY, COACH_TEXT, CoachMark, resetCoachForTests } from './CoachMark'
import { useStudio } from './store'
import { inProcessCommitter } from './committer'
import { createStudioStore } from './store'

const INITIAL = useStudio.getInitialState()
const stage = { clientOf: vi.fn((p: readonly [number, number]) => [100 + p[0] * 200, 500 - p[1] * 200] as [number, number]) }

beforeEach(() => {
  localStorage.clear()
  resetCoachForTests()
  useStudio.setState({ ...INITIAL }, true)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('coach mark', () => {
  test('first visit: a note points at the top-right corner of the sheet', () => {
    render(<CoachMark stage={stage} reduced={false} />)
    const note = screen.getByRole('note', { name: 'Tip' })
    expect(note).toHaveTextContent(COACH_TEXT)
    expect(stage.clientOf).toHaveBeenCalledWith([1, 1])
    expect(note.parentElement).toHaveStyle({ left: '300px', top: '300px' }) // the anchor sits on the corner
    expect(note.parentElement).toHaveAttribute('data-motion', '')
  })

  test('"Got it" dismisses it for good (persisted)', () => {
    const { unmount } = render(<CoachMark stage={stage} reduced={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('note')).toBeNull()
    expect(localStorage.getItem(COACH_KEY)).toBe('1')
    unmount()
    render(<CoachMark stage={stage} reduced={false} />)
    expect(screen.queryByRole('note')).toBeNull()
  })

  test('the first fold dismisses it for good too', async () => {
    render(<CoachMark stage={stage} reduced={false} />)
    const s = createStudioStore({ committer: inProcessCommitter })
    s.getState().begin([1, 1])
    s.getState().drag([0, 0], 1)
    await s.getState().release()
    act(() => useStudio.setState({ history: s.getState().history }))
    expect(screen.queryByRole('note')).toBeNull()
    expect(localStorage.getItem(COACH_KEY)).toBe('1')
  })

  test('not shown without a Stage, on a model with steps, or once dismissed', () => {
    const { unmount } = render(<CoachMark stage={null} reduced={false} />)
    expect(screen.queryByRole('note')).toBeNull()
    unmount()
    localStorage.setItem(COACH_KEY, '1') // dismissed on an earlier visit
    render(<CoachMark stage={stage} reduced={false} />)
    expect(screen.queryByRole('note')).toBeNull()
  })

  test('reduced motion: no pulse', () => {
    render(<CoachMark stage={stage} reduced />)
    expect(screen.getByRole('note').parentElement).not.toHaveAttribute('data-motion')
  })

  test('blocked storage: still shown, still dismissible (in memory)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    render(<CoachMark stage={stage} reduced={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('note')).toBeNull()
  })
})
