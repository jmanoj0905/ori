/*
 * Compound folds: inside/outside reverse, squash and petal (spec §2, §5.5).
 *
 * Rabbit Ear 0.9.41's reverseFold / simpleSquashFold are stubs (R7), so each
 * fold is built here from `foldThrough` on face subsets plus direct edits of
 * edge assignments. A flat-folded state is fixed by its crease pattern and
 * which creases are folded (±180°) or open (0°): folded coordinates come from
 * a spanning-tree walk, so any edit that keeps every face's reflection
 * consistent across all its edges is a valid geometry; V vs M only decides
 * the layer order, which the solver checks (`withLayerOrder`, refusing
 * "No valid layer order exists for this fold."). Every result is re-rooted on
 * a face that did not move (`settleBy`, R10). Compound folds need a flat
 * model ("Flatten the model before this fold." otherwise) and always commit
 * flat (any progress > 0 completes the fold; partial compound folds aren't
 * representable).
 *
 * World terms: "valley" = toward the viewer (+z) as seen in the folded form;
 * foldThrough's kind is in these terms. Flipping an edge's V/M flips its
 * world sense too.
 *
 * REVERSE (grab on the flap's tip, drag = where the tip goes; crease L = the
 * drag's perpendicular bisector, as for a valley fold):
 *   1. The flap F = `selectFlap` with k ≥ 2 at grab. Its top layer T0 and
 *      bottom layer B0 at grab must be joined by a spine: a line Λ such that
 *      removing F's folded edges along Λ splits F into exactly two halves,
 *      T0's and B0's (flood fill), stacked contiguously at grab (T-half above
 *      B-half), with a spine edge reaching the moving side of L.
 *      Thick flaps (`thickHalves`, when no single line splits F that way): an
 *      even number m ≥ 4 of F's layers at grab, the top m/2 the T-half and
 *      the bottom m/2 the B-half (faces of F away from grab continue their
 *      neighbour's half across open edges). The halves must be mirror images
 *      through the flap's middle — each half's part beyond L covers the
 *      other's (sampled) — and be joined by folded edges reaching the moving
 *      side (they may lie on several lines). A crane's narrowed leg is the
 *      case: 8 layers whose halves are joined along the leg's outer edge, but
 *      each half is itself pleated — its layers are joined to each other
 *      only in pairs, along the axis — so neither half is one connected
 *      piece without the spine and the single-line test above fails. Λ is
 *      the join line with the most joins. Anything else:
 *      "This flap can't reverse-fold: it isn't folded in half.".
 *   2. inside iff the drag points into the flap's open side (from Λ toward
 *      grab): the tip goes in between the halves. Otherwise outside: it wraps
 *      around them.
 *   3. A plain valley fold of all of F along L (every tip layer reflected
 *      across L), then: the L-creases of one half flip V ↔ M — the T-half for
 *      inside (its tip turns down, into the middle), the B-half for outside —
 *      and every tip edge joining the two halves (the spine beyond L, on any
 *      join line) flips V ↔ M. Same geometry as the plain fold; only the
 *      layering changes, and the layer solve is the authority on whether the
 *      reversed tip fits between (inside) or around (outside) the halves.
 *
 * SQUASH (grab on the flap, the drag opens it; the geometry is the flap's):
 *   1. U = top face at grab, D = the one below. They must share a folded
 *      ridge edge r. The hinge h is a line through an end C of the ridge along
 *      U's/D's other inner edges, such that the U-layer and D-layer (flood
 *      fills not crossing r or h) touch the rest of the model only along h and
 *      each other only along r, and lie in the wedge between r and h.
 *   2. Bisector b of the wedge at C. Cut U and D along b and fold their ridge
 *      parts over it (one foldThrough): the ridge now lies on h.
 *   3. U goes to the far side of h: its hinge edges toggle folded ↔ open
 *      (open → folded as a world valley: U swings up and over), the ridge
 *      (U–D) opens flat, and U's b-crease flips V ↔ M (it is seen from the
 *      back after the flip, so U's ridge part ends on top of U's hinge part).
 *      The flap ends mirror-symmetric about h, the ridge pressed onto it.
 *   If the solver rejects that assignment, the other V/M choices for U's
 *   b-crease and hinge are tried in turn.
 *
 * PETAL (grab on the panel near its open point W, drag lifting it toward the
 * closed point C):
 *   1. The panel = the top face at grab plus faces joined to it by open (0°)
 *      edges. Its outline must be a kite W, m1, C, m2 with raw sides W–m1,
 *      W–m2 and folded sides m1–C, m2–C (e.g. a preliminary base's front);
 *      the partner faces across the folded side C–mi form the flap with it.
 *   2. Kite fold, twice ("two squash-like moves"): the bisector of the angle
 *      at W between W–mi and W–C meets C–mi at Ki; fold the panel + partner
 *      side i along W–Ki (both layers, valley), so W–mi lies on the axis W–C.
 *   3. Valley lift: fold the panel's faces along H = K1–K2, lifting W past
 *      C; the panel–partner edges that the kite folds laid along H (Ki–mi)
 *      open flat, so the partners' folded-in triangles stay behind and the
 *      sides collapse inward under the petal.
 *   On a preliminary base this gives the bird base's front petal; all its
 *   creases lie on Rabbit Ear's bird crease pattern (tested).
 *
 * Previews compute the same result without the layer solve and show its end
 * state (poses of the result frame); `angleDeg` reports progressToAngle.
 */
