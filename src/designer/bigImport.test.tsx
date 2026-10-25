// @vitest-environment jsdom
// Review Focus 4: a huge import (5,000+ creases) keeps the editor responsive.
// Parsing, building the pattern and the Kawasaki / Maekawa checks run in the
// designer worker; the main thread only takes the finished pattern, renders
// it (a handful of SVG paths, not one node per crease) and leaves 3D alone
// (too large to mirror live: detached until Fold all).
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import DesignerMode from './DesignerMode'
import { createDesignerStore } from './designerSlice'
import { handleDesignerRequest, importNow, type DesignerRequest, type DesignerWorker } from './foldAll'
import { vertexIssues } from './checks'
import { createStudioStore } from '../studio/store'
import { inProcessCommitter } from '../studio/committer'

afterEach(cleanup)

/** A 51 × 51 grid in .cp form: 5,100 creases, every interior vertex flat-foldable (3 M, 1 V, 90° sectors). */
function gridCp(n = 51): string {
  const L = 400
  const at = (i: number) => -L / 2 + (L * i) / n
  const lines = ['1 -200 -200 200 -200', '1 200 -200 200 200', '1 200 200 -200 200', '1 -200 200 -200 -200']
  for (let i = 1; i < n; i++)
    for (let j = 0; j < n; j++) {
      lines.push(`2 ${at(i)} ${at(j)} ${at(i)} ${at(j + 1)}`) // vertical: mountain
      lines.push(`${j % 2 === 0 ? 2 : 3} ${at(j)} ${at(i)} ${at(j + 1)} ${at(i)}`) // horizontal: alternating
    }
  return lines.join('\n')
}

test('importing 5,000 creases: the work runs in the worker; the UI thread is blocked ≤ 50 ms per frame', async () => {
  const text = gridCp()
  // the worker's side, timed for the record (it is off the main thread in the app)
  const t0 = performance.now()
  const built = importNow('cp', text)
  const buildMs = performance.now() - t0
  if (!built.ok) throw new Error(built.reason)
  const creases = built.cp.edges_assignment.filter(a => a !== 'B').length
  expect(creases).toBeGreaterThanOrEqual(5000)
  expect(vertexIssues(built.cp)).toEqual([])
  expect(buildMs).toBeLessThan(10_000)

  // the main thread's side: a worker stand-in that answers with the worker's results
  const asked: DesignerRequest['kind'][] = []
  const worker: DesignerWorker = {
    run: (async (req: DesignerRequest) => {
      asked.push(req.kind)
      return req.kind === 'import' ? built : handleDesignerRequest(req)
    }) as DesignerWorker['run'],
    dispose() {},
  }
  const store = createDesignerStore({ storage: null })
  const studio = createStudioStore({ committer: inProcessCommitter })
  const before = studio.getState().history
  render(<DesignerMode store={store} worker={worker} studio={studio} />)

  // every synchronous slice of main-thread work is timed: the store update, the subscribers and React's render
  const slices: number[] = []
  const realLoad = store.getState().load
  store.setState({
    load: (cp, record) => {
      const s = performance.now()
      act(() => realLoad(cp, record))
      slices.push(performance.now() - s)
    },
  })
  const file = new File([text], 'grid.cp', { type: 'text/plain' })
  fireEvent.change(screen.getByLabelText('Import a crease pattern'), { target: { files: [file] } })
  expect(await screen.findByText(`Imported ${creases} creases from grid.cp.`)).toBeInTheDocument()
  await waitFor(() => expect(asked).toContain('checks'))

  expect(asked[0]).toBe('import')
  expect(slices).toHaveLength(1)
  expect(slices[0]).toBeLessThanOrEqual(50)
  console.info(`[import] ${creases} creases: built in ${buildMs.toFixed(0)} ms (worker); main-thread load + render ${slices[0]!.toFixed(1)} ms`)
  // the editor draws the pattern as a few paths, and 3D is not rebuilt per edit for a pattern this size
  const svg = screen.getByRole('application', { name: /Crease pattern editor/ })
  expect(svg.querySelectorAll('path').length).toBeLessThanOrEqual(4)
  expect(store.getState().detached).toBe(true)
  expect(studio.getState().history).toBe(before)
  expect(screen.getByText('This pattern is large: the 3D view shows it when you Fold all.')).toBeInTheDocument()
})
