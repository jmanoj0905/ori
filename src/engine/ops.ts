/*
 * Gesture → preview / commit (valley and mountain folds).
 *
 * A gesture is a grab point, a target point (both in folded/world space, the
 * root-face-0 folded form), a layer count k, a fold kind, a drag progress and
 * an angle-snap flag, optionally with numeric input (an exact `crease` and/or
 * `angleDeg`) and the hit `face` (see `Gesture`). `preview` is called on
 * every pointer move; `commit` on release. Both first validate the gesture
 * (`checkGesture`: non-finite input refuses "Drag further to fold.") and
 * share `plan()`:
 *
 *   1. crease = `g.crease` if given, else the perpendicular bisector of
 *      grab → target (`creaseFromDrag`); a (near) zero-length drag refuses
 *      with "Drag further to fold.". With `snapAngle`, the bisector is
 *      rotated to the nearest 22.5° step about the MIDPOINT of the drag (the
 *      point the unsnapped crease passes through, so a nearly-aligned drag
 *      barely moves). The fold angle is `g.angleDeg` if given, else
 *      progressToAngle(progress) (`requestedAngle`).
 *   2. The crease is oriented so that `grab` lies on the LEFT of
 *      `line.vector`. The moving side is the grab side.
 *   3. `selectFlap` picks the top k layers at grab (k clamped; reported as
 *      `Preview.layers`) plus the faces hinged to them on the moving side.
 *   4. Refusals, "That crease misses the paper.":
 *        - nothing under grab;
 *        - the crease clipped to the selected faces' folded polygons is empty;
 *        - nothing would stay put (every face is selected and lies wholly on
 *          the grab side, e.g. a crease beyond the paper or along its edge).
 *          The spec gives no wording for "moves all of the paper"; it is the
 *          same situation as a crease that misses, so it shares the message.
 *   5. The partial-fold rule (`partialFoldRule`, Review Focus 5): on a model
 *      with a non-flat fold only a single planar face may take a new crease;
 *      otherwise "Flatten the model before this fold.".
 *
 * Hinge folds (`hingePlan`, checked before `plan`): a crease along existing
 * folded edges turns the flap hanging on them about them — the swung flap of
 * a partial fold (finishing or changing it), or, on a flat model, lifting a
 * flap back over its hinge (unfolding it).
 *
 * Valley/mountain → swing: with grab on the left of the axis, a positive
 * swing lifts the flap toward +z (poses.ts right-hand rule), so valley uses
 * +angle and mountain −angle. RE's foldThrough interprets V/M in folded space
 * as seen from +z, so a committed valley also lands the flap on top.
 *
 * Preview (R11): the "edited" frame is `foldThrough(frame, crease, faces,
 * kind, 0°, { solve: false })` — the crease cut into the selected layers but
 * still flat-open, so the world is unchanged. Moving faces are its faces that
 * descend from selected faces and lie on the grab side. `sweep` runs from 0
 * on that frame toward ±progressToAngle(progress); when blocked, `angleDeg`
 * = |freeDeg|. Poses are the edited frame's poses with the swing applied,
 * and `Preview.frame` is the edited frame (`moving` and `poses` index its
 * faces — the input frame has fewer). The edited frame is cached per input
 * frame for the last (crease, faces, kind), so progress-only moves are cheap.
 * On a flat model the preview builds that frame directly (`cutFlat`, the
 * fast path: only the selected faces the crease crosses are cut, no
 * foldThrough), the same frame up to face/vertex/edge numbering and minus
 * the derived adjacency arrays; commit always takes the foldThrough path.
 * `Preview.valid` (see `Validity`): a preview whose commit would be a flat
 * fold of a flat model runs that commit's fold and layer solve (`flatFold`,
 * cached the same way and reused by commit) when the result has at most
 * VALID_SOLVE_MAX_FACES faces, else reports 'unknown'; every other fold
 * commits non-flat and is valid.
 *
 * Commit:
 *   - flat (progress → 180° on a flat model): fold at 180° regardless of the
 *     sweep (spec §4: collision never affects committed geometry; the layer
 *     order is the authority) and solve the layer order once
 *     (`withLayerOrder`, refusing "No valid layer order exists for this fold.").
 *   - otherwise (< 180°, or any fold of a model that already has a partial
 *     fold): the angle is clamped to the sweep's free angle (what
 *     the preview showed; nothing else would catch a 3D pass-through). A
 *     fold blocked at 0° refuses "Something is in the way of this fold.".
 *     The partial edges_foldAngle is kept and the layer solve skipped; the
 *     last solved faceOrders are carried (R2).
 *
 * R10, the world stays put: the adapter always roots face 0 at the identity,
 * and RE moves the side away from face 0. After the fold we pick a face `s`
 * that should have stayed put (it descends from an unselected face or from
 * the non-grab side of a selected one) whose old world pose is planar, and
 * re-root on it (`reroot`): it becomes face 0 (faces renumbered, faceOrders
 * remapped, adjacency rebuilt) and the paper coordinates are moved by its old
 * pose A so that its paper placement equals its world placement. Preference:
 *   1. A = identity (some never-moved paper stays put): a pure renumbering,
 *      paper coordinates untouched. This is the usual case.
 *   2. A a rotation: paper coordinates rotated/translated by A.
 *   3. A a reflection (only flipped layers stay put): paper coordinates
 *      mirrored by A, so the paper's front becomes the old back: each face's
 *      vertex order is reversed (to stay counter-clockwise), V ↔ M swapped,
 *      fold angles and faceOrders signs negated. The physical state is
 *      identical.
 * Cases 2 and 3 change paper space between frames (rigidly); undo is
 * unaffected since frames are independent. If no planar stationary face
 * exists the commit refuses "Flatten the model before this fold.".
 *
 * Turn over (`turnOver`): the model is rotated 180° about the vertical axis
 * x = cx through its folded bounding-box centre (world (x, y, z) →
 * (2cx − x, y, −z)). Face 0's world pose becomes that rotation, a planar
 * reflection of its paper coordinates, so this IS reroot's mirror case with
 * s = 0 and A = (x → 2cx − x): paper coordinates mirrored, faces reversed (still
 * counter-clockwise), V ↔ M, fold angles and faceOrders signs negated; face
 * ids, vertex ids and edge ids unchanged. The folded form is mirrored about
 * x = cx and the stack reversed (windings in folded view are unchanged — two
 * orientation flips — while every order sign flips). Turning over twice is
 * exact in everything but the coordinates (sign flips and reversals are
 * involutions; cx is the same both times); coordinates come back to within
 * rounding (2cx − (2cx − x)).
 *
 * Tool dispatch: `preview`/`commit` switch on `g.tool`: 'fold' here,
 * 'reverse' / 'squash' / 'petal' in compound.ts (which reuses `plan`,
 * `originsBy`, `settleBy` and friends exported from here).
 */