import { progressToAngle } from './gesture'
import { clipLineToPolygon, cross, sub } from './geometry'
import type { Step } from './history'
import { containsPoint, layerAt, withLayerOrder } from './layers'
import {
  FLATTEN,
  MISS,
  TOO_SHORT,
  creaseLine,
  dedupe,
  edgeFaces,
  facesEdges,
  hingeRate,
  inheritedAmong,
  isFlatFrame,
  originsBy,
  plan,
  refuse,
  settleBy,
  side,
  type Gesture,
  type Origin,
  type Preview,
} from './ops'
import { poses, treePoses } from './poses'
import { foldThrough, foldedCoords, windings } from './rabbit'
import type { FaceOrder, Frame, Line, Result, Tool, Vec2 } from './types'

export const REVERSE_NO = "This flap can't reverse-fold: it isn't folded in half."
export const SQUASH_NO = "This flap can't squash-fold: it isn't folded in half."
export const PETAL_NO = "This flap can't petal-fold."

const EPS = 1e-9
const GEO = 1e-7

type Built = {
  /** The settled (re-rooted) result, unsolved. */
  frame: Frame
  /** Other V/M choices with the same geometry, tried in order if the solver rejects `frame`. */
  alternatives?: () => Frame[]
  /** Faces of `frame` that move. */
  moving: number[]
  crease: [Vec2, Vec2][]
  k: number
  label: string
  params: Record<string, unknown>
}
type Out = Result<{ frame: Frame; step: Step }>

// ---- public ----

export function reverseFold(frame: Frame, g: Gesture): Out {
  return finish(g, 'reverse', cached(frame, g, buildReverse))
}

export function squashFold(frame: Frame, g: Gesture): Out {
  return finish(g, 'squash', cached(frame, g, buildSquash))
}

export function petalFold(frame: Frame, g: Gesture): Out {
  return finish(g, 'petal', cached(frame, g, buildPetal))
}

const BUILDERS: Record<Exclude<Tool, 'fold'>, (f: Frame, g: Gesture) => Result<{ built: Built }>> = {
  reverse: buildReverse,
  squash: buildSquash,
  petal: buildPetal,
}

/** Preview for the compound tools: the end state, unsolved. */
export function previewCompound(frame: Frame, g: Gesture): Result<{ preview: Preview }> {
  if (g.tool === 'fold') return refuse(MISS)
  const r = cached(frame, g, BUILDERS[g.tool])
  if (!r.ok) return r
  const b = r.built
  const out = b.frame
  return {
    ok: true,
    preview: {
      crease: b.crease,
      moving: b.moving,
      layers: b.k,
      angleDeg: progressToAngle(g.progress),
      poses: poses(out),
      blocked: false,
      frame: out,
    },
  }
}

// ---- shared ----

const buildCache = new WeakMap<Frame, { key: string; r: Result<{ built: Built }> }>()

/** Builds depend on everything but progress; cache the last one per frame. */
function cached(frame: Frame, g: Gesture, build: (f: Frame, g: Gesture) => Result<{ built: Built }>) {
  const key = JSON.stringify([g.tool, g.grab, g.target, g.layers, g.kind, g.snapAngle])
  const hit = buildCache.get(frame)
  if (hit && hit.key === key) return hit.r
  const r = build(frame, g)
  buildCache.set(frame, { key, r })
  return r
}

function finish(g: Gesture, kind: Tool, r: Result<{ built: Built }>): Out {
  if (!r.ok) return r
  if (progressToAngle(g.progress) < 1e-6) return refuse(TOO_SHORT)
  const b = r.built
  let solved = withLayerOrder(b.frame)
  for (const alt of solved.ok ? [] : (b.alternatives?.() ?? [])) {
    solved = withLayerOrder(alt)
    if (solved.ok) break
  }
  if (!solved.ok) return solved
  const step: Step = {
    kind,
    params: { tool: kind, grab: g.grab, target: g.target, layers: b.k, kind: g.kind, snapAngle: g.snapAngle, ...b.params },
    label: b.label,
    at: Date.now(),
  }
  return { ok: true, frame: solved.frame, step }
}

const isInner = (f: Frame, e: number, facesOf: number[][]) =>
  facesOf[e].length === 2 && !/^[Bb]$/.test(f.edges_assignment[e])
const isFolded = (f: Frame, e: number) => Math.abs(Math.abs(f.edges_foldAngle[e]) - 180) < 1e-6
const isOpen = (f: Frame, e: number) => Math.abs(f.edges_foldAngle[e]) < 1e-6

