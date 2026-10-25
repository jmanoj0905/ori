// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Frame } from '@engine'
import DesignerMode from './DesignerMode'
import { createDesignerStore } from './designerSlice'
import { waterbombBase } from './fixtures'
import { emptyCP } from './cp'

afterEach(cleanup)

test('issues are listed and highlighted on their vertices with a tooltip; fixing them clears the list', async () => {
  const store = createDesignerStore({ storage: null })
  render(<DesignerMode store={store} />)
  expect(await screen.findByText('Kawasaki and Maekawa hold at every vertex.')).toBeInTheDocument()
  act(() => store.getState().addSegment([0, 0.5], [0.6, 0.5]))
  const panel = screen.getByRole('region', { name: 'Flat-foldability' })
  await waitFor(() => expect(panel).toHaveTextContent('1 vertex issue'))
  expect(panel).toHaveTextContent(/v\d+ \(0\.6000, 0\.5000\) Kawasaki: an odd number of folded creases \(1\) meet here\. Maekawa: 0 mountains and 1 valley; \|M − V\| must be 2\./)
  const mark = document.querySelector('.cp-issue')!
  expect(mark.querySelector('title')).toHaveTextContent(/Maekawa/)
  act(() => store.getState().undo())
  await waitFor(() => expect(panel).toHaveTextContent('Kawasaki and Maekawa hold at every vertex.'))
  expect(document.querySelector('.cp-issue')).toBeNull()
})

test('the checks are debounced: a burst of edits is checked once', async () => {
  vi.useFakeTimers()
  const store = createDesignerStore({ storage: null })
  const run = vi.fn(async (_req: unknown) => [])
  render(<DesignerMode store={store} worker={{ run: run as never, dispose() {} }} />)
  await act(async () => {
    for (let i = 1; i < 6; i++) store.getState().addSegment([0, i / 6], [1, i / 6])
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(run).toHaveBeenCalledTimes(1)
  expect(run.mock.calls[0]![0]).toMatchObject({ kind: 'checks' })
  vi.useRealTimers()
})

test('Fold all hands the folded frame over; a refusal is shown', async () => {
  const store = createDesignerStore({ storage: null })
  const folded: Frame[] = []
  render(<DesignerMode store={store} onFolded={f => folded.push(f)} />)
  act(() => store.getState().load(waterbombBase()))
  fireEvent.click(screen.getByRole('button', { name: 'Fold all' }))
  await waitFor(() => expect(folded).toHaveLength(1))
  expect(screen.getByText(/Folded flat: \d+ faces\./)).toBeInTheDocument()
  act(() => store.getState().load(emptyCP({ width: 1, height: 1 })))
  act(() => store.getState().addSegment([0, 0.5], [0.6, 0.5]))
  fireEvent.click(screen.getByRole('button', { name: 'Fold all' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/not flat-foldable\. Check vertices \d+\./)
  expect(folded).toHaveLength(1)
})
