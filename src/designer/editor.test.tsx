// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Editor } from './Editor'
import { DesignerTools } from './DesignerTools'
import { NumericInput } from './DesignerMode'
import { DESIGNER_KEY, SAVE_MS, createDesignerStore, type DesignerStore } from './designerSlice'
import { creaseEdges } from './cp'

afterEach(cleanup)

/** A 440 × 440 px editor at the page origin: the unit sheet plus a 0.04 pad maps to 400 px. */
function layout(svg: Element) {
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 432, height: 432, right: 432, bottom: 432, x: 0, y: 0, toJSON() {} } as DOMRect)
}
/** Client position of paper point (x, y) (y up). */
const at = (x: number, y: number) => ({ clientX: (x + 0.04) * 400, clientY: (1 + 0.04 - y) * 400 })

function setup(store: DesignerStore = createDesignerStore({ storage: null })) {
  render(
    <>
      <DesignerTools store={store} />
      <Editor store={store} />
      <NumericInput store={store} />
    </>,
  )
  const svg = screen.getByRole('application', { name: /Crease pattern editor/ })
  layout(svg)
  return { store, svg }
}

const has = (store: DesignerStore, a: [number, number], b: [number, number]) => {
  const { cp } = store.getState()
  return creaseEdges(cp).some(e => {
    const [u, v] = cp.edges_vertices[e]!
    const p = cp.vertices_coords[u]!
    const q = cp.vertices_coords[v]!
    const eq = (x: readonly number[], y: number[]) => Math.abs(x[0]! - y[0]!) < 1e-12 && Math.abs(x[1]! - y[1]!) < 1e-12
    return (eq(p, a) && eq(q, b)) || (eq(p, b) && eq(q, a))
  })
}