type Edits = { assignment: string[]; angle: number[] }
const editsOf = (f: Frame): Edits => ({ assignment: [...f.edges_assignment], angle: [...f.edges_foldAngle] })
const SWAP: Record<string, string> = { V: 'M', M: 'V', v: 'm', m: 'v' }
function flipVM(x: Edits, e: number) {
  x.assignment[e] = SWAP[x.assignment[e]] ?? x.assignment[e]
  x.angle[e] = -x.angle[e]
}
function open(x: Edits, e: number) {
  x.assignment[e] = 'F'
  x.angle[e] = 0
}
function fold(x: Edits, e: number, sign: number) {
  x.assignment[e] = sign > 0 ? 'V' : 'M'
  x.angle[e] = sign > 0 ? 180 : -180
}
const apply = (f: Frame, x: Edits): Frame => ({ ...f, edges_assignment: x.assignment, edges_foldAngle: x.angle })

const segOf = (f: Frame, e: number, coords: Vec2[]): [Vec2, Vec2] => {
  const [u, v] = f.edges_vertices[e]
  return [coords[u], coords[v]]
}
const lineOf = ([a, b]: readonly [Vec2, Vec2]): Line => ({ origin: a, vector: sub(b, a) })
const onLine = ([a, b]: readonly [Vec2, Vec2], l: Line) => Math.abs(side(a, l)) < GEO && Math.abs(side(b, l)) < GEO
const samePoint = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < GEO
const unit = (v: Vec2): Vec2 => {
  const n = Math.hypot(v[0], v[1])
  return [v[0] / n, v[1] / n]
}
const flipLine = (l: Line): Line => ({ origin: l.origin, vector: [-l.vector[0], -l.vector[1]] })
/** `l` oriented so that `p` is on its left. */
const leftOf = (l: Line, p: Vec2): Line => (side(p, l) < 0 ? flipLine(l) : l)

/** Flood fill from `seed` across inner edges accepted by `cross`. */
function flood(f: Frame, seed: number, facesOf: number[][], pass: (e: number) => boolean): Set<number> {
  const out = new Set([seed])
  const queue = [seed]
  while (queue.length) {
    const x = queue.pop()!
    for (const e of facesEdges(f, x, facesOf)) {
      if (!isInner(f, e, facesOf) || !pass(e)) continue
      for (const h of facesOf[e]) if (!out.has(h)) (out.add(h), queue.push(h))
    }
  }
  return out
}

/** Crease segments of `line` over the folded polygons of `faces`. */
function creaseOver(f: Frame, line: Line, faces: Iterable<number>, coords = foldedCoords(f)): [Vec2, Vec2][] {
  const segs: [Vec2, Vec2][] = []
  for (const x of faces) {
    const c = clipLineToPolygon(line, f.faces_vertices[x].map(v => coords[v]))
    if (c) segs.push(c)
  }
  return dedupe(segs)
}

type Cut = { cut: Frame; from: Origin[] }
type Stepped = { frame: Frame; parent: number[]; moving: number[] }

/**
 * Cut `subset` along `line` and fold the part on its left over it (valley,
 * 180°, unsolved). `from[f]` tells each cut face's parent and whether it moved.
 */
function cutFold(frame: Frame, line: Line, subset: Set<number>): Cut | null {
  const cut = foldThrough(frame, line, [...subset], 'valley', 180, { solve: false })
  if (!cut) return null
  const from = originsBy(frame, cut, (old, w) => subset.has(old) && side(w, line) > GEO)
  if (from.some(o => !o)) return null
  return { cut, from: from as Origin[] }
}

/**
 * Apply edits to a cut and re-root it on a face that didn't move (R10).
 * Rabbit Ear's solver takes faceOrders as constraints, so only the orders
 * among faces that didn't move (`from[f].moving` false) are kept — still
 * true, including between unmoved parts of the subset and untouched layers. `parent[f]` = the `frame` face
 * that settled face f came from.
 */
function settleCut(frame: Frame, { cut, from }: Cut, x: Edits): Stepped | null {
  const next: Frame = { ...apply(cut, x), faceOrders: inheritedAmong(frame, from, o => !o.moving) }
  const s = settleBy(frame, next, from, false)
  if (!s.ok) return null
  const parent: number[] = []
  from.forEach((o, f) => (parent[s.index[f]] = o.oldFace))
  return { frame: s.frame, parent, moving: s.moving }
}

/** cutFold + optional edits + settleCut. */
function step(
  frame: Frame,
  line: Line,
  subset: Set<number>,
  edit?: (cut: Frame, from: Origin[], x: Edits) => boolean,
): Stepped | null {
  const c = cutFold(frame, line, subset)
  if (!c) return null
  const x = editsOf(c.cut)
  if (edit && !edit(c.cut, c.from, x)) return null
  return settleCut(frame, c, x)
}

const ok = (built: Built): Result<{ built: Built }> => ({ ok: true, built })