import { SCULPTED, sculptOf } from './sculpt'
import { sweep } from './collision'
import { clipLineToPolygon, cross, scale, add, sub } from './geometry'
import { creaseFromDrag, progressToAngle, snapAngle as snapLine } from './gesture'
import type { Step } from './history'
import { petalFold, previewCompound, reverseFold, squashFold } from './compound'
import { NO_ORDER, containsPoint, selectFlap, withLayerOrder } from './layers'
import { poses, transform, treePoses, type FacePose, type Rigid } from './poses'
import { foldThrough, foldedCoords, makeSheet, primeFoldedCoords, rebuildAdjacency } from './rabbit'
import type { FaceOrder, FoldKind, Frame, Line, Ok, PaperSize, Refusal, Result, Tool, Vec2 } from './types'

export type Gesture = {
  tool: Tool
  grab: Vec2
  target: Vec2
  layers: number
  kind: FoldKind
  progress: number
  snapAngle: boolean
  /**
   * Numeric input (spec §5 "exact crease coordinates"; spec 03 "two points, or
   * a point plus an angle", which the UI turns into a line): the crease, in
   * folded (world) space, instead of the drag's perpendicular bisector. Its
   * direction doesn't matter; `grab` still picks the moving side (the side
   * holding it) and the flap. `snapAngle` doesn't rotate it. Used by 'fold'
   * and 'reverse'; squash and petal take their creases from the flap's
   * geometry and ignore it (as they ignore the bisector). `target` is still
   * the drag direction for reverse (inside/outside) and petal. Refused "Drag
   * further to fold." when non-finite, zero-length or through `grab`.
   */
  crease?: Line
  /**
   * Numeric input: the exact fold angle in degrees, overriding `progress`
   * (asking 90 commits exactly 90). Must lie in [0, 180] ("The fold angle
   * must be between 0° and 180°." otherwise); non-finite is refused "Drag
   * further to fold.". The sweep can still clamp a partial fold (blocked);
   * compound tools complete on any angle > 0, as for progress.
   */
  angleDeg?: number
  /**
   * The face hit at grab (spec §5.1). When it is one of the faces at `grab`,
   * the top-k selection starts from its place in the stack (k counts from it
   * down, clamped to the layers below), which disambiguates grabs on a vertex
   * or edge, where faces merely touching the point would count toward k.
   * Otherwise ignored. Non-finite is refused "Drag further to fold.".
   */
  face?: number
}

/**
 * Preview.valid: whether committing this same gesture would pass the
 * layer-order check ("No valid layer order exists for this fold.").
 *   - true: the commit takes no layer solve (it ends non-flat: a partial fold
 *     or swing, so nothing to check — R2), or the solve was run and found an
 *     order.
 *   - false: the solve was run and found none; the commit would be refused.
 *   - 'unknown': the commit would solve, but the result has more than
 *     `VALID_SOLVE_MAX_FACES` faces, so the preview skipped it (a full solve
 *     per pointer move is too slow there; Plan 2 reworks this).
 * Only the layer order: other refusals (e.g. a partial fold blocked at 0°,
 * "Something is in the way of this fold.") show as `blocked`/the refusal
 * itself. It describes the gesture as given: during a drag (progress < 1)
 * the commit would be partial, hence true; preview with progress 1 (or
 * angleDeg 180) to ask about the flat landing. Results are cached per frame
 * and crease, so progress-only moves don't re-solve, and a commit after a
 * checked preview reuses the solve.
 */
export type Validity = boolean | 'unknown'

/** Preview.valid skips the layer solve on results with more faces than this. */
export const VALID_SOLVE_MAX_FACES = 16

export type Preview = {
  /** Crease segments in folded (world) space, one per distinct cut. */
  crease: [Vec2, Vec2][]
  /** Moving face ids — of `frame`, the edited frame. */
  moving: number[]
  /** The clamped layer count k. */
  layers: number
  /** The fold angle shown, in [0, 180]; |freeDeg| when blocked. */
  angleDeg: number
  /** One pose per face of `frame`, the moving faces swung to ±angleDeg. */
  poses: FacePose[]
  blocked: boolean
  /** Whether the commit would find a layer order: see `Validity`. */
  valid: Validity
  /** The edited frame (crease cut in, still flat-open) that `moving`/`poses` index. */
  frame: Frame
}

export const MISS = 'That crease misses the paper.'
export const TOO_SHORT = 'Drag further to fold.'
export const IN_THE_WAY = 'Something is in the way of this fold.'
export const FLATTEN = 'Flatten the model before this fold.'
export const ANGLE_RANGE = 'The fold angle must be between 0° and 180°.'

const EPS = 1e-9
const SNAP_STEP = 22.5
/** Below this a committed angle is no fold at all. */
const MIN_ANGLE = 1e-6

export const refuse = (reason: string): Refusal => ({ ok: false, reason })
const isFlatAngle = (a: number) => Math.abs(a) < 1e-6 || Math.abs(Math.abs(a) - 180) < 1e-6
export const isFlatFrame = (f: Frame) => f.edges_foldAngle.every(isFlatAngle)

// ---- dispatch ----

export function preview(frame: Frame, g: Gesture): Result<{ preview: Preview }> {
  if (sculptOf(frame)) return refuse(SCULPTED)
  const bad = checkGesture(g)
  if (bad) return bad
  switch (g.tool) {
    case 'fold':
      return previewFold(frame, g)
    case 'reverse':
    case 'squash':
    case 'petal':
      return previewCompound(frame, g)
  }
}

export function commit(frame: Frame, g: Gesture): Result<{ frame: Frame; step: Step }> {
  if (sculptOf(frame)) return refuse(SCULPTED)
  const bad = checkGesture(g)
  if (bad) return bad
  switch (g.tool) {
    case 'fold':
      return commitFold(frame, g)
    case 'reverse':
      return reverseFold(frame, g)
    case 'squash':
      return squashFold(frame, g)
    case 'petal':
      return petalFold(frame, g)
  }
}

const finite = (...xs: readonly number[]) => xs.every(Number.isFinite)

/**
 * Input validation shared by `preview` and `commit`: a gesture with a
 * non-finite grab, target, progress, crease, angleDeg or face is refused
 * "Drag further to fold." (the same quiet refusal as a zero-length drag), so
 * NaN never reaches the geometry, a label or the history; an angleDeg
 * outside [0, 180] is refused with ANGLE_RANGE.
 */
function checkGesture(g: Gesture): Refusal | null {
  if (!finite(g.grab[0], g.grab[1], g.target[0], g.target[1], g.progress)) return refuse(TOO_SHORT)
  if (g.crease && !finite(g.crease.origin[0], g.crease.origin[1], g.crease.vector[0], g.crease.vector[1]))
    return refuse(TOO_SHORT)
  if (g.face !== undefined && !Number.isFinite(g.face)) return refuse(TOO_SHORT)
  if (g.angleDeg !== undefined) {
    if (!Number.isFinite(g.angleDeg)) return refuse(TOO_SHORT)
    if (g.angleDeg < 0 || g.angleDeg > 180) return refuse(ANGLE_RANGE)
  }
  return null
}

