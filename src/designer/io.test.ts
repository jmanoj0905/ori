import { describe, expect, test } from 'vitest'
import { parseCp, parseFold, toCp, toFold } from '../persistence/cpFormats'
import { addCrease, buildCp, creaseEdges, emptyCP, type CP } from './cp'
import { kawasaki, maekawa } from './checks'

/** Each crease as "x1,y1 x2,y2 A" (endpoints sorted, 6 decimals), sorted: geometry + assignment, order-free. */
const creases = (cp: CP) =>
  creaseEdges(cp)
    .map(e => {
      const [p, q] = cp.edges_vertices[e]!.map(v => cp.vertices_coords[v]!.map(x => (Math.round(x * 1e6) / 1e6).toFixed(6)).join(','))
      return `${[p, q].sort().join(' ')} ${cp.edges_assignment[e]}`
    })
    .sort()

function sample(): CP {
  let cp = emptyCP({ width: 1, height: 1 })
  cp = addCrease(cp, [0, 0], [1, 1], 'V')
  cp = addCrease(cp, [1, 0], [0, 1], 'M')
  cp = addCrease(cp, [0, 0.5], [1, 0.5], 'U')
  cp = addCrease(cp, [0.25, 0], [0.25, 1], 'M')
  return cp
}

describe('import and export', () => {
  test('.cp round trip keeps geometry and assignments', () => {
    const cp = sample()
    const text = toCp(cp)
    expect(text.split('\n')[0]).toMatch(/^[1-4] -?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+$/)
    const r = parseCp(text)
    if (!r.ok) throw new Error(r.reason)
    expect(creases(buildCp(r.segments)!)).toEqual(creases(cp))
  })

  test('.fold round trip keeps geometry and assignments', () => {
    const cp = sample()
    const r = parseFold(toFold(cp))
    if (!r.ok) throw new Error(r.reason)
    expect(creases(buildCp(r.segments)!)).toEqual(creases(cp))
    expect(JSON.parse(toFold(cp)).frame_classes).toEqual(['creasePattern'])
  })

  test(".cp unassigned (0 / 4) and .fold 'F' / 'U' lines are kept as unassigned and excluded from the checks (Review Focus 2)", () => {
    // a lone unassigned line into the middle, and a flat one: as creases they would fail both checks
    const cpText = ['1 -200 -200 200 -200', '1 200 -200 200 200', '1 200 200 -200 200', '1 -200 200 -200 -200', '0 -200 0 0 0', '4 0 -200 0 -100', '2 -200 100 200 100'].join('\n')
    const r = parseCp(cpText)
    if (!r.ok) throw new Error(r.reason)
    const cp = buildCp(r.segments)!
    expect(cp.edges_assignment.filter(a => a === 'U')).toHaveLength(2)
    expect(cp.edges_assignment.filter(a => a === 'M')).toHaveLength(1)
    expect(maekawa(cp)).toEqual([])
    expect(kawasaki(cp)).toEqual([])

    const fold = JSON.stringify({
      vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0, 0.5]],
      edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [5, 4]],
      edges_assignment: ['B', 'B', 'B', 'B', 'F', 'U'],
    })
    const f = parseFold(fold)
    if (!f.ok) throw new Error(f.reason)
    const g = buildCp(f.segments)!
    expect(creaseEdges(g).map(e => g.edges_assignment[e])).toEqual(['U', 'U'])
    expect(maekawa(g)).toEqual([])
    // exported back, they stay unassigned
    expect(toCp(g).split('\n').filter(l => l.startsWith('4 '))).toHaveLength(2)
  })

  test('.fold with file_frames imports its first frame; bad files are refused with a reason', () => {
    const frame = JSON.parse(toFold(sample()))
    const multi = JSON.stringify({ file_spec: 1.2, file_frames: [frame, { ...frame, edges_assignment: frame.edges_assignment.map(() => 'B') }] })
    const r = parseFold(multi)
    expect(r.ok && r.segments.filter(s => s.assignment === 'M').length).toBeGreaterThan(0)
    expect(parseFold('nope')).toEqual({ ok: false, reason: 'That .fold file is not valid JSON.' })
    expect(parseCp('2 0 0 1')).toEqual({ ok: false, reason: 'Line 1 of the .cp file is not "type x1 y1 x2 y2".' })
    expect(parseCp('\n\n').ok).toBe(false)
  })
})