/** Overlap area of two convex polygons (either winding), by Sutherland–Hodgman clipping. */
function overlap(p: readonly Vec2[], q: readonly Vec2[]): number {
  const ccw = (poly: readonly Vec2[]) => (signedArea(poly) < 0 ? [...poly].reverse() : [...poly])
  let out = ccw(p)
  const clip = ccw(q)
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i]
    const b = clip[(i + 1) % clip.length]
    const inside = (x: Vec2) => cross(sub(b, a), sub(x, a)) > -1e-12
    const next: Vec2[] = []
    for (let j = 0; j < out.length; j++) {
      const c = out[j]
      const d = out[(j + 1) % out.length]
      const ci = inside(c)
      const di = inside(d)
      if (ci) next.push(c)
      if (ci !== di) {
        const e = sub(d, c)
        const den = cross(sub(b, a), e)
        if (Math.abs(den) > 1e-15) {
          const t = cross(sub(b, a), sub(a, c)) / den
          next.push([c[0] + e[0] * t, c[1] + e[1] * t])
        }
      }
    }
    out = next
  }
  return out.length < 3 ? 0 : Math.abs(signedArea(out))
}

function signedArea(poly: readonly Vec2[]): number {
  let a = 0
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length]
    a += p[0] * q[1] - q[0] * p[1]
  })
  return a / 2
}

// ---- reverse ----

function buildReverse(frame: Frame, g: Gesture): Result<{ built: Built }> {
  if (!isFlatFrame(frame)) return refuse(FLATTEN)
  const pr = plan(frame, { ...g, layers: Math.max(2, g.layers) })
  if (!pr.ok) return pr
  const p = pr.plan
  const F = new Set(p.faces)
  const coords = foldedCoords(frame)
  const facesOf = edgeFaces(frame)
  const stack = layerAt(frame, g.grab).filter(f => F.has(f))
  if (stack.length < 2) return refuse(REVERSE_NO)
  const top = stack[0]
  const bottom = stack[stack.length - 1]
  const movingSide = (e: number) => segOf(frame, e, coords).some(q => side(q, p.line) > GEO)
  const ff = (e: number) => isInner(frame, e, facesOf) && facesOf[e].every(f => F.has(f)) && isFolded(frame, e)

  // find the spine line Λ
  const tried: Line[] = []
  let found: { spine: Line; half: Map<number, 0 | 1> } | null = null
  for (let e = 0; e < frame.edges_vertices.length && !found; e++) {
    if (!ff(e) || !movingSide(e)) continue
    const spine = lineOf(segOf(frame, e, coords))
    if (tried.some(l => onLine([l.origin, [l.origin[0] + l.vector[0], l.origin[1] + l.vector[1]]], spine))) continue
    tried.push(spine)
    const onSpine = (x: number) => ff(x) && onLine(segOf(frame, x, coords), spine)
    const pass = (x: number) => facesOf[x].every(f => F.has(f)) && !onSpine(x)
    const a = flood(frame, top, facesOf, pass)
    const b = flood(frame, bottom, facesOf, pass)
    if ([...a].some(f => b.has(f)) || a.size + b.size !== F.size) continue
    const half = new Map<number, 0 | 1>()
    a.forEach(f => half.set(f, 0))
    b.forEach(f => half.set(f, 1))
    const labels = stack.map(f => half.get(f)!)
    if (labels.some((l, i) => i > 0 && l < labels[i - 1])) continue // T-half above B-half
    const joins = frame.edges_vertices.some(
      (_, x) => onSpine(x) && movingSide(x) && half.get(facesOf[x][0]) !== half.get(facesOf[x][1]),
    )
    if (joins) found = { spine, half }
  }
  if (!found) found = thickHalves(frame, F, stack, coords, facesOf, ff, movingSide, p.line)
  if (!found) return refuse(REVERSE_NO)
  const { spine, half } = found

  // inside iff the drag points from the spine toward the open side (grab's side)
  const d = sub(g.target, g.grab)
  const inside = cross(spine.vector, d) * Math.sign(side(g.grab, spine)) > 0

  const r = step(frame, p.line, F, (cut, from, x) => {
    const fo = edgeFaces(cut)
    cut.edges_vertices.forEach((_, e) => {
      if (fo[e].length !== 2) return
      const [oa, ob] = fo[e].map(f => from[f])
      if (!F.has(oa.oldFace) || !F.has(ob.oldFace) || !/^[VMvm]$/.test(cut.edges_assignment[e])) return
      if (oa.moving !== ob.moving) {
        const tip = oa.moving ? oa : ob
        if (half.get(tip.oldFace) === (inside ? 0 : 1)) flipVM(x, e) // this half's tip turns the other way
      } else if (oa.moving && half.get(oa.oldFace) !== half.get(ob.oldFace)) flipVM(x, e) // the spine beyond L
    })
    return true
  })
  if (!r) return refuse(MISS)
  // Several flat states share this crease assignment (e.g. with two layers per
  // half, the outer layers' tips can nest around the inner ones). Steer the
  // solver to the reverse fold's own, as hints for overlapping pairs: inside,
  // every tip face lies between the halves (under the T-half's base, over the
  // B-half's); outside, the T-half's tip lies over every base face and the
  // B-half's under. The T-half's tip stays over the B-half's either way.
  // Without the hints (the alternative) the solver picks any valid state.
  const out = r.frame
  const oc = foldedCoords(out)
  const w = windings(out)
  const polys = out.faces_vertices.map(vs => vs.map(v => oc[v]))
  const movingSet = new Set(r.moving)
  const hints: FaceOrder[] = []
  const above = (a: number, b: number) => hints.push([a, b, w[b] ? 1 : -1])
  for (const t of r.moving) {
    const ht = half.get(r.parent[t])
    for (let b = 0; b < out.faces_vertices.length; b++) {
      if (b === t || !F.has(r.parent[b]) || overlap(polys[t], polys[b]) < 1e-9) continue
      const hb = half.get(r.parent[b])
      if (movingSet.has(b)) {
        if (ht === 0 && hb === 1) above(t, b) // the T-half's tip stays above the B-half's
      } else if (inside ? hb === 0 : ht === 1) above(b, t) // inside: under the T-half; outside: the B-half's tip goes under
      else above(t, b)
    }
  }
  return ok({
    frame: { ...out, faceOrders: [...out.faceOrders, ...hints] },
    alternatives: () => [out],
    moving: r.moving,
    crease: p.crease,
    k: stack.length,
    label: `${inside ? 'Inside' : 'Outside'} reverse fold · ${stack.length} layers`,
    params: { crease: p.line, inside },
  })
}

