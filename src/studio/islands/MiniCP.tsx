// Mini crease pattern: the unfolded sheet (the frame's paper-space vertices) in
// Yoshizawa–Randlett style. Valley = dashed, mountain = dash-dot, same ink;
// boundary solid. Strokes use vector-effect non-scaling-stroke so dashes keep
// their screen size. y is flipped so "up" on the sheet is up in the SVG.
import type { Frame } from '@engine'
import { DASH, creasePatternLayout } from '../../persistence/creasePattern'

// Same patterns as render/creases DASH (not imported: that module pulls in three.js).
export const MINI_DASH = DASH

export function MiniCP({ frame }: { frame: Frame }) {
  const { width, height, segments } = creasePatternLayout(frame)
  const lines = segments.map((s, k) => {
    const common = { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, vectorEffect: 'non-scaling-stroke' as const }
    if (s.kind === 'boundary') return <line key={k} {...common} className="cp-boundary" />
    if (s.kind === 'valley') return <line key={k} {...common} className="cp-valley" strokeDasharray={DASH.valley} />
    return <line key={k} {...common} className="cp-mountain" strokeDasharray={DASH.mountain} />
  })
  return (
    <svg
      className="mini-cp"
      role="img"
      aria-label="Crease pattern of the unfolded sheet"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {lines}
    </svg>
  )
}