/**
 * The fold angle the gesture asks for, in [0, 180]: `angleDeg` if given, else from progress.
 * Within 1e-6 of 180 it is 180: a drag released on the mirror point comes out of the
 * pointer maths a hair short (progress 0.99999996 → 179.99999999999994°), and every
 * other part of the engine (isFlatAngle) already calls that angle flat; without this
 * the commit took the partial path and skipped the layer solve.
 */
export const requestedAngle = (g: Gesture): number => {
  const a = g.angleDeg ?? progressToAngle(g.progress)
  return Math.abs(a - 180) < 1e-6 ? 180 : a
}

/** Gesture params a step records beyond the common ones (only those given). */
export const extraParams = (g: Gesture) => (g.face === undefined ? {} : { face: g.face })

// ---- paper and turn over ----

export const PAPER_SIZES = Object.freeze({
  square: Object.freeze({ width: 1, height: 1 }),
  a4: Object.freeze({ width: 1, height: Math.SQRT2 }),
}) satisfies Record<string, PaperSize>

/** The first frame: a flat, unfolded sheet of `size` paper units, corner at the origin. */
export const createPaper = (size: PaperSize): Frame => makeSheet(size)

/** Turn the model over (see the header): mirror about x = folded bbox centre, stack reversed. */
export function turnOver(frame: Frame): Ok<{ frame: Frame; step: Step }> {
  const xs = foldedCoords(frame).map(p => p[0])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const A: Planar = { a: -1, b: 0, c: 0, d: 1, tx: 2 * cx, ty: 0, det: -1, identity: false }
  const { frame: out } = reroot(frame, 0, A)
  return { ok: true, frame: out, step: { kind: 'turnOver', params: { axisX: cx }, label: 'Turn over', at: Date.now() } }
}

// ---- shared planning ----

export type Plan = {
  /** The crease, oriented so that grab is on its left (the moving side). */
  line: Line
  /** Selected faces of the input frame. */
  faces: number[]
  /** Clamped k. */
  k: number
  crease: [Vec2, Vec2][]
}

/** Signed distance of `p` from `l`, positive on its left. */
export const side = (p: readonly number[], l: Line) =>
  cross(l.vector, sub([p[0], p[1]], l.origin)) / Math.hypot(l.vector[0], l.vector[1])

/**
 * The gesture's crease, oriented so that grab is on its left: the exact
 * `g.crease` if given, else the drag's bisector (snapped if asked).
 */
export function creaseLine(g: Gesture): Result<{ line: Line }> {
  let line: Line
  if (g.crease) {
    if (Math.hypot(g.crease.vector[0], g.crease.vector[1]) < 1e-12) return refuse(TOO_SHORT)
    line = { origin: [g.crease.origin[0], g.crease.origin[1]], vector: [g.crease.vector[0], g.crease.vector[1]] }
  } else {
    const raw = creaseFromDrag(g.grab, g.target)
    if (!raw) return refuse(TOO_SHORT)
    line = g.snapAngle ? snapLine(raw, scale(add(g.grab, g.target), 0.5), SNAP_STEP) : raw
  }
  const s = side(g.grab, line)
  if (Math.abs(s) < EPS) return refuse(TOO_SHORT)
  return { ok: true, line: s < 0 ? { origin: line.origin, vector: [-line.vector[0], -line.vector[1]] } : line }
}

export function plan(frame: Frame, g: Gesture): Result<{ plan: Plan }> {
  const cl = creaseLine(g)
  if (!cl.ok) return cl
  const line = cl.line

  const sel = selectFlap(frame, g.grab, g.layers, line, g.face)
  if (sel.faces.length === 0) return refuse(MISS)

  const coords = foldedCoords(frame)
  const crease = dedupe(
    sel.faces
      .map(f => clipLineToPolygon(line, frame.faces_vertices[f].map(v => coords[v])))
      .filter((c): c is [Vec2, Vec2] => c !== null),
  )
  if (crease.length === 0) return refuse(MISS)

  const selected = new Set(sel.faces)
  const somethingStays = frame.faces_vertices.some(
    (vs, f) => !selected.has(f) || vs.some(v => side(coords[v], line) < -EPS),
  )
  if (!somethingStays) return refuse(MISS)

  const rule = partialFoldRule(frame, sel.faces, g.grab)
  if (rule) return rule
  return { ok: true, plan: { line, faces: sel.faces, k: sel.k, crease } }
}

/**
 * The partial-fold rule (spec §2, Review Focus 5) for a fold along a NEW
 * crease. On a model with a non-flat fold, the 2D folded coordinates that
 * `layerAt`/`selectFlap` read are a projection, exact only for faces lying in
 * the z = 0 plane. A new crease is therefore allowed only when it is a rigid
 * single-flap hinge rotation that the projection describes exactly:
 *   - exactly one face is selected (one layer, nothing hinged to it on the
 *     moving side — a hinge there would carry other flaps, possibly 3D ones);
 *   - that face lies in the plane (planar world pose);
 *   - every face whose projection covers the grab point lies in the plane
 *     (so the stack at the grab point, hence k, is real).
 * Anything else is refused "Flatten the model before this fold.". Folding the
 * swung flap itself about its existing hinge is `hingePlan`'s job, checked
 * before this. Compound tools refuse on any non-flat model (compound.ts).
 */
function partialFoldRule(frame: Frame, faces: number[], grab: Vec2): Refusal | null {
  if (isFlatFrame(frame)) return null
  if (faces.length !== 1) return refuse(FLATTEN)
  const tree = treePoses(frame)
  if (!planar(tree[faces[0]])) return refuse(FLATTEN)
  const coords = foldedCoords(frame)
  const covering = frame.faces_vertices
    .map((vs, f) => (containsPoint(vs.map(v => coords[v]), grab) ? f : -1))
    .filter(f => f >= 0)
  if (covering.some(f => !planar(tree[f]))) return refuse(FLATTEN)
  return null
}

export function dedupe(segs: [Vec2, Vec2][]): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = []
  const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9
  for (const [a, b] of segs)
    if (!out.some(([c, d]) => (same(a, c) && same(b, d)) || (same(a, d) && same(b, c)))) out.push([a, b])
  return out
}

// ---- which faces of a folded result descend from what ----

export type Origin = { oldFace: number; pose: Rigid; moving: boolean }

/**
 * For each face of `next` (a foldThrough result of `old`): the old face its
 * paper region came from, that face's old world pose, and whether it is on
 * the moving side (descends from a selected face and lies on the grab side).
 */
export function origins(old: Frame, next: Frame, p: Pick<Plan, 'line' | 'faces'>): (Origin | null)[] {
  const selected = new Set(p.faces)
  return originsBy(old, next, (oldFace, w) => selected.has(oldFace) && side(w, p.line) > 0)
}

/**
 * `origins` with an arbitrary moving test: `moves(oldFace, w)` gets the old
 * face and the world position (old pose) of the new face's paper centroid.
 * `next` must share `old`'s paper coordinates (a foldThrough result or an
 * edit of one), so containment of the centroid finds the parent.
 */