/**
 * Thick flaps (the fallback when no single spine line splits the flap into
 * two connected halves): the stack at grab, an even number m ≥ 4 of layers,
 * splits into its top and bottom m/2 (the two halves). Faces of the flap
 * away from grab join their neighbour's half across open (unfolded) edges.
 * The halves' parts beyond the crease must cover the same folded footprint
 * (mirror images through the flap's middle) and be joined by folded edges
 * reaching the moving side, on one or more lines. The spine Λ is the join
 * line with the most joins.
 */
function thickHalves(
  frame: Frame,
  F: Set<number>,
  stack: number[],
  coords: Vec2[],
  facesOf: number[][],
  ff: (e: number) => boolean,
  movingSide: (e: number) => boolean,
  crease: Line,
): { spine: Line; half: Map<number, 0 | 1> } | null {
  const m = stack.length
  if (m < 4 || m % 2 !== 0) return null
  const half = new Map<number, 0 | 1>()
  stack.forEach((f, i) => half.set(f, i < m / 2 ? 0 : 1))
  // faces of F not under grab: continue their layer across open edges
  for (let grew = true; grew; ) {
    grew = false
    frame.edges_vertices.forEach((_, e) => {
      if (!isInner(frame, e, facesOf) || !isOpen(frame, e)) return
      const [a, b] = facesOf[e]
      if (!F.has(a) || !F.has(b)) return
      if (half.has(a) !== half.has(b)) {
        const [known, other] = half.has(a) ? [a, b] : [b, a]
        half.set(other, half.get(known)!)
        grew = true
      }
    })
  }
  if ([...F].some(f => !half.has(f))) return null
  // the same footprint beyond the crease (the part that reverses): sample
  // points of each face's moving part lie on the other half's moving part
  const polys = frame.faces_vertices.map(vs => vs.map(v => coords[v]))
  const samples = (f: number): Vec2[] => {
    const poly = clipToLeft(polys[f], crease)
    if (poly.length < 3) return []
    const c: Vec2 = [poly.reduce((t, p) => t + p[0], 0) / poly.length, poly.reduce((t, p) => t + p[1], 0) / poly.length]
    return [c, ...poly.map(p => [c[0] + (p[0] - c[0]) * 0.9, c[1] + (p[1] - c[1]) * 0.9] as Vec2)]
  }
  const sides = [0, 1].map(h => [...F].filter(f => half.get(f) === h))
  for (const h of [0, 1])
    for (const f of sides[h])
      for (const q of samples(f)) if (!sides[1 - h].some(o => containsPoint(polys[o], q))) return null
  // folded joins between the halves, grouped by line
  const joins = frame.edges_vertices
    .map((_, e) => e)
    .filter(e => ff(e) && movingSide(e) && half.get(facesOf[e][0]) !== half.get(facesOf[e][1]))
  if (joins.length === 0) return null
  const lines: { line: Line; n: number }[] = []
  for (const e of joins) {
    const seg = segOf(frame, e, coords)
    const hit = lines.find(l => onLine(seg, l.line))
    if (hit) hit.n++
    else lines.push({ line: lineOf(seg), n: 1 })
  }
  lines.sort((a, b) => b.n - a.n)
  return { spine: lines[0].line, half }
}

