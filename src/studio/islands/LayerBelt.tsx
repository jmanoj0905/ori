// The layer belt island (spec 09): a small frosted circle at the press point
// with a side view of the paper stack under it, one hairline per layer (top
// row = top layer). Where two layers are joined by a fold the paper turns back
// on itself: a half-round on the side the join lies toward on screen. The
// hovered row and every row above it (the layers the fold will take) are drawn
// in the accent. The input router owns the pointer, so the belt never takes
// pointer events; the gesture (useFoldGesture) opens, hovers and closes it.
import type { Vec2 } from '@engine'
import { useStudio } from '../store'
import { useUi } from '../ui'
import { BELT_RADIUS_PX, layerWords, rowPx } from '../belt'

/** What the belt needs from the Stage: where a folded-space point is on screen. */
export type BeltStage = { clientOf(p: Vec2): Vec2 }

const R = BELT_RADIUS_PX

export function LayerBelt({ stage }: { stage: BeltStage | null }) {
  const belt = useUi(s => s.belt)
  const grab = useStudio(s => s.gesture?.grab ?? null)
  if (!belt) return null
  const { faces, joins } = belt.stack
  const n = faces.length
  const r = rowPx(n)
  const half = (n * r) / 2
  const y = (i: number) => -half + (i + 0.5) * r
  // Every row the same length, kept inside the circle at the stack's top and bottom.
  const reach = Math.max(8, Math.sqrt(Math.max(0, R * R - half * half)) - 12)
  const bulge = Math.max(3, R - 8 - reach)
  const g = grab && stage ? stage.clientOf(grab) : null
  const picked = (i: number) => belt.hovered !== null && i <= belt.hovered
  return (
    <div className="island layer-belt" style={{ left: `${belt.clientX - R}px`, top: `${belt.clientY - R}px`, width: `${2 * R}px`, height: `${2 * R}px` }}>
      <svg role="listbox" aria-label="Layers" width={2 * R} height={2 * R} viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}>
        {faces.map((face, i) => (
          <line
            key={face}
            role="option"
            aria-label={layerWords(i + 1, n)}
            aria-selected={belt.hovered === i}
            data-picked={picked(i) ? '' : undefined}
            x1={-reach}
            x2={reach}
            y1={y(i)}
            y2={y(i)}
          />
        ))}
        {joins.map(j => {
          const c = g && stage ? stage.clientOf(j.at) : null
          const side = c && g && c[0] < g[0] ? -1 : 1
          const ry = (y(j.lower) - y(j.upper)) / 2
          const rx = Math.min(ry, bulge)
          const x = side * reach
          // The arc bows outward: clockwise on the right, counter-clockwise on the left.
          const d = `M ${x} ${y(j.upper)} A ${rx} ${ry} 0 0 ${side > 0 ? 1 : 0} ${x} ${y(j.lower)}`
          return <path key={`${j.upper}-${j.lower}-${j.at[0]}-${j.at[1]}`} d={d} aria-hidden="true" data-picked={picked(j.lower) ? '' : undefined} />
        })}
      </svg>
    </div>
  )
}