export function originsBy(
  old: Frame,
  next: Frame,
  moves: (oldFace: number, w: readonly number[]) => boolean,
): (Origin | null)[] {
  const oldPoses = treePoses(old)
  const oldPolys = old.faces_vertices.map(vs => vs.map(v => old.vertices_coords[v]))
  const boxes = oldPolys.map(box)
  return next.faces_vertices.map(vs => {
    const c = centroid(vs.map(v => next.vertices_coords[v]))
    const oldFace = oldPolys.findIndex((poly, f) => inBox(boxes[f], c) && containsPoint(poly, c))
    if (oldFace < 0) return null
    const pose = oldPoses[oldFace]
    const w = transform(pose, [c[0], c[1], 0])
    return { oldFace, pose, moving: moves(oldFace, w) }
  })
}

export const centroid = (pts: readonly Vec2[]): Vec2 => {
  let x = 0
  let y = 0
  for (const q of pts) {
    x += q[0]
    y += q[1]
  }
  return [x / pts.length, y / pts.length]
}
type Box = [number, number, number, number]
const box = (pts: readonly Vec2[]): Box => [
  Math.min(...pts.map(q => q[0])),
  Math.min(...pts.map(q => q[1])),
  Math.max(...pts.map(q => q[0])),
  Math.max(...pts.map(q => q[1])),
]
const inBox = (b: Box, c: Vec2) => c[0] >= b[0] - EPS && c[1] >= b[1] - EPS && c[0] <= b[2] + EPS && c[1] <= b[3] + EPS

// ---- the edited (flat-open) frame, cached ----

type Edit = Result<{ frame: Frame; moving: number[] }>
const editCache = new WeakMap<Frame, { key: string; edit: Edit }>()

/**
 * The flat-open edited frame and its moving faces, or the reason there is
 * none: "That crease misses the paper." when the cut fails or nothing moves,
 * or `settle`'s own refusal (e.g. "Flatten the model before this fold.").
 */
function edited(frame: Frame, p: Plan, kind: FoldKind): Edit {
  const key = JSON.stringify([p.line, p.faces, kind])
  const hit = editCache.get(frame)
  if (hit && hit.key === key) return hit.edit
  const cut = foldThrough(frame, p.line, p.faces, kind, 0, { solve: false })
  let edit: Edit = refuse(MISS)
  if (cut) {
    // RE folds by assignment in its 2D folded form, so an open (0°) V/M crease
    // would read as folded flat: mark the new open creases flat ('F').
    const next: Frame = {
      ...cut,
      edges_assignment: cut.edges_assignment.map((a, e) =>
        /^[VMvm]$/.test(a) && Math.abs(cut.edges_foldAngle[e]) < EPS ? 'F' : a,
      ),
    }
    const s = settle(frame, next, p, true)
    if (!s.ok) edit = s
    else if (s.moving.length) edit = { ok: true, frame: s.frame, moving: s.moving }
  }
  editCache.set(frame, { key, edit })
  return edit
}

/**
 * The preview fast path (Plan 2 Task 0): the same edited frame as `edited`,
 * built directly for a flat model instead of by `foldThrough` (a full Rabbit
 * Ear fold of the whole graph plus dissolving every split outside the flap —
 * ~15 ms at 289 faces, seconds on a 300-layer stack, per pointer move).
 *
 * On a flat frame every face lies in the plane, so its folded polygon is its
 * paper polygon under a planar pose and the crease line meets it in the same
 * parameters along each side. Only the selected faces the line strictly
 * crosses are cut (exactly what foldThrough keeps):
 *   - each side whose folded endpoints lie strictly on opposite sides of the
 *     line gets one new vertex (shared by both faces on that side, so an
 *     unselected neighbour gains it on its boundary, as after foldThrough's
 *     dissolve), and the side's edge is split in two (same assignment/angle);
 *   - each cut face becomes two: the half on the stationary side keeps the
 *     face id, the grab-side half is appended; a new open crease edge ('F',
 *     0°) joins the two cut points.
 * Then, as `edited`: origins (known exactly here: each new face's parent),
 * inherited face orders, and `settleBy` (re-rooting when face 0 moves). The
 * folded form is known exactly and seeds `foldedCoords`.
 *
 * Differences from the `foldThrough` frame (same faces, vertices, edges and
 * geometry; same `moving` set and poses in world space): face, vertex and
 * edge numbering, and the derived adjacency arrays (vertices_vertices,
 * edges_faces, faces_edges, …), which are omitted unless re-rooting rebuilt
 * them — they're optional in FOLD and nothing in the preview reads them.
 *
 * Returns null (use `edited`) when the case isn't plainly a cut through
 * face interiors: a non-flat frame, a folded vertex within the ambiguous
 * band [CUT_ON, CUT_BAND) of the line (Rabbit Ear's own tolerance decides),
 * a selected face with a side along the line (foldThrough reassigns such
 * edges), a cut face that isn't met in exactly two points, or a missing edge.
 * Commit never uses this: it keeps `edited`/`flatFold` (the authority).
 */
const CUT_ON = 1e-10
const CUT_BAND = 1e-6
const fastCache = new WeakMap<Frame, { key: string; edit: Edit | null }>()

function editedFast(frame: Frame, p: Plan): Edit | null {
  const key = JSON.stringify([p.line, p.faces])
  const hit = fastCache.get(frame)
  if (hit && hit.key === key) return hit.edit
  const edit = cutFlat(frame, p)
  fastCache.set(frame, { key, edit })
  return edit
}

const pairKey = (u: number, v: number) => (u < v ? u * 4194304 + v : v * 4194304 + u)
const pairCache = new WeakMap<Frame, Map<number, number>>()

/** Vertex pair → edge id, cached per frame. */
function edgeByPair(frame: Frame): Map<number, number> {
  const hit = pairCache.get(frame)
  if (hit) return hit
  const m = new Map<number, number>()
  frame.edges_vertices.forEach(([u, v], e) => m.set(pairKey(u, v), e))
  pairCache.set(frame, m)
  return m
}

const DERIVED_KEYS = ['vertices_vertices', 'vertices_edges', 'vertices_faces', 'edges_faces', 'faces_edges', 'faces_faces']

