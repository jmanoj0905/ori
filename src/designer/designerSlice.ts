// Designer state (spec 07; Plan 5 Task 2): the crease pattern being edited,
// its own undo / redo, the active tool and its collected inputs, the grid,
// and the autosave under its own key (ori.designer.v1), so edits survive a
// switch to the sandbox and a reload (Review Focus 5).
//
// Tools:
//   line     click two points: a crease between them (the angle grid snaps
//            the second point's direction from the first)
//   axiom n  pick the axiom's creases, then its points; one solution is added
//            at once, several are offered as candidates (chooseCandidate)
//   select   pick a crease; assign / flip / delete it
// New creases take `assignment`. Every edit pushes the previous CP on `past`
// (MAX_UNDO deep) and clears `future`.
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { frameFromFold, type Line, type PaperSize, type Vec2 } from '@engine'
import { AXIOM_INPUTS, AXIOM_TEXT, axiom, clipLine, type AxiomNumber } from './axioms'
import {
  GRID_PRESETS, addCrease, emptyCP, flip, removeCrease, setAssignment, sizeOf, snapToGrid,
  type Assignment, type CP, type GridPreset,
} from './cp'

export const DESIGNER_KEY = 'ori.designer.v1'
export const SAVE_MS = 400
export const MAX_UNDO = 200

export type GridName = keyof typeof GRID_PRESETS | 'custom'
export type DesignerTool = { kind: 'line' } | { kind: 'axiom'; n: AxiomNumber } | { kind: 'select' }

export type DesignerState = {
  cp: CP
  past: CP[]
  future: CP[]
  tool: DesignerTool
  assignment: Assignment
  grid: GridName
  customDivisions: number
  /** Inputs collected for the line / axiom tool so far. */
  points: Vec2[]
  lines: Line[]
  /** An axiom's solutions, clipped to the sheet, waiting for a choice. */
  candidates: [Vec2, Vec2][]
  selected: number | null
  /** The last tool message (no solution, …), for the prompt line. */
  message: string | null

  /** The grid in force. */
  gridPreset(): GridPreset
  setTool(t: DesignerTool): void
  setAssignment(a: Assignment): void
  setGrid(g: GridName, custom?: number): void
  /** The line tool / axiom tools take a point (already snapped by the editor). */
  pickPoint(p: Vec2): void
  /** The axiom tools take a crease's line; the select tool selects it. */
  pickEdge(edge: number): void
  chooseCandidate(i: number): void
  /** Exact numeric input: a crease between two points. */
  addSegment(a: Vec2, b: Vec2): void
  assignSelected(a: Assignment): void
  flipSelected(): void
  deleteSelected(): void
  /** Apply an edit; a no-op edit (the same CP back) records nothing. */
  edit(fn: (cp: CP) => CP): void
  undo(): void
  redo(): void
  /** Replace the pattern (import, 3D sync, new sheet); `record` keeps the old one on the undo stack. */
  load(cp: CP, record?: boolean): void
  clearInputs(): void
}

export type DesignerOptions = { storage?: Pick<Storage, 'getItem' | 'setItem'> | null; size?: PaperSize }

const defaultStorage = (): Pick<Storage, 'getItem' | 'setItem'> | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

type Saved = { version: 1; cp: unknown; grid: GridName; customDivisions: number; assignment: Assignment }
const GRIDS: readonly string[] = ['8x8', '16x16', '22.5', 'custom']