/** The part of a convex polygon on the left of `l` (Sutherland–Hodgman, one edge). */
function clipToLeft(poly: readonly Vec2[], l: Line): Vec2[] {
  const out: Vec2[] = []
  poly.forEach((c, j) => {
    const d = poly[(j + 1) % poly.length]
    const sc = side(c, l)
    const sd = side(d, l)
    if (sc >= 0) out.push(c)
    if ((sc > 0 && sd < 0) || (sc < 0 && sd > 0)) {
      const t = sc / (sc - sd)
      out.push([c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t])
    }
  })
  return out
}

// ---- squash ----

type SquashFlap = { apex: Vec2; ridgeEnd: Vec2; hingeEnd: Vec2; U: Set<number>; D: Set<number> }

function findSquashFlap(frame: Frame, grab: Vec2): SquashFlap | null {
  const coords = foldedCoords(frame)
  const facesOf = edgeFaces(frame)
  const stack = layerAt(frame, grab)
  if (stack.length < 2) return null
  const [U0, D0] = stack
  const ridge = facesEdges(frame, U0, facesOf).filter(e => facesOf[e].includes(D0) && isFolded(frame, e))
  if (ridge.length === 0) return null
  const r = lineOf(segOf(frame, ridge[0], coords))
  if (!ridge.every(e => onLine(segOf(frame, e, coords), r))) return null
  // the ridge's extreme ends along r
  const ends = ridge.flatMap(e => segOf(frame, e, coords))
  const t = (q: Vec2) => (q[0] - r.origin[0]) * r.vector[0] + (q[1] - r.origin[1]) * r.vector[1]
  const lo = ends.reduce((a, b) => (t(b) < t(a) ? b : a))
  const hi = ends.reduce((a, b) => (t(b) > t(a) ? b : a))

  for (const [apex, ridgeEnd] of [[lo, hi], [hi, lo]] as [Vec2, Vec2][]) {
    const hinges = [U0, D0]
      .flatMap(f => facesEdges(frame, f, facesOf))
      .filter(e => isInner(frame, e, facesOf) && !onLine(segOf(frame, e, coords), r))
      .map(e => segOf(frame, e, coords))
      .filter(([a, b]) => samePoint(a, apex) || samePoint(b, apex))
    for (const sg of hinges) {
      const hingeEnd = samePoint(sg[0], apex) ? sg[1] : sg[0]
      const h = lineOf([apex, hingeEnd])
      const onH = (e: number) => onLine(segOf(frame, e, coords), h)
      const onR = (e: number) => onLine(segOf(frame, e, coords), r)
      const pass = (e: number) => !onH(e) && !onR(e)
      const U = flood(frame, U0, facesOf, pass)
      const D = flood(frame, D0, facesOf, pass)
      if ([...U].some(f => D.has(f))) continue
      let hingeEdges = 0
      let good = true
      for (const [layer, other] of [[U, D], [D, U]]) {
        for (const f of layer)
          for (const e of facesEdges(frame, f, facesOf)) {
            if (!isInner(frame, e, facesOf)) continue
            const n = facesOf[e].find(x => x !== f)!
            if (layer.has(n)) continue
            if (other.has(n)) good &&= onR(e) && isFolded(frame, e)
            else if (onH(e)) hingeEdges++
            else good = false
          }
      }
      if (!good || hingeEdges === 0) continue
      // the flap lies in the wedge between r (toward the hinge end) and h (toward the ridge end)
      const sh = Math.sign(side(ridgeEnd, h))
      const sr = Math.sign(side(hingeEnd, r))
      const inWedge = [...U, ...D].every(f =>
        frame.faces_vertices[f].every(v => side(coords[v], h) * sh > -GEO && side(coords[v], r) * sr > -GEO),
      )
      if (inWedge) return { apex, ridgeEnd, hingeEnd, U, D }
    }
  }
  return null
}