function cutFlat(frame: Frame, p: Plan): Edit | null {
  if (!isFlatFrame(frame) || frame.vertices_coords.length >= 4194304) return null
  const coords = foldedCoords(frame)
  const line = p.line
  const sel = new Set(p.faces)

  // signed distances (folded space) of the selected faces' vertices; 0 = on the line
  const dist = new Map<number, number>()
  for (const f of p.faces)
    for (const v of frame.faces_vertices[f]) {
      if (dist.has(v)) continue
      const d = side(coords[v], line)
      const a = Math.abs(d)
      if (a >= CUT_ON && a < CUT_BAND) return null
      dist.set(v, a < CUT_ON ? 0 : d)
    }
  const ds = (v: number) => dist.get(v)!

  const pairs = edgeByPair(frame)
  const vertices_coords: Vec2[] = [...frame.vertices_coords]
  const folded: Vec2[] = [...coords]
  const edges_vertices: [number, number][] = [...frame.edges_vertices]
  const edges_assignment = [...frame.edges_assignment]
  const edges_foldAngle = [...frame.edges_foldAngle]
  const faces_vertices: number[][] = [...frame.faces_vertices]
  const parent: number[] = faces_vertices.map((_, f) => f)
  const cutFaces = new Set<number>()
  /** split edge id → its new vertex */
  const splits = new Map<number, number>()

  const splitEdge = (u: number, w: number): number | null => {
    const e = pairs.get(pairKey(u, w))
    if (e === undefined) return null
    const s = splits.get(e)
    if (s !== undefined) return s
    const t = ds(u) / (ds(u) - ds(w))
    const lerp = (a: Vec2, b: Vec2): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    const nv = vertices_coords.length
    vertices_coords.push(lerp(frame.vertices_coords[u], frame.vertices_coords[w]))
    folded.push(lerp(coords[u], coords[w]))
    const [a, b] = frame.edges_vertices[e]
    edges_vertices[e] = [a, nv]
    edges_vertices.push([nv, b])
    edges_assignment.push(frame.edges_assignment[e])
    edges_foldAngle.push(frame.edges_foldAngle[e])
    splits.set(e, nv)
    return nv
  }

  for (const f of p.faces) {
    const vs = frame.faces_vertices[f]
    for (let i = 0; i < vs.length; i++) if (ds(vs[i]) === 0 && ds(vs[(i + 1) % vs.length]) === 0) return null
    if (!vs.some(v => ds(v) > 0) || !vs.some(v => ds(v) < 0)) continue
    const aug: number[] = []
    const zeros: number[] = []
    for (let i = 0; i < vs.length; i++) {
      const u = vs[i]
      const w = vs[(i + 1) % vs.length]
      if (ds(u) === 0) zeros.push(aug.length)
      aug.push(u)
      if (ds(u) * ds(w) < 0) {
        const nv = splitEdge(u, w)
        if (nv === null) return null
        zeros.push(aug.length)
        aug.push(nv)
      }
    }
    if (zeros.length !== 2) return null
    const [i, j] = zeros
    const a = aug.slice(i, j + 1)
    const b = [...aug.slice(j), ...aug.slice(0, i + 1)]
    // a's interior vertices (between the two cut points) are all on one side
    const aMoves = ds(a[1]) > 0
    faces_vertices[f] = aMoves ? b : a
    faces_vertices.push(aMoves ? a : b)
    parent.push(f)
    cutFaces.add(f)
    edges_vertices.push([aug[i], aug[j]])
    edges_assignment.push('F')
    edges_foldAngle.push(0)
  }
  if (cutFaces.size === 0) return null

  // faces that weren't cut gain the new vertex on each of their split sides
  for (const [e, nv] of splits) {
    const [a, b] = frame.edges_vertices[e]
    for (const f of edgeFaces(frame)[e] ?? []) {
      if (cutFaces.has(f)) continue
      const vs = [...faces_vertices[f]]
      const k = vs.findIndex((x, i) => {
        const y = vs[(i + 1) % vs.length]
        return (x === a && y === b) || (x === b && y === a)
      })
      if (k < 0) return null
      vs.splice(k + 1, 0, nv)
      faces_vertices[f] = vs
    }
  }

  // origins as originsBy computes them, with each face's parent known
  const tree = treePoses(frame)
  const from: Origin[] = faces_vertices.map((vs, nf) => {
    const oldFace = parent[nf]
    const pose = tree[oldFace]
    const c = centroid(vs.map(v => vertices_coords[v]))
    const w = transform(pose, [c[0], c[1], 0])
    return { oldFace, pose, moving: sel.has(oldFace) && side(w, line) > 0 }
  })

  const rest: Record<string, unknown> = { ...frame }
  for (const k of DERIVED_KEYS) delete rest[k]
  const next: Frame = {
    ...rest,
    vertices_coords,
    edges_vertices,
    // as `edited`: an open (0°) V/M crease would read as folded flat
    edges_assignment: edges_assignment.map((x, e) => (/^[VMvm]$/.test(x) && Math.abs(edges_foldAngle[e]) < EPS ? 'F' : x)),
    edges_foldAngle,
    faces_vertices,
    faceOrders: frame.faceOrders,
  }
  const s = settleBy(frame, next, from, true)
  if (!s.ok) return s
  if (s.moving.length === 0) return refuse(MISS)
  primeFoldedCoords(s.frame, folded)
  return { ok: true, frame: s.frame, moving: s.moving }
}

/**
 * Inherited layer order: every face of `next` takes its old parent's orders
 * (children of the same parent are side by side, so get none). Exact for the
 * 0° edited frame, and "the last solved order, carried" (R2) for partial
 * commits — RE drops the orders of faces it splits.
 */
function inherited(old: Frame, from: (Origin | null)[]): FaceOrder[] {
  // Children per old face, by index (a drag's preview runs this on every move:
  // array lookups, and the usual one-child case pushed directly; same output order).
  const children: (number[] | undefined)[] = []
  from.forEach((o, f) => {
    if (!o) return
    const list = children[o.oldFace]
    if (list) list.push(f)
    else children[o.oldFace] = [f]
  })
  const out: FaceOrder[] = []
  for (const order of old.faceOrders) {
    const a = order[0]
    const b = order[1]
    const s = order[2]
    const ka = children[a]
    const kb = children[b]
    if (!ka || !kb) continue
    if (ka.length === 1 && kb.length === 1) {
      // two faces that kept their ids: the same (immutable) triple, shared rather than copied
      out.push(ka[0] === a && kb[0] === b ? order : [ka[0], kb[0], s])
    } else for (const ca of ka) for (const cb of kb) out.push([ca, cb, s])
  }
  return out
}

/**
 * `inherited`, restricted to new faces whose origin passes `keep` (e.g. the
 * faces that didn't move, whose orders the fold leaves true). Rabbit Ear's
 * layer solver takes a graph's faceOrders as constraints, so a re-solve after
 * an edit must not see stale ones.
 */
export function inheritedAmong(old: Frame, from: (Origin | null)[], keep: (o: Origin) => boolean): FaceOrder[] {
  return inherited(old, from.map(o => (o && keep(o) ? o : null)))
}

export const signed = (kind: FoldKind, deg: number) => (kind === 'valley' ? deg : -deg)

// ---- fold ----

let previewFastPath = true

/**
 * Testing hook (not part of @engine): run `fn` with the preview fast path
 * off, i.e. every fold preview through `edited` (foldThrough), to compare.
 */
export function withoutFastPath<T>(fn: () => T): T {
  const was = previewFastPath
  previewFastPath = false
  try {
    return fn()
  } finally {
    previewFastPath = was
  }
}

