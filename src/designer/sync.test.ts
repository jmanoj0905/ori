import { describe, expect, test, vi } from 'vitest'
import { current } from '@engine'
import { createStudioStore } from '../studio/store'
import { inProcessCommitter } from '../studio/committer'
import { createDesignerStore } from './designerSlice'
import { creaseEdges, emptyCP } from './cp'
import { waterbombBase } from './fixtures'
import { BRANCH_WARNING, LIVE_SYNC_MAX_EDGES, cpOfHistory, linkDesigner } from './sync'
import { foldAll } from './foldAll'

function setup() {
  const studio = createStudioStore({ committer: inProcessCommitter })
  const designer = createDesignerStore({ storage: null })
  const notify = vi.fn()
  const link = linkDesigner(studio, designer, notify)
  return { studio, designer, notify, link }
}

async function fold3D(studio: ReturnType<typeof createStudioStore>, grab: [number, number], target: [number, number]) {
  studio.getState().begin(grab)
  studio.getState().drag(target, 1)
  expect(await studio.getState().release()).toBe(true)
}

const valleys = (cp: { edges_assignment: readonly string[] }) => cp.edges_assignment.filter(a => a === 'V').length

describe('crease pattern ↔ 3D sync', () => {
  test('a 3D fold updates the designer crease pattern', async () => {
    const { studio, designer } = setup()
    expect(creaseEdges(designer.getState().cp)).toHaveLength(0)
    await fold3D(studio, [0.95, 0.5], [0.05, 0.5])
    expect(creaseEdges(designer.getState().cp)).toHaveLength(1)
    expect(valleys(designer.getState().cp)).toBe(1)
    // and back: undo in 3D, the pattern follows (the designer can undo that too)
    studio.getState().undo()
    expect(creaseEdges(designer.getState().cp)).toHaveLength(0)
    designer.getState().undo()
    expect(creaseEdges(designer.getState().cp)).toHaveLength(1)
  })

  test('designer edits on a blank sheet become one pattern step, replaced on later edits', () => {
    const { studio, designer, notify } = setup()
    designer.getState().addSegment([0, 0.5], [1, 0.5])
    let h = studio.getState().history
    expect(h.steps.map(s => s.kind)).toEqual(['pattern'])
    // the 3D view shows it pre-creased (open, flat)
    expect(current(h).faces_vertices).toHaveLength(2)
    expect(current(h).edges_foldAngle.every(a => a === 0)).toBe(true)
    designer.getState().addSegment([0.5, 0], [0.5, 1])
    h = studio.getState().history
    expect(h.steps.map(s => s.kind)).toEqual(['pattern'])
    expect(current(h).faces_vertices).toHaveLength(4)
    expect(cpOfHistory(h).edges_assignment.filter(a => a === 'V')).toHaveLength(4)
    expect(h.branchOf).toBeUndefined()
    expect(notify).not.toHaveBeenCalled()
  })

  test('editing the crease pattern after 3D steps branches: the original stays reachable, with a warning', async () => {
    const { studio, designer, notify, link } = setup()
    await fold3D(studio, [0.95, 0.5], [0.05, 0.5])
    await fold3D(studio, [0.25, 0.95], [0.25, 0.05])
    studio.getState().undo() // a redo step the branch must not lose
    const original = studio.getState().history
    designer.getState().setAssignment('M')
    designer.getState().addSegment([0, 0], [1, 1])
    const h = studio.getState().history
    expect(h.branchOf).toBe(original)
    expect(h.frames.slice(0, 2)).toEqual(original.frames.slice(0, 2)) // earlier steps untouched
    expect(h.steps.map(s => s.kind)).toEqual(['fold', 'pattern'])
    expect(original.steps).toHaveLength(2) // the redo step is still in the original
    expect(notify).toHaveBeenCalledWith(BRANCH_WARNING)
    expect(designer.getState().branchedFrom).toBe(original)
    // a second edit replaces the pattern step: no second branch, no second warning
    designer.getState().addSegment([1, 0], [0, 1])
    expect(studio.getState().history.steps.map(s => s.kind)).toEqual(['fold', 'pattern'])
    expect(studio.getState().history.branchOf).toBe(original)
    expect(notify).toHaveBeenCalledTimes(1)
    // back to the folded steps
    link.backToFolded()
    expect(studio.getState().history).toBe(original)
    expect(designer.getState().branchedFrom).toBeNull()
    expect(creaseEdges(designer.getState().cp)).toHaveLength(1)
  })

  test('Fold all puts the folded pattern in 3D (replacing the unfolded one)', async () => {
    const { studio, designer, link } = setup()
    designer.getState().load(waterbombBase(), true)
    expect(studio.getState().history.steps.map(s => s.label)).toEqual(['Crease pattern'])
    const r = await foldAll(designer.getState().cp, new AbortController().signal)
    if (!r.ok) throw new Error(r.reason)
    link.folded(r.frame)
    const h = studio.getState().history
    expect(h.steps.map(s => s.label)).toEqual(['Fold all'])
    expect(current(h).faceOrders.length).toBeGreaterThan(0)
    // the designer still shows the pattern with its own assignments
    expect(designer.getState().cp.edges_assignment).toEqual(waterbombBase().edges_assignment)
    // a 3D fold on top of the folded pattern works and syncs back
    await fold3D(studio, [0.5, 0.02], [0.5, 0.4])
    expect(studio.getState().history.steps).toHaveLength(2)
  })

  test('a pattern too large to mirror live is detached; Fold all still reaches 3D', () => {
    const { studio, designer } = setup()
    let cp = emptyCP({ width: 1, height: 1 })
    const n = Math.ceil(Math.sqrt(LIVE_SYNC_MAX_EDGES)) + 2
    const big = { ...cp, edges_assignment: [...cp.edges_assignment], edges_vertices: [...cp.edges_vertices], vertices_coords: [...cp.vertices_coords] }
    for (let i = 0; i < n * n; i++) {
      big.vertices_coords.push([0.1 + (i % n) * 0.001, 0.1 + Math.floor(i / n) * 0.001], [0.1 + (i % n) * 0.001 + 0.0005, 0.1 + Math.floor(i / n) * 0.001])
      big.edges_vertices.push([big.vertices_coords.length - 2, big.vertices_coords.length - 1])
      big.edges_assignment.push('U')
    }
    cp = big
    const before = studio.getState().history
    designer.getState().load(cp, true)
    expect(designer.getState().detached).toBe(true)
    expect(studio.getState().history).toBe(before)
  })
})