function buildSquash(frame: Frame, g: Gesture): Result<{ built: Built }> {
  if (!isFlatFrame(frame)) return refuse(FLATTEN)
  if (!creaseLine(g).ok) return refuse(TOO_SHORT)
  const flap = findSquashFlap(frame, g.grab)
  if (!flap) return refuse(SQUASH_NO)
  const { apex, ridgeEnd, hingeEnd, U, D } = flap
  const all = new Set([...U, ...D])
  const b = leftOf({ origin: apex, vector: [...addV(unit(sub(ridgeEnd, apex)), unit(sub(hingeEnd, apex)))] }, ridgeEnd)
  const h = leftOf(lineOf([apex, hingeEnd]), ridgeEnd) // U is on h's left: a +θ swing lifts it up and over
  const crease = creaseOver(frame, b, all)
  const oldTree = treePoses(frame)

  const c = cutFold(frame, b, all)
  if (!c) return refuse(SQUASH_NO)
  // the whole flap moves (U also turns over h), so re-root on the rest
  const cut: Cut = { cut: c.cut, from: c.from.map(o => ({ ...o, moving: all.has(o.oldFace) })) }
  const fo = edgeFaces(c.cut)
  const parentOf = (f: number) => cut.from[f].oldFace
  const hingeWasOpen = c.cut.edges_vertices.some((_, e) => isUHinge(e) && isOpen(c.cut, e))
  function isUHinge(e: number) {
    if (fo[e].length !== 2) return false
    const [pa, pb] = fo[e].map(parentOf)
    return U.has(pa) !== U.has(pb) && !all.has(U.has(pa) ? pb : pa)
  }
  const variant = (flipU: boolean, valley: boolean): Stepped | null => {
    const x = editsOf(c.cut)
    c.cut.edges_vertices.forEach((_, e) => {
      if (fo[e].length !== 2) return
      const [fa, fb] = fo[e]
      const [pa, pb] = [parentOf(fa), parentOf(fb)]
      if (pa === pb) {
        if (U.has(pa) && flipU) flipVM(x, e) // U's new b-crease
      } else if ((U.has(pa) && D.has(pb)) || (D.has(pa) && U.has(pb))) {
        open(x, e) // the ridge opens
      } else if (isUHinge(e)) {
        // U's hinge toggles: folded → open, or open → folded as U swings over h
        if (!isOpen(c.cut, e)) open(x, e)
        else {
          const [sf, tf] = U.has(pa) ? [fa, fb] : [fb, fa]
          fold(x, e, hingeRate(c.cut, e, sf, oldTree[parentOf(tf)], h) * (valley ? 1 : -1))
        }
      }
    })
    return settleCut(frame, cut, x)
  }
  const first = variant(true, true)
  if (!first) return refuse(SQUASH_NO)
  const moving = first.parent.map((p, f) => (all.has(p) ? f : -1)).filter(f => f >= 0)
  const others: [boolean, boolean][] = hingeWasOpen ? [[false, true], [true, false], [false, false]] : [[false, true]]
  const alternatives = () => others.map(([fu, v]) => variant(fu, v)?.frame).filter((f): f is Frame => !!f)
  return ok({ frame: first.frame, alternatives, moving, crease, k: 2, label: 'Squash fold', params: { apex, hinge: h } })
}

const addV = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]

// ---- petal ----

type Side = { a: Vec2; b: Vec2; raw: boolean }

/** The panel's outline as maximal straight sides, in order. */
function outline(frame: Frame, panel: Set<number>, coords: Vec2[], facesOf: number[][]): Side[] | null {
  const segs: Side[] = []
  for (const f of panel) {
    const vs = frame.faces_vertices[f]
    for (const e of facesEdges(frame, f, facesOf)) {
      const others = facesOf[e].filter(x => x !== f)
      if (others.some(x => panel.has(x))) continue
      const raw = !isInner(frame, e, facesOf)
      if (!raw && !isFolded(frame, e)) return null
      // orient along f's loop
      const [u, v] = frame.edges_vertices[e]
      const i = vs.indexOf(u)
      const forward = vs[(i + 1) % vs.length] === v
      const [a, b] = forward ? [coords[u], coords[v]] : [coords[v], coords[u]]
      segs.push({ a, b, raw })
    }
  }
  if (segs.length === 0) return null
  // chain (faces may be wound either way in folded space: follow endpoints)
  const chain: Side[] = [segs[0]]
  const used = new Set([0])
  while (used.size < segs.length) {
    const end = chain[chain.length - 1].b
    const i = segs.findIndex((s, k) => !used.has(k) && (samePoint(s.a, end) || samePoint(s.b, end)))
    if (i < 0) return null
    used.add(i)
    const s = segs[i]
    chain.push(samePoint(s.a, end) ? s : { a: s.b, b: s.a, raw: s.raw })
  }
  if (!samePoint(chain[chain.length - 1].b, chain[0].a)) return null
  // merge collinear runs of the same kind
  const sides: Side[] = []
  for (const s of chain) {
    const last = sides[sides.length - 1]
    if (last && last.raw === s.raw && Math.abs(cross(sub(last.b, last.a), sub(s.b, s.a))) < GEO) last.b = s.b
    else sides.push({ ...s })
  }
  const first = sides[0]
  const last = sides[sides.length - 1]
  if (sides.length > 1 && first.raw === last.raw && Math.abs(cross(sub(last.b, last.a), sub(first.b, first.a))) < GEO) {
    first.a = last.a
    sides.pop()
  }
  return sides
}

function intersect(l: Line, a: Vec2, b: Vec2): { p: Vec2; t: number } | null {
  const e = sub(b, a)
  const den = cross(l.vector, e)
  if (Math.abs(den) < EPS) return null
  const w = sub(a, l.origin)
  const t = cross(w, l.vector) / den
  return { p: [a[0] + e[0] * t, a[1] + e[1] * t], t }
}