describe('the crease pattern editor', () => {
  test('clicking two grid points with the line tool adds a crease', () => {
    const { store, svg } = setup()
    expect(screen.getByRole('button', { name: 'Line' })).toHaveAttribute('aria-pressed', 'true')
    // near (not on) the 16×16 grid points (0.25, 0) and (0.25, 1): they snap
    fireEvent.pointerDown(svg, at(0.252, 0.003))
    expect(screen.getByText(/Click the crease’s end point/)).toBeInTheDocument()
    fireEvent.pointerDown(svg, at(0.249, 0.998))
    expect(has(store, [0.25, 0], [0.25, 1])).toBe(true)
    expect(creaseEdges(store.getState().cp)).toHaveLength(1)
    expect(store.getState().cp.edges_assignment[creaseEdges(store.getState().cp)[0]!]).toBe('V')
  })

  test('new creases take the chosen assignment; the drawing uses diagram dashes and a grid', () => {
    const { store, svg } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Mountain' }))
    fireEvent.pointerDown(svg, at(0, 0.5))
    fireEvent.pointerDown(svg, at(1, 0.5))
    expect(store.getState().cp.edges_assignment).toContain('M')
    expect(svg.querySelector('.cp-mountain')).toHaveAttribute('stroke-dasharray', '6 3 1.5 3')
    expect(svg.querySelectorAll('.cp-grid line').length).toBe(2 * 15)
  })

  test('the cursor position is shown in mono type', () => {
    const { svg } = setup()
    fireEvent.pointerMove(svg, at(0.5, 0.25))
    const readout = screen.getByLabelText('Cursor position')
    expect(readout).toHaveTextContent('x 0.5000 y 0.2500')
    expect(readout).toHaveClass('mono')
  })

  test('axiom tools prompt for the right number of inputs', () => {
    const { store, svg } = setup()
    const prompt = () => screen.getByRole('status', { name: 'Tool prompt' }).textContent ?? ''
    fireEvent.click(screen.getByRole('button', { name: 'Axiom 1' }))
    expect(prompt()).toMatch(/Pick 2 points \(0 of 2\)/)
    fireEvent.click(screen.getByRole('button', { name: 'Axiom 3' }))
    expect(prompt()).toMatch(/Pick 2 creases \(0 of 2\)/)
    fireEvent.click(screen.getByRole('button', { name: 'Axiom 5' }))
    expect(prompt()).toMatch(/Pick 1 crease, then 2 points \(0 of 3\)/)
    fireEvent.click(screen.getByRole('button', { name: 'Axiom 6' }))
    expect(prompt()).toMatch(/Pick 2 creases, then 2 points \(0 of 4\)/)
    fireEvent.click(screen.getByRole('button', { name: 'Axiom 7' }))
    expect(prompt()).toMatch(/Pick 2 creases, then 1 point \(0 of 3\)/)

    // axiom 4: a crease (the bottom edge), then a point: the perpendicular through it
    fireEvent.click(screen.getByRole('button', { name: 'Axiom 4' }))
    expect(prompt()).toMatch(/Pick 1 crease, then 1 point \(0 of 2\)/)
    fireEvent.pointerDown(svg, at(0.6, 0.004)) // on the bottom edge
    expect(prompt()).toMatch(/\(1 of 2\).*Next: a point/)
    fireEvent.pointerDown(svg, at(0.375, 0.5))
    expect(has(store, [0.375, 0], [0.375, 1])).toBe(true)
    expect(prompt()).toMatch(/\(0 of 2\)/)

    // axiom 2 on two points: the perpendicular bisector
    act(() => store.getState().undo())
    fireEvent.click(screen.getByRole('button', { name: 'Axiom 2' }))
    fireEvent.pointerDown(svg, at(0, 0))
    expect(prompt()).toMatch(/\(1 of 2\)/)
    fireEvent.pointerDown(svg, at(1, 1))
    expect(has(store, [1, 0], [0, 1])).toBe(true)
  })

  test('an axiom with several solutions offers them; choosing one adds it', () => {
    const { store, svg } = setup()
    store.getState().addSegment([0, 0.5], [1, 0.5])
    fireEvent.click(screen.getByRole('button', { name: 'Axiom 3' }))
    fireEvent.pointerDown(svg, at(0.3, 0.5)) // the horizontal crease
    fireEvent.pointerDown(svg, at(0.003, 0.8)) // the left edge
    const choices = screen.getAllByRole('button', { name: /^Solution \d/ })
    expect(choices).toHaveLength(2)
    fireEvent.click(choices[0]!)
    expect(creaseEdges(store.getState().cp).length).toBeGreaterThan(1)
    expect(screen.queryAllByRole('button', { name: /^Solution \d/ })).toHaveLength(0)
  })

  test('select a crease, then flip and delete it; designer undo / redo', () => {
    const { store, svg } = setup()
    store.getState().addSegment([0, 0.5], [1, 0.5])
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.pointerDown(svg, at(0.5, 0.502))
    expect(store.getState().selected).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }))
    expect(store.getState().cp.edges_assignment).toContain('M')
    fireEvent.pointerDown(svg, at(0.5, 0.5))
    fireEvent.click(screen.getByRole('button', { name: 'Delete crease' }))
    expect(creaseEdges(store.getState().cp)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }))
    expect(store.getState().cp.edges_assignment).toContain('M')
    fireEvent.click(screen.getByRole('button', { name: 'Redo edit' }))
    expect(creaseEdges(store.getState().cp)).toHaveLength(0)
  })

  test('the Curve tool takes a start, a control point and an end, and adds a curved crease as short creases', () => {
    const { store, svg } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Curve' }))
    const prompt = () => screen.getByRole('status', { name: 'Tool prompt' }).textContent ?? ''
    expect(prompt()).toMatch(/start point/)
    fireEvent.pointerDown(svg, at(0, 0.25))
    expect(prompt()).toMatch(/control point/)
    fireEvent.pointerDown(svg, at(0.5, 0.75))
    expect(prompt()).toMatch(/end point/)
    expect(creaseEdges(store.getState().cp)).toHaveLength(0)
    fireEvent.pointerDown(svg, at(1, 0.25))
    const { cp } = store.getState()
    expect(creaseEdges(cp)).toHaveLength(16)
    expect(creaseEdges(cp).every(e => cp.edges_assignment[e] === 'V')).toBe(true)
    // its apex is halfway to the control point
    expect(Math.max(...cp.vertices_coords.filter(([x]) => x > 0 && x < 1).map(([, y]) => y))).toBeCloseTo(0.5, 9)
    // one designer undo removes the whole curve
    act(() => store.getState().undo())
    expect(creaseEdges(store.getState().cp)).toHaveLength(0)
  })

  test('the numeric input sets exact coordinates', () => {
    const { store } = setup()
    const form = screen.getByRole('group', { name: 'Exact crease' })
    const set = (label: string, v: string) => fireEvent.change(within(form).getByLabelText(label), { target: { value: v } })
    set('From x', '0.1')
    set('From y', '0.3')
    set('To x', '0.7071067811865476')
    set('To y', '0.9')
    fireEvent.click(within(form).getByRole('button', { name: 'Add crease' }))
    expect(has(store, [0.1, 0.3], [0.7071067811865476, 0.9])).toBe(true)
    for (const i of within(form).getAllByRole('spinbutton')) expect(i).toHaveClass('mono')
    // a bad number adds nothing and says why
    set('From x', 'abc')
    fireEvent.click(within(form).getByRole('button', { name: 'Add crease' }))
    expect(creaseEdges(store.getState().cp)).toHaveLength(1)
    expect(within(form).getByRole('alert')).toHaveTextContent(/number/)
  })

  test('grid presets: 8×8, 16×16, 22.5° and custom', () => {
    const { store, svg } = setup()
    const grid = screen.getByLabelText('Grid')
    expect([...grid.querySelectorAll('option')].map(o => o.textContent)).toEqual(['8 × 8', '16 × 16', '22.5°', 'Custom'])
    fireEvent.change(grid, { target: { value: '8x8' } })
    fireEvent.pointerDown(svg, at(0.13, 0.01))
    fireEvent.pointerDown(svg, at(0.13, 0.99))
    expect(has(store, [0.125, 0], [0.125, 1])).toBe(true)
    fireEvent.change(grid, { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Divisions'), { target: { value: '3' } })
    expect(store.getState().gridPreset()).toEqual({ kind: 'square', divisions: 3 })
    // 22.5°: the second point's direction snaps from the first
    fireEvent.change(grid, { target: { value: '22.5' } })
    fireEvent.pointerDown(svg, at(0, 0))
    fireEvent.pointerDown(svg, at(1, 0.35))
    const { cp } = store.getState()
    const e = creaseEdges(cp).find(k => cp.vertices_coords[cp.edges_vertices[k]![0]]![1] !== cp.vertices_coords[cp.edges_vertices[k]![1]]![1] && cp.vertices_coords[cp.edges_vertices[k]![0]]![0] !== cp.vertices_coords[cp.edges_vertices[k]![1]]![0])!
    const [p, q] = cp.edges_vertices[e]!.map(v => cp.vertices_coords[v]!)
    expect(Math.abs((Math.atan2(q![1] - p![1], q![0] - p![0]) * 180) / Math.PI)).toBeCloseTo(22.5, 6)
  })
})