function readSaved(storage: Pick<Storage, 'getItem'> | null): Partial<DesignerState> | null {
  let raw: unknown
  try {
    const text = storage?.getItem(DESIGNER_KEY)
    if (!text) return null
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const s = raw as Partial<Saved> | null
  if (!s || s.version !== 1) return null
  const f = frameFromFold(s.cp)
  if (!f.ok) return null
  const cp: CP = { ...f.frame, faces_vertices: [], faceOrders: [] }
  return {
    cp,
    grid: GRIDS.includes(s.grid as string) ? (s.grid as GridName) : '16x16',
    customDivisions: Number.isInteger(s.customDivisions) && s.customDivisions! > 0 && s.customDivisions! <= 256 ? s.customDivisions! : 12,
    assignment: s.assignment === 'M' || s.assignment === 'U' ? s.assignment : 'V',
  }
}

/** The geometry a CP is saved with (faces are rebuilt on demand). */
export const cpGeometry = (cp: CP) => ({
  vertices_coords: cp.vertices_coords,
  edges_vertices: cp.edges_vertices,
  edges_assignment: cp.edges_assignment,
  faces_vertices: [] as number[][],
})

export type DesignerStore = StoreApi<DesignerState> & { /** Write a pending autosave now. */ flush(): void }

export function createDesignerStore({ storage = defaultStorage(), size = { width: 1, height: 1 } }: DesignerOptions = {}): DesignerStore {
  const store = createStore<DesignerState>()((set, get) => {
    const inputs: Pick<DesignerState, 'points' | 'lines' | 'candidates' | 'message'> = { points: [], lines: [], candidates: [], message: null }

    const addLine = (a: Vec2, b: Vec2) => get().edit(cp => addCrease(cp, a, b, get().assignment))

    /** The axiom's inputs are complete: add its one solution or offer several. */
    const solve = (n: AxiomNumber) => {
      const { points, lines, cp } = get()
      const chords = axiom(n, { points, lines })
        .map(l => clipLine(l, sizeOf(cp)))
        .filter((c): c is [Vec2, Vec2] => c !== null)
      if (chords.length === 0) return set({ ...inputs, message: `No crease satisfies axiom ${n} (${AXIOM_TEXT[n].toLowerCase()}) with these inputs.` })
      if (chords.length === 1) {
        set(inputs)
        return addLine(...chords[0]!)
      }
      set({ points: [], lines: [], candidates: chords, message: `Axiom ${n} has ${chords.length} solutions: choose one.` })
    }

    return {
      cp: emptyCP(size),
      past: [],
      future: [],
      tool: { kind: 'line' },
      assignment: 'V',
      grid: '16x16',
      customDivisions: 12,
      ...inputs,
      selected: null,

      gridPreset() {
        const { grid, customDivisions } = get()
        return grid === 'custom' ? { kind: 'square', divisions: customDivisions } : GRID_PRESETS[grid]
      },
      setTool: tool => set({ tool, ...inputs, selected: null }),
      setAssignment(a) {
        set({ assignment: a })
      },
      setGrid(grid, custom) {
        const n = custom !== undefined && Number.isInteger(custom) && custom > 0 && custom <= 256 ? custom : get().customDivisions
        set({ grid, customDivisions: n })
      },

      pickPoint(p) {
        const { tool, points, lines } = get()
        if (tool.kind === 'line') {
          if (points.length === 0) return set({ points: [p], message: null })
          const a = points[0]!
          const g = get().gridPreset()
          const b = g.kind === 'angle' ? snapToGrid(p, g, { anchor: a }) : p
          set({ points: [] })
          return addLine(a, b)
        }
        if (tool.kind !== 'axiom') return
        const need = AXIOM_INPUTS[tool.n]
        if (lines.length < need.lines || points.length >= need.points) return
        set({ points: [...points, p], candidates: [], message: null })
        if (get().points.length === need.points) solve(tool.n)
      },

      pickEdge(edge) {
        const { tool, cp, lines, points } = get()
        const ev = cp.edges_vertices[edge]
        if (!ev) return
        if (tool.kind === 'select') return set({ selected: edge })
        if (tool.kind !== 'axiom') return
        const need = AXIOM_INPUTS[tool.n]
        if (lines.length >= need.lines) return
        const p = cp.vertices_coords[ev[0]]!
        const q = cp.vertices_coords[ev[1]]!
        set({ lines: [...lines, { origin: p, vector: [q[0] - p[0], q[1] - p[1]] }], candidates: [], message: null })
        if (get().lines.length === need.lines && points.length === need.points) solve(tool.n)
      },

      chooseCandidate(i) {
        const c = get().candidates[i]
        if (!c) return
        set(inputs)
        addLine(...c)
      },

      addSegment(a, b) {
        if (![...a, ...b].every(Number.isFinite)) return
        addLine(a, b)
      },

      assignSelected(a) {
        const e = get().selected
        get().setAssignment(a)
        if (e !== null) get().edit(cp => setAssignment(cp, e, a))
      },
      flipSelected() {
        const e = get().selected
        if (e !== null) get().edit(cp => flip(cp, e))
      },
      deleteSelected() {
        const e = get().selected
        if (e === null) return
        get().edit(cp => removeCrease(cp, e))
        set({ selected: null })
      },

      edit(fn) {
        const { cp, past } = get()
        const next = fn(cp)
        if (next === cp) return
        set({ cp: next, past: [...past, cp].slice(-MAX_UNDO), future: [], selected: null })
      },
      undo() {
        const { past, cp, future } = get()
        const prev = past.at(-1)
        if (!prev) return
        set({ cp: prev, past: past.slice(0, -1), future: [cp, ...future], selected: null, ...inputs })
      },
      redo() {
        const { past, cp, future } = get()
        const next = future[0]
        if (!next) return
        set({ cp: next, past: [...past, cp], future: future.slice(1), selected: null, ...inputs })
      },
      load(cp, record = false) {
        const { past, cp: old } = get()
        set({ cp, past: record ? [...past, old].slice(-MAX_UNDO) : past, future: record ? [] : get().future, selected: null, ...inputs })
      },
      clearInputs: () => set(inputs),
    }
  })

  const saved = readSaved(storage)
  if (saved) store.setState(saved)

  // Autosave (debounced): the pattern and the drawing preferences, not the undo stack.
  let timer: ReturnType<typeof setTimeout> | undefined
  const write = () => {
    timer = undefined
    const s = store.getState()
    const payload: Saved = { version: 1, cp: cpGeometry(s.cp), grid: s.grid, customDivisions: s.customDivisions, assignment: s.assignment }
    try {
      storage?.setItem(DESIGNER_KEY, JSON.stringify(payload))
    } catch {
      /* quota / private mode: the designer keeps working in memory */
    }
  }
  store.subscribe((s, prev) => {
    if (s.cp === prev.cp && s.grid === prev.grid && s.customDivisions === prev.customDivisions && s.assignment === prev.assignment) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(write, SAVE_MS)
  })
  const flush = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    write()
  }
  return Object.assign(store, { flush })
}

let app: DesignerStore | null = null
/** The app's designer store, created on first use (designer mode is code-split). */
export function designerStore(): DesignerStore {
  return (app ??= createDesignerStore())
}

export function useDesigner<T>(store: StoreApi<DesignerState>, pick: (s: DesignerState) => T): T {
  return useStore(store, pick)
}
