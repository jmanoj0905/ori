// @vitest-environment jsdom
// The lesson UI: the menu, the outline that replaces the steps island, the
// summary, and the Tools island's expected-tool highlight (Plan 4 Task 3).
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Vec2 } from '@engine'
import { handleRequest } from '../studio/committer'
import { setReducedMotionSource } from '../studio/motion'
import { useStudio } from '../studio/store'
import { useSettings, defaultSettings } from '../settings/store'
import { Tools } from '../studio/islands/Tools'
import { FoldBar } from '../studio/islands/FoldBar'
import { Steps } from '../studio/islands/Steps'
import { App } from '../studio/App'
import { useUi } from '../studio/ui'
import LessonOutline from './LessonOutline'
import { LessonMenu } from './LessonMenu'
import { TURN_CONFIRM } from './lessonSlice'
import { bundledLessons } from './schema'

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
const h = 2 - Math.SQRT2

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker)
  setReducedMotionSource(() => true)
  useStudio.setState({ ...INITIAL }, true)
  useSettings.setState(defaultSettings())
  useUi.setState({ stage: 'ready', kf: 'idle', sheet: null })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function start(id = 'cup') {
  let ok = false
  await act(async () => {
    ok = await useStudio.getState().startLesson(id)
  })
  expect(ok).toBe(true)
}

async function fold(grab: Vec2, target: Vec2, layers = 1) {
  await act(async () => {
    const s = useStudio.getState()
    s.begin(grab)
    useStudio.getState().setLayers(layers)
    useStudio.getState().drag(target, 1)
    await useStudio.getState().release()
  })
}

describe('lesson menu', () => {
  test('lists the five launch lessons with their difficulty', () => {
    render(<LessonMenu onPick={() => {}} />)
    const menu = screen.getByRole('group', { name: 'Lessons' })
    const names = within(menu).getAllByRole('button').map(b => b.textContent)
    expect(names).toHaveLength(5)
    expect(names[0]).toMatch(/^Waterbomb base/)
    expect(within(menu).getByRole('button', { name: /Crane.*difficulty 3 of 3/ })).toBeInTheDocument()
  })

  test('a lesson whose file fails validation is hidden with a console error; the others still show (Review Focus 4)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const raws = bundledLessons().map(r => JSON.parse(JSON.stringify(r)))
    delete raws[1].steps[0].target // break the plane
    raws.push('{ not json at all')
    render(<LessonMenu onPick={() => {}} raws={raws} />)
    const names = within(screen.getByRole('group', { name: 'Lessons' })).getAllByRole('button').map(b => b.textContent ?? '')
    expect(names.some(n => n.startsWith('Paper plane'))).toBe(false)
    expect(names).toHaveLength(4)
    expect(err).toHaveBeenCalledTimes(2)
  })

  test('the Steps island opens the menu; picking a lesson with work present asks first, then starts it', async () => {
    render(<Steps />)
    await fold([1, 1], [0, 0])
    fireEvent.click(screen.getByRole('button', { name: 'Lessons' }))
    const pick = within(await screen.findByRole('group', { name: 'Lessons' })).getByRole('button', { name: /^Cup/ })
    fireEvent.click(pick)
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Starting a lesson starts a new sheet and replaces your folds.')
    fireEvent.click(screen.getByRole('button', { name: 'Start lesson' }))
    await waitFor(() => expect(useStudio.getState().lesson?.id).toBe('cup'))
    expect(useStudio.getState().history.steps).toHaveLength(0)
  })
})