describe('autosave under its own key (Review Focus 5)', () => {
  beforeEach(() => localStorage.removeItem(DESIGNER_KEY))
  afterEach(() => {
    vi.useRealTimers()
    localStorage.removeItem(DESIGNER_KEY)
  })

  test('edits persist under ori.designer.v1 and come back in a new designer', () => {
    vi.useFakeTimers()
    const a = createDesignerStore({ storage: localStorage })
    a.getState().addSegment([0, 0.5], [1, 0.5])
    a.getState().setGrid('8x8')
    expect(localStorage.getItem(DESIGNER_KEY)).toBeNull() // debounced
    vi.advanceTimersByTime(SAVE_MS)
    const saved = JSON.parse(localStorage.getItem(DESIGNER_KEY)!)
    expect(saved.version).toBe(1)
    const b = createDesignerStore({ storage: localStorage })
    expect(b.getState().cp.edges_assignment).toEqual(a.getState().cp.edges_assignment)
    expect(b.getState().cp.vertices_coords).toEqual(a.getState().cp.vertices_coords)
    expect(b.getState().grid).toBe('8x8')
    // the studio's own autosave key is untouched
    expect(localStorage.getItem('ori.autosave.v1')).toBeNull()
  })

  test('a damaged save is ignored', () => {
    localStorage.setItem(DESIGNER_KEY, '{"version":1,"cp":{"vertices_coords":"x"}}')
    expect(creaseEdges(createDesignerStore({ storage: localStorage }).getState().cp)).toEqual([])
    localStorage.setItem(DESIGNER_KEY, 'not json')
    expect(creaseEdges(createDesignerStore({ storage: localStorage }).getState().cp)).toEqual([])
  })

  test('switching to the sandbox and back keeps the edits', async () => {
    const { App } = await import('../studio/App')
    const { useUi } = await import('../studio/ui')
    const { designerStore } = await import('./designerSlice')
    render(<App />)
    const mode = screen.getByRole('group', { name: 'Mode' })
    expect(within(mode).getByRole('button', { name: 'Sandbox' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(mode).getByRole('button', { name: 'Designer' }))
    const svg = await screen.findByRole('application', { name: /Crease pattern editor/ })
    expect(useUi.getState().mode).toBe('designer')
    expect(screen.queryByRole('region', { name: 'Tools' })).toBeNull() // the sandbox tools step aside
    act(() => designerStore().getState().addSegment([0, 0.25], [1, 0.25]))
    fireEvent.click(within(mode).getByRole('button', { name: 'Sandbox' }))
    await waitFor(() => expect(screen.queryByRole('application', { name: /Crease pattern editor/ })).toBeNull())
    expect(svg).not.toBeInTheDocument()
    designerStore().flush() // leaving designer mode writes the autosave at once
    expect(JSON.parse(localStorage.getItem(DESIGNER_KEY)!).cp.edges_assignment).toContain('V')
    fireEvent.click(within(mode).getByRole('button', { name: 'Designer' }))
    await screen.findByRole('application', { name: /Crease pattern editor/ })
    expect(creaseEdges(designerStore().getState().cp)).toHaveLength(1)
    act(() => useUi.getState().setMode('sandbox'))
  })
})