function buildPetal(frame: Frame, g: Gesture): Result<{ built: Built }> {
  if (!isFlatFrame(frame)) return refuse(FLATTEN)
  if (!creaseLine(g).ok) return refuse(TOO_SHORT)
  const coords = foldedCoords(frame)
  const facesOf = edgeFaces(frame)
  const stack = layerAt(frame, g.grab)
  if (stack.length === 0) return refuse(MISS)
  const panel = flood(frame, stack[0], facesOf, e => isOpen(frame, e))
  const sides = outline(frame, panel, coords, facesOf)
  if (!sides || sides.length !== 4) return refuse(PETAL_NO)
  const i = sides.findIndex((s, k) => s.raw && sides[(k + 1) % 4].raw)
  if (i < 0 || sides[(i + 2) % 4].raw || sides[(i + 3) % 4].raw) return refuse(PETAL_NO)
  const W = sides[i].b
  const m1 = sides[i].a
  const m2 = sides[(i + 1) % 4].b
  const C = sides[(i + 2) % 4].b
  const len = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
  if (Math.abs(len(W, m1) - len(W, m2)) > GEO || Math.abs(len(C, m1) - len(C, m2)) > GEO) return refuse(PETAL_NO)
  const axis = sub(C, W)
  const d = sub(g.target, g.grab)
  if (d[0] * axis[0] + d[1] * axis[1] <= 0) return refuse(PETAL_NO)

  const kites = [m1, m2].map(m => {
    const k: Line = { origin: W, vector: addV(unit(sub(m, W)), unit(axis)) }
    const hit = intersect(k, C, m)
    return hit && hit.t > GEO && hit.t < 1 - GEO ? { m, K: hit.p, line: leftOf(k, m) } : null
  })
  if (kites.some(k => !k)) return refuse(PETAL_NO)
  const [k1, k2] = kites as { m: Vec2; K: Vec2; line: Line }[]

  // partners: the faces across the panel's folded side C–m
  const partnersOf = (m: Vec2) => {
    const sideLine = lineOf([C, m])
    const out = new Set<number>()
    for (const f of panel)
      for (const e of facesEdges(frame, f, facesOf)) {
        const n = facesOf[e].find(x => x !== f)
        if (n !== undefined && !panel.has(n) && isInner(frame, e, facesOf) && onLine(segOf(frame, e, coords), sideLine)) out.add(n)
      }
    return out
  }

  // origin (in `frame`) of each face, carried through the steps
  let cur = frame
  let root: number[] = frame.faces_vertices.map((_, f) => f)
  const advance = (s: { frame: Frame; parent: number[] }) => {
    root = s.parent.map(p => root[p])
    cur = s.frame
  }
  for (const k of [k1, k2]) {
    const subset = new Set([...panel, ...partnersOf(k.m)])
    const s = step(cur, k.line, new Set(root.map((r, f) => (subset.has(r) ? f : -1)).filter(f => f >= 0)))
    if (!s) return refuse(PETAL_NO)
    advance(s)
  }
  // valley lift along H = K1–K2: the panel's faces below H turn up; the
  // panel–partner edges lying on H open flat
  const H = leftOf(lineOf([k1.K, k2.K]), W)
  const lifted = new Set(root.map((r, f) => (panel.has(r) ? f : -1)).filter(f => f >= 0))
  const s = step(cur, H, lifted, (cut, from, x) => {
    const fo = edgeFaces(cut)
    let fine = true
    cut.edges_vertices.forEach((_, e) => {
      if (fo[e].length !== 2) return
      const [oa, ob] = fo[e].map(f => from[f])
      if (oa.moving === ob.moving) return
      const still = oa.moving ? ob : oa
      if (lifted.has(still.oldFace)) return // the new H crease
      // a non-panel face hinged to a lifted one: only along H
      const mover = oa.moving ? oa : ob
      const [u, v] = cut.edges_vertices[e]
      const onH = [u, v].every(q => {
        const p = cut.vertices_coords[q]
        const w = transformPoint(mover.pose, p)
        return Math.abs(side(w, H)) < GEO
      })
      if (onH) open(x, e)
      else fine = false
    })
    return fine
  })
  if (!s) return refuse(PETAL_NO)
  advance(s)
  // The partners' kite creases turn the other way: each partner's folded-in
  // triangle tucks under its partner (Maekawa at Ki once Ki–mi opens flat),
  // so the sides end inside, under the petal, as in the bird base.
  const partners = new Set([...partnersOf(m1), ...partnersOf(m2)])
  const fo = edgeFaces(cur)
  const x = editsOf(cur)
  cur.edges_vertices.forEach((_, e) => {
    const fs = fo[e]
    if (fs.length === 2 && root[fs[0]] === root[fs[1]] && partners.has(root[fs[0]])) flipVM(x, e)
  })
  cur = apply(cur, x)
  const touched = new Set([...panel, ...partners])
  const moving = root.map((r, f) => (touched.has(r) ? f : -1)).filter(f => f >= 0)
  const crease: [Vec2, Vec2][] = [[W, k1.K], [W, k2.K], [k1.K, k2.K]]
  return ok({ frame: cur, moving, crease, k: 1, label: 'Petal fold', params: { W, C, K: [k1.K, k2.K] } })
}

const transformPoint = (pose: Origin['pose'], p: Vec2): Vec2 => {
  const r = pose.r
  return [r[0] * p[0] + r[1] * p[1] + pose.t[0], r[3] * p[0] + r[4] * p[1] + pose.t[1]]
}

