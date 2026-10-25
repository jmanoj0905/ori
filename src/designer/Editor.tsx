// The crease pattern editor (spec 07 "Crease pattern editor"; Plan 5 Task 2):
// an SVG of the unfolded sheet in diagram style (valley dashed, mountain
// dash-dot, unassigned faint, boundary solid; the same dashes as the MiniCP)
// over a grid overlay. Points snap to existing vertices, crease midpoints and
// the square grid within SNAP_PX; the angle grid snaps the line tool's
// direction instead (designerSlice). y is flipped so "up" on the sheet is up.
//
// Pointer input: the active tool decides whether a click is a point or a
// crease (the axiom tools take their creases first, the select tool only
// creases). The keyboard route is the numeric input (DesignerMode).
import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Vec2 } from '@engine'
import { DASH } from '../persistence/creasePattern'
import { AXIOM_INPUTS } from './axioms'
import { sizeOf, type CP } from './cp'
import { useDesigner, type DesignerState, type DesignerStore } from './designerSlice'

/** Snap / pick radius, in screen pixels. */
export const SNAP_PX = 12
const PAD = 0.04

const fmt = (x: number) => x.toFixed(4)

type View = { w: number; h: number; pad: number }
const viewOf = (cp: CP): View => {
  const { width: w, height: h } = sizeOf(cp)
  return { w, h, pad: Math.max(w, h) * PAD }
}

/** Client pixel → paper point, and the pixels per paper unit (preserveAspectRatio meet). */
function toPaper(svg: Element, v: View, cx: number, cy: number): { p: Vec2; scale: number } {
  const r = svg.getBoundingClientRect()
  const vw = v.w + 2 * v.pad
  const vh = v.h + 2 * v.pad
  const scale = Math.min(r.width / vw, r.height / vh) || 1
  const ox = r.left + (r.width - vw * scale) / 2
  const oy = r.top + (r.height - vh * scale) / 2
  const sx = (cx - ox) / scale - v.pad
  const sy = (cy - oy) / scale - v.pad
  return { p: [sx, v.h - sy], scale }
}

const d2 = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!)

function segDist(p: Vec2, a: readonly number[], b: readonly number[]): number {
  const dx = b[0]! - a[0]!
  const dy = b[1]! - a[1]!
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]!) * dx + (p[1] - a[1]!) * dy) / l2))
  return Math.hypot(p[0] - a[0]! - dx * t, p[1] - a[1]! - dy * t)
}

/** The nearest snap target within `r` (vertices, crease midpoints, square grid points), else p. */
export function snapPoint(s: DesignerState, p: Vec2, r: number): Vec2 {
  const { cp } = s
  const targets: Vec2[] = [...cp.vertices_coords]
  cp.edges_vertices.forEach(([u, v], e) => {
    if (cp.edges_assignment[e] === 'B') return
    const a = cp.vertices_coords[u]!
    const b = cp.vertices_coords[v]!
    targets.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
  })
  const g = s.gridPreset()
  if (g.kind === 'square') {
    const { width, height } = sizeOf(cp)
    const n = g.divisions
    targets.push([Math.round((p[0] / width) * n) * (width / n), Math.round((p[1] / height) * n) * (height / n)])
  }
  let best: Vec2 = p
  let bd = r
  for (const t of targets) {
    const d = d2(t, p)
    if (d <= bd) {
      bd = d
      best = t
    }
  }
  return best
}

/** The nearest edge within `r` (creases only unless `boundary`), or null. */
export function pickEdge(cp: CP, p: Vec2, r: number, boundary: boolean): number | null {
  let best: number | null = null
  let bd = r
  cp.edges_vertices.forEach(([u, v], e) => {
    if (!boundary && cp.edges_assignment[e] === 'B') return
    const d = segDist(p, cp.vertices_coords[u]!, cp.vertices_coords[v]!)
    if (d <= bd) {
      bd = d
      best = e
    }
  })
  return best
}

/** One path per kind: thousands of creases stay a handful of DOM nodes. */
function paths(cp: CP, h: number): Record<'B' | 'V' | 'M' | 'U', string> {
  const out = { B: '', V: '', M: '', U: '' }
  cp.edges_vertices.forEach(([u, v], e) => {
    const a = cp.edges_assignment[e]
    const k = a === 'B' || a === 'V' || a === 'M' ? a : 'U'
    const p = cp.vertices_coords[u]!
    const q = cp.vertices_coords[v]!
    out[k] += `M${p[0]} ${h - p[1]}L${q[0]} ${h - q[1]}`
  })
  return out
}