function previewFold(frame: Frame, g: Gesture): Result<{ preview: Preview }> {
  const h = hingePlan(frame, g)
  if (h) return h.ok ? previewHinge(frame, g, h.hinge) : h
  const r = plan(frame, g)
  if (!r.ok) return r
  const p = r.plan
  const edit = (previewFastPath && editedFast(frame, p)) || edited(frame, p, g.kind)
  if (!edit.ok) return edit
  const requested = requestedAngle(g)
  const want = signed(g.kind, requested)
  const swing = { faces: edit.moving, axis: p.line }
  const { freeDeg, blocked } = sweep(edit.frame, swing, 0, want)
  const applied = blocked ? freeDeg : want
  // only a flat commit of a flat model solves the layer order
  let valid: Validity = true
  if (requested >= 180 && isFlatFrame(frame)) {
    if (edit.frame.faces_vertices.length > VALID_SOLVE_MAX_FACES) valid = 'unknown'
    else {
      const f = flatFold(frame, p, g.kind)
      valid = f.ok || f.reason !== NO_ORDER
    }
  }
  return {
    ok: true,
    preview: {
      crease: p.crease,
      moving: edit.moving,
      layers: p.k,
      angleDeg: Math.abs(applied),
      poses: poses(edit.frame, { ...swing, angleDeg: applied }),
      blocked,
      valid,
      frame: edit.frame,
    },
  }
}

function commitFold(frame: Frame, g: Gesture): Result<{ frame: Frame; step: Step }> {
  const h = hingePlan(frame, g)
  if (h) return h.ok ? commitHinge(frame, g, h.hinge) : h
  const r = plan(frame, g)
  if (!r.ok) return r
  const p = r.plan
  const requested = requestedAngle(g)
  if (requested < MIN_ANGLE) return refuse(TOO_SHORT)
  // A flat fold of a flat model ends in a flat state the layer solver judges;
  // anything else ends non-flat and is clamped to what the sweep allows.
  const flat = requested >= 180 && frame.edges_foldAngle.every(isFlatAngle)
  let angle = requested
  let out: Frame
  if (flat) {
    const f = flatFold(frame, p, g.kind)
    if (!f.ok) return f
    out = f.frame
  } else {
    const edit = edited(frame, p, g.kind)
    if (!edit.ok) return edit
    const { freeDeg, blocked } = sweep(edit.frame, { faces: edit.moving, axis: p.line }, 0, signed(g.kind, requested))
    if (blocked) angle = Math.abs(freeDeg)
    if (angle < MIN_ANGLE) return refuse(IN_THE_WAY)
    const next = foldThrough(frame, p.line, p.faces, g.kind, angle, { solve: false })
    if (!next) return refuse(MISS)
    const kept = settle(frame, next, p, true)
    if (!kept.ok) return kept
    out = kept.frame
  }
  const step: Step = {
    kind: 'fold',
    params: {
      tool: g.tool,
      grab: g.grab,
      target: g.target,
      layers: p.k,
      kind: g.kind,
      angleDeg: angle,
      crease: p.line,
      snapAngle: g.snapAngle,
      ...extraParams(g),
    },
    label: label(g.kind, p.k, angle),
    at: Date.now(),
  }
  return { ok: true, frame: out, step }
}

const flatCache = new WeakMap<Frame, { key: string; r: Result<{ frame: Frame }> }>()

/**
 * The flat (180°) fold of a flat model along plan `p`, re-rooted and with its
 * layer order solved (refusing "No valid layer order exists for this fold.").
 * Collision never vetoes it (spec §4). Cached per input frame for the last
 * (crease, faces, kind), shared by the preview's validity check and commit.
 */
function flatFold(frame: Frame, p: Plan, kind: FoldKind): Result<{ frame: Frame }> {
  const key = JSON.stringify([p.line, p.faces, kind])
  const hit = flatCache.get(frame)
  if (hit && hit.key === key) return hit.r
  let r: Result<{ frame: Frame }>
  const next = foldThrough(frame, p.line, p.faces, kind, 180, { solve: false })
  if (!next) r = refuse(MISS)
  else {
    const kept = settle(frame, next, p, false)
    r = kept.ok ? withLayerOrder(kept.frame) : kept
  }
  flatCache.set(frame, { key, r })
  return r
}

export function label(kind: FoldKind, k: number, angleDeg: number): string {
  const what = kind === 'valley' ? 'Valley' : 'Mountain'
  const layers = k === 1 ? 'top flap' : `${k} layers`
  return `${what} fold · ${layers} · ${Math.round(angleDeg)}°`
}

// ---- R10: re-root on a stationary face ----

export type Planar = { a: number; b: number; c: number; d: number; tx: number; ty: number; det: number; identity: boolean }

export function planar(m: Rigid): Planar | null {
  const { r, t } = m
  if ([r[2], r[5], r[6], r[7], t[2]].some(x => Math.abs(x) > 1e-9)) return null
  const det = r[0] * r[4] - r[1] * r[3]
  const identity =
    Math.abs(r[0] - 1) < 1e-12 && Math.abs(r[4] - 1) < 1e-12 && Math.abs(r[1]) < 1e-12 &&
    Math.abs(r[3]) < 1e-12 && Math.abs(t[0]) < 1e-12 && Math.abs(t[1]) < 1e-12
  return { a: r[0], b: r[1], c: r[3], d: r[4], tx: t[0], ty: t[1], det, identity }
}

/**
 * Re-root a foldThrough result of `old` on a stationary face so the world
 * stays put (R10). Optionally replace its faceOrders by the inherited ones.
 * Returns the frame and its moving faces.
 */
function settle(old: Frame, next: Frame, p: Plan, inherit: boolean): Result<{ frame: Frame; moving: number[] }> {
  return settleBy(old, next, origins(old, next, p), inherit)
}

/**
 * `settle` given precomputed origins (see `originsBy`). Also returns
 * `index[f]`: the settled id of `next`'s face f (re-rooting renumbers faces).
 */
export function settleBy(
  old: Frame,
  next: Frame,
  from: (Origin | null)[],
  inherit: boolean,
): Result<{ frame: Frame; moving: number[]; index: number[] }> {
  const frame: Frame = inherit ? { ...next, faceOrders: inherited(old, from) } : next
  const moving = from.map((o, f) => (o?.moving ? f : -1)).filter(f => f >= 0)
  const cands = from
    .map((o, f) => {
      if (!o || o.moving) return null
      const A = planar(o.pose)
      return A ? { f, A } : null
    })
    .filter((c): c is { f: number; A: Planar } => c !== null)
  if (cands.length === 0) return refuse(FLATTEN)
  const rank = (c: { f: number; A: Planar }) => (c.A.identity ? (c.f === 0 ? 0 : 1) : c.A.det > 0 ? 2 : 3)
  const best = cands.reduce((x, y) => (rank(y) < rank(x) ? y : x))
  if (best.f === 0 && best.A.identity) return { ok: true, frame, moving, index: from.map((_, f) => f) }
  const r = reroot(frame, best.f, best.A)
  return { ok: true, frame: r.frame, moving: moving.map(f => r.index[f]).sort((a, b) => a - b), index: r.index }
}

const SWAP: Record<string, string> = { V: 'M', M: 'V', v: 'm', m: 'v' }

/**
 * `s` becomes face 0 (the others keep their relative order); paper
 * coordinates move by `A` (s's world placement). `index[old] = new`.
 */
