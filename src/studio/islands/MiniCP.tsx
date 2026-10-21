// Mini crease pattern: the unfolded sheet (the frame's paper-space vertices) in
// Yoshizawa–Randlett style. Valley = dashed, mountain = dash-dot, same ink;
// boundary solid. Strokes use vector-effect non-scaling-stroke so dashes keep
// their screen size. y is flipped so "up" on the sheet is up in the SVG.
import type { Frame } from '@engine'

// Same patterns as render/creases DASH (not imported: that module pulls in three.js).
export const MINI_DASH = { valley: '6 4', mountain: '6 3 1.5 3' } as const

const PAD = 0.04

export function MiniCP({ frame }: { frame: Frame }) {
  const v = frame.vertices_coords ?? []
  const e = frame.edges_vertices ?? []
  const a = frame.edges_assignment ?? []
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of v) {
    x0 = Math.min(x0, p[0]!); x1 = Math.max(x1, p[0]!)
    y0 = Math.min(y0, p[1]!); y1 = Math.max(y1, p[1]!)
  }
  if (!v.length) { x0 = y0 = 0; x1 = y1 = 1 }
  const w = x1 - x0 || 1
  const h = y1 - y0 || 1
  const pad = Math.max(w, h) * PAD
  const X = (x: number) => x - x0 + pad
  const Y = (y: number) => y1 - y + pad
  const lines = e.map(([i, j], k) => {
    const p = v[i!]
    const q = v[j!]
    if (!p || !q) return null
    const as = a[k]
    const common = { x1: X(p[0]!), y1: Y(p[1]!), x2: X(q[0]!), y2: Y(q[1]!), vectorEffect: 'non-scaling-stroke' as const }
    if (as === 'B') return <line key={k} {...common} className="cp-boundary" />
    if (as === 'V') return <line key={k} {...common} className="cp-valley" strokeDasharray={MINI_DASH.valley} />
    if (as === 'M') return <line key={k} {...common} className="cp-mountain" strokeDasharray={MINI_DASH.mountain} />
    return null
  })
  return (
    <svg
      className="mini-cp"
      role="img"
      aria-label="Crease pattern of the unfolded sheet"
      viewBox={`0 0 ${w + 2 * pad} ${h + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {lines}
    </svg>
  )
}
