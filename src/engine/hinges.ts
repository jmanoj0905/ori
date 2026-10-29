// Hinge candidates (spec 09): the existing creases a grabbed flap hangs on,
// so a drag can swing the flap about one of them instead of making a new
// crease. A pure query over hingePlan (ops.ts): it groups the folded edges by
// their folded-space line and keeps each line on which the flap at `grab`
// would hinge-fold. Cached per frame (like landmarks), so the UI can ask
// every pointer move.
import { edgeFaces, hingePlan, isFlatFrame, side } from './ops'
import { foldedCoords } from './rabbit'
import type { FoldKind, Frame, Line, Vec2 } from './types'

export type HingeCandidate = {
  /** The hinge line in folded space, oriented so `grab` is on its left (side > 0). */
  line: Line
  /** Folded-space hinge segments, for drawing. */
  segments: [Vec2, Vec2][]
  /** The flap (input-frame face ids). */
  faces: number[]
  /** Layers taken (selectFlap's clamp). */
  k: number
  /** The kind whose swing moves the hinge toward 0°. */
  openKind: FoldKind
  /** |current hinge angle|: how far it can swing open. */
  rangeDeg: number
}

const LINE_EPS = 1e-7
const KEEP = 8

const isFlatAngle = (a: number) => Math.abs(a) < 1e-6 || Math.abs(Math.abs(a) - 180) < 1e-6

const cache = new WeakMap<Frame, Map<string, HingeCandidate[]>>()
const linesCache = new WeakMap<Frame, Line[]>()

/** The distinct folded-space lines carrying folded, non-boundary edges (hingePlan's `along` filter). */
function foldedLines(frame: Frame): Line[] {
  const hit = linesCache.get(frame)
  if (hit) return hit
  const coords = foldedCoords(frame)
  const flat = isFlatFrame(frame)
  const facesOf = edgeFaces(frame)
  const lines: Line[] = []
  for (let e = 0; e < frame.edges_vertices.length; e++) {
    if (facesOf[e].length !== 2 || /^[Bb]$/.test(frame.edges_assignment[e])) continue
    const angle = frame.edges_foldAngle[e]
    if (flat ? Math.abs(angle) <= 1e-6 : isFlatAngle(angle)) continue
    const [u, v] = frame.edges_vertices[e]
    const a = coords[u]
    const b = coords[v]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len <= LINE_EPS) continue
    if (lines.some(l => Math.abs(side(a, l)) < LINE_EPS && Math.abs(side(b, l)) < LINE_EPS)) continue
    lines.push({ origin: [a[0], a[1]], vector: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] })
  }
  linesCache.set(frame, lines)
  return lines
}

function compute(frame: Frame, grab: Vec2, k: number, face: number | undefined): HingeCandidate[] {
  const out: HingeCandidate[] = []
  for (const l of foldedLines(frame)) {
    const s = side(grab, l)
    if (Math.abs(s) < LINE_EPS) continue
    const line: Line = s > 0 ? l : { origin: l.origin, vector: [-l.vector[0], -l.vector[1]] }
    const h = hingePlan(frame, {
      tool: 'fold',
      grab,
      target: grab,
      layers: k,
      kind: 'valley',
      progress: 0,
      snapAngle: false,
      crease: line,
      ...(face === undefined ? {} : { face }),
    })
    if (!h || !h.ok) continue
    const { e, rate } = h.hinge.edges[0]
    const a = frame.edges_foldAngle[e]
    // a swing of kind `dir` changes the angle by rate·dir·θ (hingeAngles): toward 0 when dir = −sign(a·rate)
    out.push({
      line: h.hinge.line,
      segments: h.hinge.crease,
      faces: h.hinge.faces,
      k: h.hinge.k,
      openKind: -Math.sign(a * rate) > 0 ? 'valley' : 'mountain',
      rangeDeg: Math.abs(a),
    })
  }
  return out
}

/**
 * The hinges the flap at `grab` (top `k` layers, from `face` if given) can
 * swing on: one per existing folded crease line on which a fold gesture would
 * be a hinge fold (hingePlan). A line through `grab` is skipped. Each
 * candidate's `openKind` swings it back toward flat, by at most `rangeDeg`.
 */
export function hingesAt(frame: Frame, grab: Vec2, k: number, face?: number): HingeCandidate[] {
  let byKey = cache.get(frame)
  if (!byKey) cache.set(frame, (byKey = new Map()))
  const key = `${grab},${k},${face}`
  let hit = byKey.get(key)
  if (hit) {
    // most recently used last
    byKey.delete(key)
    byKey.set(key, hit)
  } else {
    hit = compute(frame, [grab[0], grab[1]], k, face)
    byKey.set(key, hit)
    while (byKey.size > KEEP) byKey.delete(byKey.keys().next().value!)
  }
  return [...hit]
}