function reroot(frame: Frame, s: number, A: Planar): { frame: Frame; index: number[] } {
  const n = frame.faces_vertices.length
  const order = [s, ...Array.from({ length: n }, (_, f) => f).filter(f => f !== s)]
  const index = new Array<number>(n)
  order.forEach((f, i) => (index[f] = i))
  const mirror = !A.identity && A.det < 0

  const vertices_coords: Vec2[] = A.identity
    ? frame.vertices_coords.map(q => [q[0], q[1]] as Vec2)
    : frame.vertices_coords.map(([x, y]) => [A.a * x + A.b * y + A.tx, A.c * x + A.d * y + A.ty] as Vec2)
  const faces_vertices = order.map(f => {
    const vs = [...frame.faces_vertices[f]]
    return mirror ? vs.reverse() : vs
  })
  const faceOrders: FaceOrder[] = frame.faceOrders.map(([a, b, o]) => [index[a], index[b], mirror ? -o : o])
  const edges_assignment = mirror ? frame.edges_assignment.map(x => SWAP[x] ?? x) : [...frame.edges_assignment]
  const edges_foldAngle = mirror ? frame.edges_foldAngle.map(x => (x === 0 ? 0 : -x)) : [...frame.edges_foldAngle]

  const rest: Record<string, unknown> = { ...frame }
  for (const k of ['faces_edges', 'edges_faces', 'vertices_faces', 'faces_faces', 'vertices_vertices', 'vertices_edges'])
    delete rest[k]
  const out = rebuildAdjacency({
    ...rest,
    vertices_coords,
    edges_vertices: frame.edges_vertices.map(([u, v]) => [u, v] as [number, number]),
    edges_assignment,
    edges_foldAngle,
    faces_vertices,
    faceOrders,
  })
  return { frame: out, index }
}

// ---- hinge folds: re-folding along an existing crease ----

/**
 * A fold whose crease runs along existing folded edges, turning the flap
 * that hangs on them rigidly about them (no new crease):
 *   - on a model with a partial fold: the swung flap about its partial hinge
 *     ("a single-flap hinge fold on the swung flap", spec §2). The hinge is
 *     the set E of partial edges on the crease line; the swung flap S is
 *     everything that removing E cuts off from face 0 (the root, which never
 *     moves, R10). The faces on the other side of E must lie in the plane
 *     (so the projected hinge line is exact) and on the non-grab side;
 *     otherwise it isn't a hinge fold of the swung flap and the
 *     partial-fold rule decides.
 *   - on a flat model: the flap `selectFlap` picks at grab, when it lies
 *     wholly on the grab side and hangs only on folded edges along the crease
 *     — e.g. lifting a half fold's top layer back over its hinge unfolds it.
 * The gesture's swing is the same as a new fold's (valley lifts the flap
 * toward +z), applied from the flap's CURRENT pose and stopped at the next
 * flat state in that direction (0° or ±180° on the hinge): `range`. So the
 * shown angle is how far the flap turns, at most `range`; progress 1 lands
 * flat. The swept collision check clamps it as for any fold.
 */
export type Hinge = {
  line: Line
  /** Hinge edges and, for each, the per-unit paper-angle rate of the swing. */
  edges: { e: number; rate: number }[]
  /** The flap (faces of the input frame). */
  faces: number[]
  k: number
  /** How far (degrees) the flap can turn in the gesture's direction. */
  range: number
  crease: [Vec2, Vec2][]
}

const HINGE_EPS = 1e-7

export function hingePlan(frame: Frame, g: Gesture): Result<{ hinge: Hinge }> | null {
  const cl = creaseLine(g)
  if (!cl.ok) return null
  const line = cl.line
  const coords = foldedCoords(frame)
  const flat = isFlatFrame(frame)
  const facesOf = edgeFaces(frame)
  const onLine = (e: number) => {
    const [u, v] = frame.edges_vertices[e]
    const a = coords[u]
    const b = coords[v]
    return Math.abs(side(a, line)) < HINGE_EPS && Math.abs(side(b, line)) < HINGE_EPS && Math.hypot(b[0] - a[0], b[1] - a[1]) > HINGE_EPS
  }
  const along = frame.edges_vertices
    .map((_, e) => e)
    .filter(e => facesOf[e].length === 2 && !/^[Bb]$/.test(frame.edges_assignment[e]))
    .filter(e => (flat ? Math.abs(frame.edges_foldAngle[e]) > 1e-6 : !isFlatAngle(frame.edges_foldAngle[e])))
    .filter(onLine)
  if (along.length === 0) return null

  let S: Set<number>
  let k = 1
  if (flat) {
    const sel = selectFlap(frame, g.grab, g.layers, line, g.face)
    if (sel.faces.length === 0) return null
    S = new Set(sel.faces)
    k = sel.k
    if ([...S].some(f => frame.faces_vertices[f].some(v => side(coords[v], line) < -HINGE_EPS))) return null
  } else {
    // components of the face graph with the partial hinge edges removed
    const cut = new Set(along)
    const base = new Set<number>([0])
    const queue = [0]
    while (queue.length) {
      const f = queue.pop()!
      for (const e of facesEdges(frame, f, facesOf)) {
        if (cut.has(e) || /^[Bb]$/.test(frame.edges_assignment[e])) continue
        for (const h of facesOf[e]) if (!base.has(h)) (base.add(h), queue.push(h))
      }
    }
    S = new Set(frame.faces_vertices.map((_, f) => f).filter(f => !base.has(f)))
    if (S.size === 0) return null
  }
  // the flap hangs on hinge edges only, and every hinge edge joins it to the rest
  const hinge = new Set(along)
  for (let e = 0; e < frame.edges_vertices.length; e++) {
    const fs = facesOf[e]
    if (fs.length !== 2) continue
    const inS = fs.filter(f => S.has(f)).length
    if (inS === 1 && !hinge.has(e)) return null
    if (hinge.has(e) && inS !== 1) return null
  }
  const tree = treePoses(frame)
  const edges: { e: number; rate: number }[] = []
  for (const e of along) {
    const [s, t] = S.has(facesOf[e][0]) ? facesOf[e] : [facesOf[e][1], facesOf[e][0]]
    const Pt = planar(tree[t])
    if (!Pt) return null // the projected hinge line is only exact on a face lying in the plane
    if (!flat && side(centroid(frame.faces_vertices[t].map(v => coords[v])), line) > -HINGE_EPS) return null
    edges.push({ e, rate: hingeRate(frame, e, s, tree[t], line) })
  }
  // range to the next flat state in the gesture's direction (same for every hinge edge)
  const dir = g.kind === 'valley' ? 1 : -1
  let range = 180
  for (const { e, rate } of edges) {
    const a = frame.edges_foldAngle[e]
    const q = rate * dir
    const r = q > 0 ? (a < -1e-6 ? -a : 180 - a) : a > 1e-6 ? a : 180 + a
    range = Math.min(range, Math.max(0, r))
  }
  const crease = dedupe(along.map(e => frame.edges_vertices[e].map(v => coords[v]) as [Vec2, Vec2]))
  return { ok: true, hinge: { line, edges, faces: [...S].sort((a, b) => a - b), k, range, crease } }
}

