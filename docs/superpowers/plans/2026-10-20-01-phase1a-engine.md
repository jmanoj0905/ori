# Phase 1a: Folding Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Ori's pure-TypeScript folding engine. It holds FOLD frames and history; folds by drag gesture (valley/mountain at any angle, reverse, squash, petal, turn over); keeps a valid layer order; checks collisions while a flap swings; and computes 3D face poses.

**Architecture:** `src/engine/` is the only place that imports Rabbit Ear, and only through `rabbit.ts`. Frames are immutable FOLD objects. Every operation returns either `{ ok: true, ... }` or `{ ok: false, reason }`. There is no DOM and no Three.js in the engine; poses are plain 4×4 column-major `number[16]`.

**Tech Stack:** Vite 8, TypeScript (strict), Vitest, rabbit-ear 0.9.41 (pinned exactly).

**Spec:** `docs/superpowers/specs/2026-10-20-01-folding-engine-design.md` (plus `-00-ori-overview-design.md`)

## Global Constraints
- License GPLv3. The `LICENSE` file is the full GPLv3 text; `package.json` has `"license": "GPL-3.0-only"`.
- `rabbit-ear` is pinned to exactly `0.9.41` (no caret).
- Nothing outside `src/engine/rabbit.ts` imports `rabbit-ear` (enforced by a test in Task 1).
- Paper units: a square is `1 × 1`, A4 is `1 × Math.SQRT2`, and custom sizes are allowed. Kami is 15 cm and is used only for displayed measurements.
- A flat fold is ±180°. Angles live in `[0, 180]` degrees in gestures; the sign comes from valley/mountain.
- Angle snap step: **22.5°**.
- Layer count `k` counts from the top layer at the grab point, starting at 1.
- Refusal messages use the spec's exact wording where the spec gives it:
  - `"That crease misses the paper."`
  - `"This flap can't reverse-fold: it isn't folded in half."`
  - `"No valid layer order exists for this fold."`
- Commits have no Co-Authored-By trailer. `PLAN.md` is never committed; specs and plans live in `docs/superpowers/` and are tracked.

## Review Focus
1. **A grab exactly on an existing crease or a vertex.** `selectFlap` must pick a deterministic top face, not throw. Covered by a test in Task 5.
2. **A drag where target ≈ grab (zero-length drag).** The preview should refuse quietly (`"Drag further to fold."`), not produce NaN creases. Covered by a test in Task 7.
3. **A k larger than the number of layers at the grab point.** Clamp it to the available count, and report the clamped k in the preview. Covered by a test in Task 7.
4. **Turning over, then undoing.** The layer order and the windings must match the original exactly. Covered by a test in Task 9.
5. **A fold after a partial (non-flat) fold that isn't a single-flap hinge.** Refuse with `"Flatten the model before this fold."`. Covered by a test in Task 8.

---