describe('lesson outline', () => {
  test('the steps island becomes the outline: done, current and upcoming, with the caption', async () => {
    render(<App />)
    await start('cup')
    const outline = await screen.findByRole('region', { name: 'Lesson' })
    expect(screen.queryByRole('list', { name: 'Fold steps' })).toBeNull()
    expect(within(outline).getByRole('heading', { name: 'Cup' })).toBeInTheDocument()
    const caption = useStudio.getState().lessonData!.steps[0]!.caption
    expect(within(outline).getByText(caption, { selector: '.lesson-caption' })).toBeInTheDocument()
    await fold([0, 0], [1, 1])
    const items = within(within(outline).getByRole('list', { name: 'Lesson steps' })).getAllByRole('button')
    expect(items).toHaveLength(6)
    expect(items[0]).toHaveAccessibleName(/^1 · .*\(done\)$/)
    expect(items[1]).toHaveAttribute('aria-current', 'step')
    expect(items[2]).toBeDisabled()
    expect(within(outline).getByText('Well folded.')).toBeInTheDocument()
  })

  test('the hint shows only from the 2nd miss', async () => {
    render(<LessonOutline />)
    await start('cup')
    const hint = useStudio.getState().lessonData!.steps[0]!.hint
    await fold([0.5, 1], [0.5, 0])
    expect(screen.queryByText(hint)).toBeNull()
    expect(screen.getByText(/that fold doesn’t match/)).toBeInTheDocument()
    await fold([0.5, 1], [0.5, 0])
    expect(screen.getByText(hint)).toBeInTheDocument()
  })

  test('jumping back in the outline rewinds the lesson (Review Focus 2)', async () => {
    render(<LessonOutline />)
    await start('cup')
    await fold([0, 0], [1, 1])
    await fold([1, 0], [h, 1], 2)
    expect(useStudio.getState().lesson!.index).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: /^1 · / }))
    expect(useStudio.getState().lesson!.index).toBe(0)
    expect(useStudio.getState().history.cursor).toBe(0)
    expect(screen.getByRole('button', { name: /^1 · / })).toHaveAttribute('aria-current', 'step')
  })

  test('Show me and Skip step are buttons (keyboard reachable); a skip is marked', async () => {
    render(<LessonOutline />)
    await start('cup')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show me' }))
    })
    expect(useStudio.getState().lesson!.index).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Skip step' }))
    expect(useStudio.getState().lesson).toMatchObject({ index: 1, skipped: [0] })
    expect(screen.getByRole('button', { name: /^1 · .*\(skipped\)$/ })).toBeInTheDocument()
  })

  test('an unexpected turn over asks in a dialog; Turn over confirms it', async () => {
    render(<LessonOutline />)
    await start('cup')
    await act(async () => {
      await useStudio.getState().turnOver()
    })
    const dlg = screen.getByRole('alertdialog')
    expect(dlg).toHaveTextContent(TURN_CONFIRM)
    await act(async () => {
      fireEvent.click(within(dlg).getByRole('button', { name: 'Turn over' }))
    })
    await waitFor(() => expect(useStudio.getState().history.steps.map(s => s.kind)).toEqual(['turnOver']))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  test('the summary shows done, skipped and time, with "Fold it again" and "Free fold from here"', async () => {
    let t = 0
    vi.spyOn(Date, 'now').mockImplementation(() => t)
    render(<LessonOutline />)
    await start('waterbomb')
    t = 83_000
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Skip step' }))
    // the last squash, folded
    const last = useStudio.getState().lessonData!.steps[4]!.demo!
    await act(async () => {
      useStudio.getState().setTool('squash')
    })
    await fold(last.grab, last.target)
    const summary = screen.getByRole('group', { name: 'Lesson summary' })
    expect(summary).toHaveTextContent('Steps done1')
    expect(summary).toHaveTextContent('Skipped4')
    expect(summary).toHaveTextContent('Time1 min 23 s')
    const model = useStudio.getState().history
    fireEvent.click(within(summary).getByRole('button', { name: 'Free fold from here' }))
    expect(useStudio.getState().lesson).toBeNull()
    expect(useStudio.getState().history).toBe(model)

    await start('waterbomb')
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: 'Skip step' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fold it again' }))
    })
    await waitFor(() => expect(useStudio.getState().lesson).toMatchObject({ id: 'waterbomb', index: 0, skipped: [] }))
    expect(useStudio.getState().history.steps).toHaveLength(0)
  })

  test('Exit lesson keeps the model', async () => {
    render(<LessonOutline />)
    await start('cup')
    await fold([0, 0], [1, 1])
    const model = useStudio.getState().history
    fireEvent.click(screen.getByRole('button', { name: 'Exit lesson' }))
    expect(useStudio.getState().lesson).toBeNull()
    expect(useStudio.getState().history).toBe(model)
  })
})

describe('fold bar in a lesson', () => {
  test('a checked lesson step offers no post-release slider (it could not be re-committed)', async () => {
    const { container } = render(<FoldBar />)
    await start('cup')
    await fold([0, 0], [1, 1])
    expect(useStudio.getState().lesson!.index).toBe(1)
    expect(container).toBeEmptyDOMElement()
    act(() => useStudio.getState().exitLesson())
    expect(container).not.toBeEmptyDOMElement() // in the sandbox the last fold is editable again
  })
})

describe('expected tool', () => {
  test('in a lesson the expected tool is highlighted and the others are dimmed', async () => {
    render(<Tools />)
    const fold = screen.getByRole('button', { name: 'Fold' })
    expect(fold).not.toHaveAttribute('data-lesson')
    await start('waterbomb')
    expect(fold).toHaveAttribute('data-lesson', 'expected')
    for (const name of ['Reverse', 'Squash', 'Petal', 'Turn over']) expect(screen.getByRole('button', { name })).toHaveAttribute('data-lesson', 'dimmed')
    // still usable: dimmed, not disabled
    expect(screen.getByRole('button', { name: 'Squash' })).toBeEnabled()
    act(() => {
      useStudio.getState().skipStep()
      useStudio.getState().skipStep()
    })
    expect(screen.getByRole('button', { name: 'Squash' })).toHaveAttribute('data-lesson', 'expected')
    expect(fold).toHaveAttribute('data-lesson', 'dimmed')
    act(() => useStudio.getState().skipStep())
    expect(screen.getByRole('button', { name: 'Turn over' })).toHaveAttribute('data-lesson', 'expected')
    act(() => useStudio.getState().exitLesson())
    expect(fold).not.toHaveAttribute('data-lesson')
  })
})