/**
 * d(paper fold angle of edge e) / d(world swing angle) for face `s` turning
 * about e relative to its neighbour t, whose world pose is `tPose` (planar):
 * a world swing θ (right-hand rule about `line.vector`, e lying on `line`)
 * changes e's fold angle by rate·θ, rate = ±1. In t's frame, s sits at
 * rotation (s left of u→v ? +a : −a) about u→v (poses.ts), and t's pose maps
 * u→v onto ±line.vector (ε); so rate = ε·σ.
 */
export function hingeRate(frame: Frame, e: number, s: number, tPose: Rigid, line: Line): number {
  const Pt = planar(tPose)
  if (!Pt) return 0
  const [u, v] = frame.edges_vertices[e]
  const pu = frame.vertices_coords[u]
  const d: Vec2 = sub(frame.vertices_coords[v], pu)
  const wd: Vec2 = [Pt.a * d[0] + Pt.b * d[1], Pt.c * d[0] + Pt.d * d[1]]
  const eps = Math.sign(wd[0] * line.vector[0] + wd[1] * line.vector[1])
  const cs = centroid(frame.faces_vertices[s].map(x => frame.vertices_coords[x]))
  const sigma = cross(d, sub(cs, pu)) > 0 ? 1 : -1
  return eps * sigma
}

/** How far the hinge fold turns: min(progress angle, range), clamped by the sweep. */
function hingeSwing(frame: Frame, g: Gesture, h: Hinge): { applied: number; blocked: boolean } {
  const want = Math.min(requestedAngle(g), h.range)
  if (want < MIN_ANGLE) return { applied: 0, blocked: h.range < MIN_ANGLE && requestedAngle(g) > 0 }
  const { freeDeg, blocked } = sweep(frame, { faces: h.faces, axis: h.line }, 0, signed(g.kind, want))
  return { applied: blocked ? Math.abs(freeDeg) : want, blocked }
}

function previewHinge(frame: Frame, g: Gesture, h: Hinge): Result<{ preview: Preview }> {
  const { applied, blocked } = hingeSwing(frame, g, h)
  // the commit solves only when the swing lands flat
  let valid: Validity = true
  if (applied >= MIN_ANGLE && isFlatFrame({ ...frame, edges_foldAngle: hingeAngles(frame, g, h, applied).angle })) {
    if (frame.faces_vertices.length > VALID_SOLVE_MAX_FACES) valid = 'unknown'
    else {
      const c = commitHinge(frame, g, h)
      valid = c.ok || c.reason !== NO_ORDER
    }
  }
  return {
    ok: true,
    preview: {
      crease: h.crease,
      moving: h.faces,
      layers: h.k,
      angleDeg: applied,
      poses: poses(frame, { faces: h.faces, axis: h.line, angleDeg: signed(g.kind, applied) }),
      blocked,
      valid,
      frame,
    },
  }
}

/** Edge angles and assignments after turning the hinge flap by `applied` degrees. */
function hingeAngles(frame: Frame, g: Gesture, h: Hinge, applied: number): { angle: number[]; assignment: string[] } {
  const dir = g.kind === 'valley' ? 1 : -1
  const assignment = [...frame.edges_assignment]
  const angle = [...frame.edges_foldAngle]
  for (const { e, rate } of h.edges) {
    let a = frame.edges_foldAngle[e] + rate * dir * applied
    if (Math.abs(a) < 1e-6) a = 0
    if (Math.abs(Math.abs(a) - 180) < 1e-6) a = Math.sign(a) * 180
    angle[e] = a
    assignment[e] = a === 0 ? 'F' : a > 0 ? 'V' : 'M'
  }
  return { angle, assignment }
}

function commitHinge(frame: Frame, g: Gesture, h: Hinge): Result<{ frame: Frame; step: Step }> {
  if (requestedAngle(g) < MIN_ANGLE) return refuse(TOO_SHORT)
  const { applied } = hingeSwing(frame, g, h)
  if (applied < MIN_ANGLE) return refuse(IN_THE_WAY)
  const { angle: edges_foldAngle, assignment: edges_assignment } = hingeAngles(frame, g, h, applied)
  const moving = new Set(h.faces)
  const next: Frame = { ...frame, edges_assignment, edges_foldAngle }
  const kept = settleBy(frame, next, originsBy(frame, next, f => moving.has(f)), false)
  if (!kept.ok) return kept
  let out = kept.frame
  if (isFlatFrame(out)) {
    // Rabbit Ear's solver treats existing faceOrders as constraints: keep only
    // the orders among faces that didn't move (still true), drop the flap's.
    // A non-flat result instead carries the last solved orders unchanged (R2).
    const still = new Set(kept.moving)
    out = { ...out, faceOrders: out.faceOrders.filter(([a, b]) => !still.has(a) && !still.has(b)) }
    const solved = withLayerOrder(out)
    if (!solved.ok) return solved
    out = solved.frame
  }
  const step: Step = {
    kind: 'fold',
    params: {
      tool: g.tool,
      grab: g.grab,
      target: g.target,
      layers: h.k,
      kind: g.kind,
      angleDeg: applied,
      crease: h.line,
      snapAngle: g.snapAngle,
      hinge: true,
      ...extraParams(g),
    },
    label: label(g.kind, h.k, applied),
    at: Date.now(),
  }
  return { ok: true, frame: out, step }
}

// ---- small topology helpers ----

const edgeFacesCache = new WeakMap<Frame, number[][]>()

/** For each edge, the faces having it as a side (by consecutive vertices). Cached per frame. */
export function edgeFaces(frame: Frame): number[][] {
  const hit = edgeFacesCache.get(frame)
  if (hit) return hit
  const key = (u: number, v: number) => (u < v ? `${u} ${v}` : `${v} ${u}`)
  const byKey = new Map<string, number>()
  frame.edges_vertices.forEach(([u, v], e) => byKey.set(key(u, v), e))
  const out: number[][] = frame.edges_vertices.map(() => [])
  frame.faces_vertices.forEach((vs, f) =>
    vs.forEach((u, i) => {
      const e = byKey.get(key(u, vs[(i + 1) % vs.length]))
      if (e !== undefined && !out[e].includes(f)) out[e].push(f)
    }),
  )
  edgeFacesCache.set(frame, out)
  return out
}

const faceEdgesCache = new WeakMap<Frame, number[][]>()

/** The edges of face f (the inverse of `edgeFaces`, cached per frame). */
export function facesEdges(frame: Frame, f: number, facesOf = edgeFaces(frame)): number[] {
  let all = faceEdgesCache.get(frame)
  if (!all) {
    const built: number[][] = frame.faces_vertices.map(() => [])
    facesOf.forEach((fs, e) => fs.forEach(h => built[h].push(e)))
    faceEdgesCache.set(frame, built)
    all = built
  }
  return all[f]
}