### Task 1: Project scaffold and engine boundary guard

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` (placeholder root), `src/main.tsx` (renders "Ori" text only), `LICENSE`, `src/engine/index.ts` (empty export)
- Test: `src/engine/boundary.test.ts`

**Interfaces:**
- Produces: the npm scripts `dev`, `build` (`tsc && vite build`), `test` (`vitest run`); the path alias `@engine` → `src/engine`.

- [ ] **Step 1:** Install `react react-dom three rabbit-ear@0.9.41 --save-exact` for rabbit-ear, and dev deps `vite @vitejs/plugin-react typescript vitest @types/react @types/react-dom @types/three`.
- [ ] **Step 2: Write the failing boundary test.**
```ts
test('only rabbit.ts imports rabbit-ear', () => {
  const offenders = globSync('src/**/*.{ts,tsx}')
    .filter(f => !f.endsWith('src/engine/rabbit.ts') && !f.endsWith('.test.ts'))
    .filter(f => /from ['"]rabbit-ear/.test(readFileSync(f, 'utf8')))
  expect(offenders).toEqual([])
})
test('rabbit-ear is pinned exactly', () => {
  expect(pkg.dependencies['rabbit-ear']).toBe('0.9.41')
})
```
- [ ] **Step 3:** Run `npx vitest run src/engine/boundary.test.ts`. Expected: FAIL (no pin yet, or package.json is missing a field).
- [ ] **Step 4:** Finish the config so that both tests pass and `npm run build` succeeds.
- [ ] **Step 5:** Run `npm test && npm run build`. Expected: PASS, and `dist/` is built.
- [ ] **Step 6:** Commit with `chore: scaffold Vite + React + TS, pin rabbit-ear, GPLv3`.

---

### Task 2: Rabbit Ear adapter and core types

**Files:**
- Create: `src/engine/types.ts`, `src/engine/rabbit.ts`
- Test: `src/engine/rabbit.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type Vec2 = readonly [number, number]`
  - `type Line = { origin: Vec2; vector: Vec2 }`
  - `type Frame = Readonly<FOLD>`. A FOLD object always carrying `vertices_coords`, `edges_vertices`, `edges_assignment`, `edges_foldAngle`, `faces_vertices`, `faceOrders`.
  - `type FoldKind = 'valley' | 'mountain'`
  - `type Tool = 'fold' | 'reverse' | 'squash' | 'petal'`
  - `type Refusal = { ok: false; reason: string }`
  - `type Ok<T> = { ok: true } & T`
  - `type Result<T> = Ok<T> | Refusal`
  - `type PaperSize = { width: number; height: number }`
- Produces (`rabbit.ts`), the only importer of rabbit-ear:
  - `makeSheet(size: PaperSize): Frame`
  - `foldThrough(frame: Frame, line: Line, faces: number[], kind: FoldKind, angleDeg: number): Frame | null`
  - `reverse(frame: Frame, line: Line): Frame | null`
  - `squash(frame: Frame, foldedEdge: number, flatEdge: number): Frame | null`
  - `layerOrders(frame: Frame): [number, number, number][] | null`
  - `foldedCoords(frame: Frame): Vec2[]`
  - `windings(frame: Frame): boolean[]`

- [ ] **Step 1: Spike.** In a test, import `rabbit-ear` and log the namespace paths for `rectangle`, `graph.simpleFoldLine`, `graph.foldGraphIntoSubgraph`, `graph.reverseFold`, `graph.simpleSquashFold`, `layer`, `graph.makeVerticesCoordsFolded`. Record the confirmed paths as a comment at the top of `rabbit.ts`. If `foldGraphIntoSubgraph` cannot restrict a fold to a set of faces, implement `foldThrough` for a face subset by applying `simpleFoldLine` to a subgraph and merging it back. Document which approach you took in that comment.
- [ ] **Step 2: Write the failing tests.**
```ts
test('makeSheet builds a 1×√2 rectangle', () => {
  const f = makeSheet({ width: 1, height: Math.SQRT2 })
  expect(f.faces_vertices).toHaveLength(1)
  expect(area(f)).toBeCloseTo(Math.SQRT2)
})
test('foldThrough on all faces, valley 180, halves the footprint', () => {
  const f = makeSheet({ width: 1, height: 1 })
  const g = foldThrough(f, { origin: [0.5, 0], vector: [0, 1] }, [0], 'valley', 180)!
  expect(g.faces_vertices).toHaveLength(2)
  expect(footprintWidth(foldedCoords(g))).toBeCloseTo(0.5)
  expect(g.edges_assignment).toContain('V')
})
test('layerOrders returns orders for a half-folded square', () => {
  expect(layerOrders(halfFolded())).not.toBeNull()
})
```
Test helpers `area`, `footprintWidth` and `halfFolded` go in `src/engine/testkit.ts`. The sheet origin is the corner at `[0, 0]`, as Rabbit Ear does it.
- [ ] **Step 3:** Run `npx vitest run src/engine/rabbit.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4:** Implement `rabbit.ts`. Map `valley` to assignment `'V'` with foldAngle `+angle`, and `mountain` to `'M'` with `-angle`. Return `null` whenever Rabbit Ear throws or produces no new edges. Clone the input; never mutate it.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit with `feat(engine): rabbit-ear adapter and core types`.

---

### Task 3: History

**Files:**
- Create: `src/engine/history.ts`
- Test: `src/engine/history.test.ts`

**Interfaces:**
- Produces:
  - `type Step = { kind: Tool | 'turnOver'; params: unknown; label: string; at: number }`
  - `type History = { readonly frames: Frame[]; readonly steps: Step[]; readonly cursor: number }`. `frames[0]` is the blank sheet; `steps[i]` produced `frames[i + 1]`.
  - `startHistory(f: Frame): History`
  - `push(h: History, step: Step, f: Frame): History` (truncates redo entries)
  - `undo(h): History`, `redo(h): History`
  - `jumpTo(h, index: number): History`
  - `current(h): Frame`
  - `canUndo(h)`, `canRedo(h)`

- [ ] **Step 1: Write the failing tests.**
  - `push` advances the cursor.
  - `undo` then `redo` gives back the same frame.
  - `push` after `undo` drops the redo entries (`steps.length` shrinks).
  - `jumpTo(2)` then `current` gives `frames[2]`.
  - `undo` at 0 is a no-op.
  - Inputs are never mutated (`Object.isFrozen` on the returned history).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement with frozen copies.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(engine): immutable fold history`.

---

### Task 4: Geometry helpers and the drag → crease mapping

**Files:**
- Create: `src/engine/geometry.ts`, `src/engine/gesture.ts`
- Test: `src/engine/gesture.test.ts`

**Interfaces:**
- Produces:
  - `creaseFromDrag(grab: Vec2, target: Vec2): Line | null`. The perpendicular bisector; `null` when `|target - grab| < 1e-4`.
  - `snapAngle(line: Line, pivot: Vec2, stepDeg = 22.5): Line`. Rotates the crease about `pivot` to the nearest multiple of 22.5°.
  - `progressToAngle(progress: number): number`. Clamps to `[0, 1]`, maps to `[0, 180]` with an ease-out, and returns 180 when progress ≥ 1.
  - `clipLineToPolygon(line: Line, poly: Vec2[]): [Vec2, Vec2] | null`

- [ ] **Step 1: Write the failing tests.**
```ts
test('bisector carries grab onto target', () => {
  const l = creaseFromDrag([1, 1], [0, 0])!
  expect(reflect([1, 1], l)).toEqual([expect.closeTo(0), expect.closeTo(0)])
})
test('zero-length drag gives null', () => expect(creaseFromDrag([0.2, 0.2], [0.2, 0.20001])).toBeNull())
test('snapAngle locks to 22.5° steps', () => {
  const l = snapAngle({ origin: [0, 0], vector: [Math.cos(0.42), Math.sin(0.42)] }, [0, 0])
  expect(angleDeg(l.vector)).toBeCloseTo(22.5)
})
test('progressToAngle is clamped and flat at 1', () => {
  expect(progressToAngle(-1)).toBe(0); expect(progressToAngle(1)).toBe(180); expect(progressToAngle(2)).toBe(180)
})
test('clipLineToPolygon misses → null', () =>
  expect(clipLineToPolygon({ origin: [5, 0], vector: [0, 1] }, unitSquare)).toBeNull())
```
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. For the ease-out use `1 - (1 - p) ** 2`, scaled to 180.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(engine): drag-to-crease mapping and angle snap`.

---

### Task 5: Layers at a point and flap selection

**Files:**
- Create: `src/engine/layers.ts`
- Test: `src/engine/layers.test.ts`

**Interfaces:**
- Consumes: `foldedCoords` and `layerOrders` from Task 2.
- Produces:
  - `layerAt(frame: Frame, p: Vec2): number[]`. Face ids under the folded-space point `p`, top to bottom by `faceOrders`.
  - `selectFlap(frame: Frame, grab: Vec2, k: number, moveSide: Line): { faces: number[]; k: number }`. Takes the top `k` faces at `grab` (k is clamped to what's available), plus every face hinged to them on the moving side of the crease (flood fill over shared non-boundary edges whose faces lie on the moving side).
  - `withLayerOrder(frame: Frame): Result<{ frame: Frame }>`. Re-solves; refuses with `"No valid layer order exists for this fold."`.

- [ ] **Step 1: Write the failing tests.**
  - A half-folded square, `layerAt` the centre of the folded half: 2 faces, and the moved face first.
  - `selectFlap(k=1)` on a half fold moves 1 face; `k=2` moves 2; `k=9` is clamped to 2 and reports `k: 2`.
  - A grab exactly on a vertex returns a deterministic face (the same result twice, with no throw). (Review Focus 1)
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Break ties for points on boundaries by choosing the lowest face id among the topmost.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(engine): layer lookup and top-k flap selection`.

---

### Task 6: Poses and swept collision

**Files:**
- Create: `src/engine/poses.ts`, `src/engine/collision.ts`
- Test: `src/engine/poses.test.ts`, `src/engine/collision.test.ts`

**Interfaces:**
- Produces:
  - `type FacePose = { face: number; matrix: number[] }`. A column-major 4×4 matrix mapping paper coordinates (z = 0) to world coordinates. The layer offset is not included; that's the renderer's job.
  - `poses(frame: Frame, swing?: { faces: number[]; axis: Line; angleDeg: number }): FacePose[]`. Walks the face tree from root face 0, composing hinge rotations by `edges_foldAngle`. Applies `swing` to the listed faces about `axis`.
  - `sweep(frame: Frame, swing: { faces: number[]; axis: Line }, fromDeg: number, toDeg: number): { freeDeg: number; blocked: boolean }`. Samples in steps of at most 5°. A test fails when any moving triangle intersects any static triangle that it didn't share an edge with at the start.

- [ ] **Step 1: Write the failing tests.**
  - Every vertex of a flat sheet's poses has z = 0.
  - A valley-folded half at 90°: the moved face's far corner has z ≈ +0.5, and its x is the crease x.
  - A mountain fold at 90°: z ≈ −0.5.
  - Edge lengths are preserved under poses, to 1e-9.
  - `sweep` with no obstruction: `blocked: false` and `freeDeg: toDeg`.
  - `sweep` where a flap is swung through a stationary flap stacked above it (fixture: fold a half, then swing the lower layer up through the upper one): `blocked: true`, and `freeDeg` < 180.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Use Rodrigues rotation for the hinge, and the triangle–triangle intersection test from Möller (1997).
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(engine): 3D face poses and swept collision`.

---

### Task 7: preview() and commit() for valley/mountain folds

**Files:**
- Create: `src/engine/ops.ts`
- Test: `src/engine/ops.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:
  - `type Gesture = { tool: Tool; grab: Vec2; target: Vec2; layers: number; kind: FoldKind; progress: number; snapAngle: boolean }`
  - `type Preview = { crease: [Vec2, Vec2][]; moving: number[]; layers: number; angleDeg: number; poses: FacePose[]; blocked: boolean }`
  - `preview(frame: Frame, g: Gesture): Result<{ preview: Preview }>`
  - `commit(frame: Frame, g: Gesture): Result<{ frame: Frame; step: Step }>`. The step label format is `"Valley fold · top flap · 180°"`, or `"Mountain fold · 3 layers · 90°"`.

- [ ] **Step 1: Write the failing tests.**
  - Dragging corner `[1,1]` to `[0,0]` on a square: a preview crease along the anti-diagonal, `moving.length === 1`, angle 180 at progress 1.
  - commit: area is conserved, and every frame has `faceOrders`.
  - A crease off the paper is refused with `"That crease misses the paper."`.
  - A zero-length drag is refused with `"Drag further to fold."` (Review Focus 2).
  - `layers: 9` on a half fold gives `preview.layers === 2` (Review Focus 3).
  - A blocked sweep gives `preview.blocked === true` and `angleDeg === freeDeg`.
  - Labels: "Valley fold · top flap · 180°" when k = 1, and "Mountain fold · 2 layers · 90°".
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. The moving side is the side of the crease that contains `grab`. When the angle is < 180, the frame keeps the partial `edges_foldAngle`, and the layer solve is skipped (layers are only solved for flat states).
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(engine): preview and commit for valley/mountain folds`.

---

### Task 8: Reverse, squash and petal, plus the partial-fold rule

**Files:**
- Modify: `src/engine/ops.ts` (dispatch on `g.tool`)
- Create: `src/engine/compound.ts`
- Test: `src/engine/compound.test.ts`

**Interfaces:**
- Produces:
  - `reverseFold(frame, g): Result<...>`. Inside or outside is chosen by whether the drag direction points into the flap's open side. Refused with `"This flap can't reverse-fold: it isn't folded in half."`.
  - `squashFold(frame, g): Result<...>`
  - `petalFold(frame, g): Result<...>`. Composed of two `squash` calls followed by a valley lift of the lower point.
  - `preview` and `commit` route to these by tool.

- [ ] **Step 1: Write the failing tests.** Fixtures are built from Rabbit Ear bases, through a testkit helper `base('waterbomb' | 'kite' | 'bird')`.
  - A reverse fold on a flap folded in half (a triangle folded in half): the face count increases, layers are valid, and area is conserved.
  - A reverse fold on a single-layer flap is refused with the exact spec message.
  - A squash fold on a preliminary-base flap gives a symmetric result (the two new faces mirror each other across the original folded edge).
  - A petal fold on a preliminary base gives a valid layer order, and the flap's tip moves past the top.
  - The partial-fold rule: after a 90° valley fold, a fold through multiple flaps is refused with `"Flatten the model before this fold."`; a single-flap hinge fold on the swung flap is allowed. (Review Focus 5)
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement using the Task 2 adapter (`reverse`, `squash`), then call `withLayerOrder`.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(engine): reverse, squash, petal folds`.

---

### Task 9: Turn over, landmarks, snapping and the public API

**Files:**
- Create: `src/engine/snap.ts`
- Modify: `src/engine/ops.ts` (add `turnOver`), `src/engine/index.ts`
- Test: `src/engine/snap.test.ts`, `src/engine/api.test.ts`

**Interfaces:**
- Produces:
  - `turnOver(frame: Frame): Ok<{ frame: Frame; step: Step }>`. Mirrors across the vertical axis through the folded bounding-box centre and reverses the layer order.
  - `type Landmark = { p: Vec2; kind: 'corner' | 'midpoint' | 'intersection' | 'edge' }`
  - `landmarks(frame: Frame): Landmark[]`. In folded space, with duplicates removed to 1e-6.
  - `snapPoint(p: Vec2, ls: Landmark[], radius: number): { p: Vec2; snapped?: Landmark }`. Priority order: corner > intersection > midpoint > edge, then distance.
  - `index.ts` re-exports exactly: `createPaper`, `preview`, `commit`, `turnOver`, `poses`, `landmarks`, `snapPoint`, `layerAt`, the history functions, and the types.
  - `createPaper(size: PaperSize): Frame` (wraps `makeSheet`). `PAPER_SIZES = { square: { width: 1, height: 1 }, a4: { width: 1, height: Math.SQRT2 } }`.

- [ ] **Step 1: Write the failing tests.**
  - turnOver twice gives the same `faceOrders` and windings as the original; undoing a turnOver in history restores the original frame. (Review Focus 4)
  - Landmarks on a fresh square: 4 corners and 4 midpoints.
  - `snapPoint` prefers a corner over a midpoint at equal distance, and returns the raw point when nothing is within the radius.
  - An API surface test: `Object.keys(await import('@engine')).sort()` equals the expected list.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(engine): turn over, landmarks, snapping, public API`.

---

### Task 10: Presets as data, and end-to-end engine tests

**Files:**
- Create: `src/presets/types.ts`, `src/presets/plane.ts`, `src/presets/cup.ts`, `src/presets/crane.ts`, `src/presets/index.ts`
- Test: `src/presets/presets.test.ts`

**Interfaces:**
- Produces:
  - `type Preset = { id: 'plane' | 'cup' | 'crane'; name: string; paper: 'square' | 'a4'; steps: Gesture[] | ({ tool: 'turnOver' })[] }`
  - `PRESETS: Preset[]`
  - `runPreset(p: Preset): Result<{ history: History }>`

- [ ] **Step 1: Write the failing tests.**
  - Each preset runs to the end with `ok: true`.
  - Every intermediate frame has valid `faceOrders`.
  - The final area equals the paper area.
  - The plane has 8 steps on A4, the cup 6 on a square, and the crane uses at least one squash and two petal folds.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Author the sequences. The plane and cup step lists follow the classic diagrams (spec 03). For the crane: preliminary base (squash ×2), petal ×2, narrow the legs, inside reverse for the neck and tail, inside reverse for the head.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit with `feat(presets): plane, cup, crane as engine gestures`.