export type EditorProps = { store: DesignerStore; issues?: { vertex: number; text: string }[] }

export function Editor({ store, issues = [] }: EditorProps) {
  const s = useDesigner(store, x => x)
  const { cp, points, lines, candidates, selected, tool } = s
  const v = viewOf(cp)
  const [cursor, setCursor] = useState<Vec2 | null>(null)
  const ps = paths(cp, v.h)
  const g = s.gridPreset()
  const Y = (y: number) => v.h - y

  const wantsEdge = () => {
    if (tool.kind === 'select') return true
    return tool.kind === 'axiom' && lines.length < AXIOM_INPUTS[tool.n].lines
  }

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const { p, scale } = toPaper(e.currentTarget, v, e.clientX, e.clientY)
    const r = SNAP_PX / scale
    const st = store.getState()
    if (wantsEdge()) {
      const k = pickEdge(st.cp, p, r, st.tool.kind === 'axiom')
      if (k !== null) st.pickEdge(k)
      return
    }
    st.pickPoint(snapPoint(st, p, r))
  }
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const { p, scale } = toPaper(e.currentTarget, v, e.clientX, e.clientY)
    setCursor(snapPoint(store.getState(), p, SNAP_PX / scale))
  }

  const gridLines: [number, number, number, number][] = []
  if (g.kind === 'square') {
    for (let i = 1; i < g.divisions; i++) {
      const x = (v.w * i) / g.divisions
      const y = (v.h * i) / g.divisions
      gridLines.push([x, 0, x, v.h], [0, y, v.w, y])
    }
  }
  const sel = selected === null ? null : cp.edges_vertices[selected]

  return (
    <div className="cp-editor">
      <svg
        role="application"
        aria-label="Crease pattern editor"
        aria-describedby="designer-prompt"
        viewBox={`${-v.pad} ${-v.pad} ${v.w + 2 * v.pad} ${v.h + 2 * v.pad}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerLeave={() => setCursor(null)}
      >
        <rect className="cp-sheet" x={0} y={0} width={v.w} height={v.h} />
        <g className="cp-grid" aria-hidden="true">
          {gridLines.map(([x1, y1, x2, y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        <path className="cp-unassigned" d={ps.U} vectorEffect="non-scaling-stroke" />
        <path className="cp-valley" d={ps.V} strokeDasharray={DASH.valley} vectorEffect="non-scaling-stroke" />
        <path className="cp-mountain" d={ps.M} strokeDasharray={DASH.mountain} vectorEffect="non-scaling-stroke" />
        <path className="cp-boundary" d={ps.B} vectorEffect="non-scaling-stroke" />
        {sel && (
          <line
            className="cp-selected"
            x1={cp.vertices_coords[sel[0]]![0]} y1={Y(cp.vertices_coords[sel[0]]![1])}
            x2={cp.vertices_coords[sel[1]]![0]} y2={Y(cp.vertices_coords[sel[1]]![1])}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {lines.map((l, i) => {
          const k = Math.max(v.w, v.h) * 3
          const [ox, oy] = l.origin
          const n = Math.hypot(l.vector[0], l.vector[1]) || 1
          const [ux, uy] = [l.vector[0] / n, l.vector[1] / n]
          return <line key={`l${i}`} className="cp-input" x1={ox - ux * k} y1={Y(oy - uy * k)} x2={ox + ux * k} y2={Y(oy + uy * k)} vectorEffect="non-scaling-stroke" />
        })}
        {candidates.map(([a, b], i) => (
          <line key={`c${i}`} className="cp-candidate" x1={a[0]} y1={Y(a[1])} x2={b[0]} y2={Y(b[1])} vectorEffect="non-scaling-stroke" />
        ))}
        {points.map((p, i) => (
          <circle key={`p${i}`} className="cp-point" cx={p[0]} cy={Y(p[1])} r={v.pad / 4} />
        ))}
        {issues.map(({ vertex, text }) => {
          const p = cp.vertices_coords[vertex]
          if (!p) return null
          return (
            <circle key={`i${vertex}`} className="cp-issue" cx={p[0]} cy={Y(p[1])} r={v.pad / 3} data-vertex={vertex}>
              <title>{text}</title>
            </circle>
          )
        })}
        {cursor && <circle className="cp-cursor" cx={cursor[0]} cy={Y(cursor[1])} r={v.pad / 6} />}
      </svg>
      <output className="cp-readout mono" aria-label="Cursor position">
        {cursor ? `x ${fmt(cursor[0])} y ${fmt(cursor[1])}` : ' '}
      </output>
    </div>
  )
}
