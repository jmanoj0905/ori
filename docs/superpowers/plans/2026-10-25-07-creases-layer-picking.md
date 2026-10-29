# Living Creases and Layer Picking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Grabbing a folded flap swings it on its existing crease.
- Layers are picked from a press-and-hold side-view belt.
- Open creases are drawn, and new folds lock onto them.

**Architecture:** The engine gains three pure, per-frame-cached queries: `hingesAt`, `snapCreaseLine` and `stackProfile`. The studio's fold gesture reads each drag against the candidate hinges using a small pure policy (`dragReading.ts`) with hysteresis. A swing is sent to the engine as an ordinary gesture whose `crease` is the hinge line, so the existing `hingePlan` path does the geometry. Scroll, `[` `]` and the layer stepper are removed. A press-and-hold opens a `LayerBelt` island instead.

**Tech Stack:** TypeScript, React, zustand, Three.js, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-09-creases-layer-picking-design.md`

## Global Constraints
- Nothing outside `src/engine/` imports rabbit-ear. New engine queries are exported only through `src/engine/index.ts`.
- 60 fps while dragging on a 300-face model. Hover queries run at most once per animation frame.
- Hold to open the belt: `HOLD_MS = 400`, drift allowed `HOLD_SLOP_PX = 4`.
- Settle-open threshold: within `SETTLE_OPEN_DEG = 10` of flat.
- New bindings: `layerPicker` defaults to key `l`, and `forceNewFold` to the hold-modifier `alt`. Settings `version: 2`.
- Snap toggle label: `Creases` (key `creases` in `SnapSettings`), default `true`.
- Fold bar reading labels, exactly: `Swing on crease` and `New fold`.
- Open crease ('F', or angle 0 on a non-boundary edge): faint, thin, solid line, never dashed.
- Belt announcement format: `Layer {i} of {n}: top flap` for i = 1, and `Layer {i} of {n}: top flap and {i-1} below` otherwise.
- Hint line: `[ ] layers` becomes `L layers`.

## Review Focus
1. **Swing reading on the classic corner fold.** A half-folded sheet whose top-flap corner is dragged diagonally at about 45° toward the hinge should read as **New fold**: the swing cone is ≤30°. The test is in Task 6.
2. **A hold that drifts slowly.** A press that moves under 4px for 400ms opens the belt. Moving 5px before then never opens it, and the fold proceeds with the top layer. The test is in Task 9.
3. **Releasing inside the belt.** No step is pushed and no gesture remains. The test is in Task 9.
4. **Old saved settings.** A v1 save with custom `layersLess` bindings loads as v2. Other custom bindings are kept, and the new actions get their defaults. The test is in Task 4.
5. **Grabbing exactly on a hinge line.** `hingesAt` returns no candidate for that line (no side to swing). The drag reads as a new fold and does not throw. The test is in Task 1.

---

### Task 1: Engine — `hingesAt`

**Files:**
- Create: `src/engine/hinges.ts`
- Create: `src/engine/hinges.test.ts`
- Modify: `src/engine/ops.ts`: export `hingePlan` and the `Hinge` type, unchanged otherwise.
- Modify: `src/engine/index.ts`: export `hingesAt` and `type HingeCandidate`.

**Interfaces:**
- Produces:
  ```ts
  export type HingeCandidate = {
    line: Line                     // oriented so `grab` is on its left (side > 0)
    segments: [Vec2, Vec2][]       // folded-space hinge segments, for drawing
    faces: number[]                // the flap (input-frame face ids)
    k: number                      // layers taken (selectFlap's clamp)
    openKind: FoldKind             // the kind whose swing moves the hinge toward 0°
    rangeDeg: number               // |current hinge angle|: how far it can swing open
  }
  export function hingesAt(frame: Frame, grab: Vec2, k: number, face?: number): HingeCandidate[]
  ```

- [ ] **Step 1: Write failing tests** in `hinges.test.ts`:
  - `half fold: one hinge at x = 0.5`. Use `hingesAt(halfFolded(), [0.1, 0.5], 1)`. Expect length 1, `|line.vector[0]| < 1e-9`, `line.origin[0] ≈ 0.5`, `rangeDeg ≈ 180`, and `segments` spanning y 0→1.
  - `openKind swings it open`. Commit a gesture with `crease: hinge.line`, `kind: hinge.openKind`, `progress: 1`, `grab: [0.1, 0.5]`. Every edge angle in the result is 0, and the x = 0.5 edge is `'F'`.
  - `second of two folds`. Take `halfFolded()`, then `commit` a fold with `crease: {origin:[0,0.5],vector:[1,0]}`, `grab: [0.25,0.9]`, `layers: 2`, `progress: 1`. On the result, `hingesAt(f, [0.25, 0.1], 2)` contains a candidate whose line is y = 0.5, with `faces.length === 2` and `rangeDeg ≈ 180`.
  - `flat sheet: none`. `hingesAt(makeSheet({width:1,height:1}), [0.5,0.5], 1)` is `[]`.
  - `open crease is not a hinge`. After the "openKind" commit above, `hingesAt(that, [0.1,0.5], 1)` is `[]`.
  - `grab on the hinge line: none for that line` (Review Focus 5). `hingesAt(halfFolded(), [0.5, 0.5], 1)` has no candidate with origin x ≈ 0.5, and does not throw.
  - `cached per frame`. Two calls with the same arguments return deep-equal arrays, and the second is under 1ms on `accordion(40)`.
- [ ] **Step 2:** Run `npx vitest run src/engine/hinges.test.ts`. Expected: FAIL, because `hingesAt` is not exported.
- [ ] **Step 3: Implement.**
  - Collect the non-boundary edges that have two faces and |foldAngle| > 1e-6 (flat model) or a non-flat angle (non-flat model). This mirrors the `along` filter in `hingePlan`.
  - Group them by folded-space line (direction mod 180°, offset), with tolerance 1e-7.
  - For each line:
    - skip it if |side(grab)| < 1e-7;
    - otherwise orient it so grab is on the left;
    - call `hingePlan(frame, {tool:'fold', grab, target: grab, layers: k, kind:'valley', progress: 0, snapAngle: false, crease: line, ...(face===undefined?{}:{face})})`;
    - keep it if the result is `ok`.
  - Compute `openKind` from the first hinge edge, with angle a and rate r: `-Math.sign(a * r) > 0 ? 'valley' : 'mountain'`.
  - `rangeDeg = Math.abs(a)`.
  - Cache per frame in a `WeakMap<Frame, Map<string, HingeCandidate[]>>`, keyed by `${grab},${k},${face}`, and keep only the last 8 keys.
- [ ] **Step 4:** Run `npx vitest run src/engine`. Expected: all PASS, including `boundaries.test.ts`.
- [ ] **Step 5:** Commit: `git commit -m "feat(engine): hingesAt finds the creases a grabbed flap hangs on"`

### Task 2: Engine — crease line snap

**Files:**
- Modify: `src/engine/snap.ts`, `src/engine/snap.test.ts`, `src/engine/index.ts`

**Interfaces:**
- Produces: `export function snapCreaseLine(frame: Frame, line: Line, tol: { angleDeg: number; dist: number }): Line | null`. It returns the existing crease line (non-boundary edges of any assignment, in folded space) closest to `line` within both tolerances, or null. "Closest" means the smallest offset distance, measured at the projection of `line.origin`.

- [ ] **Step 1: Write failing tests:**
  - On the frame from Task 1's "openKind" commit (an 'F' crease at x = 0.5), `snapCreaseLine(f, {origin:[0.52,0.3], vector:[0.02,1]}, {angleDeg: 4, dist: 0.04})` returns a line with x ≈ 0.5 everywhere.
  - The same input with `dist: 0.01` returns null.
  - With `angleDeg: 0.5`, it returns null.
  - On a fresh sheet (boundary only), it returns null.
- [ ] **Step 2:** Run `npx vitest run src/engine/snap.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Reuse the per-frame `cache` pattern: store the deduped crease lines alongside the landmarks.
- [ ] **Step 4:** Run `npx vitest run src/engine`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(engine): snapCreaseLine locks a fold onto an existing crease"`

### Task 3: Engine — `stackProfile` for the side view

**Files:**
- Modify: `src/engine/layers.ts`, `src/engine/layers.test.ts`, `src/engine/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StackProfile = {
    faces: number[]                                        // stackFrom(frame, p, face): top → bottom
    joins: { upper: number; lower: number; at: Vec2 }[]    // indices into `faces` joined by a shared non-boundary edge; `at` = that edge's folded midpoint
  }
  export function stackProfile(frame: Frame, p: Vec2, face?: number): StackProfile
  ```

- [ ] **Step 1: Write failing tests:**
  - `halfFolded()` at `[0.25, 0.5]`: `faces.length === 2`, and `joins` is `[{upper:0, lower:1, at:≈[0.5,0.5]}]`.
  - `accordion(4)` at `[0.125, 0.5]`: `faces.length === 4` and `joins.length === 3`.
  - Fresh sheet: one face, no joins.
- [ ] **Step 2:** Run `npx vitest run src/engine/layers.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with `stackFrom` and `edgeFaces` (both already in the engine).
- [ ] **Step 4:** Run `npx vitest run src/engine`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(engine): stackProfile describes the paper stack at a point"`

### Task 4: Settings v2 and removing blind layer controls

**Files:**
- Modify: `src/settings/schema.ts`
  - `Action`: remove `layersLess` and `layersMore`; add `layerPicker` and `forceNewFold`.
  - `SnapSettings`: add `creases: boolean`.
  - `Settings.version: 2`, `SETTINGS_VERSION = 2`.
- Modify: `src/settings/bindings.ts`
  - defaults: `layerPicker: [key('l')]`, `forceNewFold: [{ type: 'modifier', key: 'alt' }]`;
  - `WHEEL_CONTEXTS` keeps only `zoom`;
  - update the header comment.
- Modify: `src/settings/store.ts`: `migrate` accepts versions 1 and 2. Bindings for actions not in `ACTIONS` are dropped by `cleanBindings`. Set `snap.creases` (default `true`) and output `version: 2`.
- Modify: `src/settings/describe.ts`: names for the new actions are "Pick layers" and "Force a new fold".
- Modify: `src/input/router.ts`: the wheel is always `zoom`. Remove the folding→layers context and `LAYER_STEP_PX`. Update the contract comment.
- Modify: `src/input/useInput.ts`
  - remove the `layers` helper and the `layersLess` / `layersMore` handlers;
  - add `layerPicker: () => kf.openBelt()` (Task 10 provides it; until then, a no-op stub `openBelt(): boolean { return false }` in `keyboardFold.ts`);
  - add `forceNewFold: e => g.setForceNew(e.phase === 'start')` (Task 8 provides it; stub it now).
- Modify: `src/studio/islands/FoldBar.tsx`: remove the − / + stepper and the touch-only branch for it. The badge stays as read-only text, e.g. "2 of 4 layers".
- Modify: `src/studio/islands/HintLine.tsx`: `[ ] layers` becomes `L layers`.
- Modify: `src/studio/islands/Tools.tsx`: `SNAPS` gains `{ key: 'creases', label: 'Creases' }` after `edges`.
- Modify: `src/studio/SettingsSheet.tsx`: the rebinding list follows `ACTIONS`. Check it has no hard-coded layer rows.
- Tests: update every file `git grep -l "layersLess\|layersMore\|LAYER_STEP_PX\|Fewer layers\|\[ \] layers"` lists (router, touch, bindings, describe, keys, coarse, islands, settingsSheet, lessonSlice, lessonUi, store tests).

- [ ] **Step 1: Write failing tests:**
  - `settings/store.test.ts`, test `migrates a v1 save` (Review Focus 4): a v1 object with `bindings.layersLess = [key('9')]` and `bindings.undo = [key('u', { mod: true })]` migrates to `version: 2`, with no `layersLess` key, `undo` kept as custom, `layerPicker` equal to the default, and `snap.creases === true`.
  - `bindings.test.ts`: the defaults have no conflicts; `forceNewFold` is a modifier on alt.
  - `router.test.ts`, test `wheel zooms while folding`: during an active fold drag, a wheel event emits `zoom`, not a layer action.
- [ ] **Step 2:** Run `npx vitest run src/settings src/input`. Expected: FAIL.
- [ ] **Step 3:** Make the changes listed above.
- [ ] **Step 4:** Run `npm test`. Expected: tsc clean and all PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(settings): v2 bindings: layer picker and force-new-fold replace blind layer steps"`

### Task 5: Render — open creases and the hover flap

**Files:**
- Modify: `src/render/creases.ts`: `buildCreases` also collects open creases (non-boundary edges with assignment `F`/`f`/`U`/`u`, or V/M with angle 0) into a third set, `open`. They are drawn with `makeCreaseLines` and a solid pattern (`DASH.open = [1, 0]`), with `opacity: 0.35` and `width: 0.75` (my call within the spec's "faint, thin").
- Modify: `src/render/Stage.ts`
  - add the `open` set wherever valley/mountain are added and disposed;
  - add `setHoverFlap(faces: readonly number[] | null, hinges: readonly (readonly [Vec2, Vec2])[]): void`. It draws the faces' folded outlines softly tinted and the hinge segments with `buildLiveCrease` in the accent colour at 0.6 opacity. `null` clears it.
- Test: `src/render/creases.test.ts` (create it if absent; follow the existing render tests' style).

- [ ] **Step 1: Write failing tests:**
  - `buildCreases` on the Task 1 "openKind" frame returns `open` with 1 segment instance, and `valley` / `mountain` with 0.
  - On `halfFolded()`, `open` has 0 instances.
- [ ] **Step 2:** Run `npx vitest run src/render`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/render`, then `npm run e2e -- visual.spec.ts`. Expected: unit tests PASS. Visual baselines show no change for the existing shots (none has an open crease).
- [ ] **Step 5:** Commit: `git commit -m "feat(render): draw open creases and the hover flap"`

### Task 6: Studio — drag reading policy

**Files:**
- Create: `src/studio/dragReading.ts`
- Create: `src/studio/dragReading.test.ts`

**Interfaces:**
- Consumes: `HingeCandidate` (Task 1).
- Produces:
  ```ts
  export type Reading = { mode: 'new' } | { mode: 'swing'; hinge: number }
  export const SWING_ENTER = Math.cos(Math.PI / 6)   // ≤ 30° off the hinge normal
  export const SWING_EXIT = Math.cos(Math.PI / 4)    // stays a swing until > 45° off
  export const SWITCH_MARGIN = 0.15
  export const SETTLE_OPEN_DEG = 10
  export function readDrag(a: { grab: Vec2; cursor: Vec2; hinges: readonly HingeCandidate[]; prev: Reading; forceNew: boolean; minDrag: number }): Reading
  export function settleOpen(progress: number, rangeDeg: number): number
  ```
- Rules:
  - The score for a hinge is `dot(unit(cursor − grab), n)`, where `n` is the unit normal from grab toward the hinge line (the right-hand normal of `line.vector`, since grab is on the left).
  - With `forceNew`, the reading is new.
  - If |cursor − grab| < `minDrag`, the reading is `prev`.
  - From new: enter a swing on the best hinge if its score is ≥ `SWING_ENTER`.
  - From a swing on h: stay while score(h) ≥ `SWING_EXIT`, but switch to the best hinge b if score(b) − score(h) ≥ `SWITCH_MARGIN`. Otherwise go to new.
  - `settleOpen`: return 1 when `rangeDeg − progressToAngle(progress) ≤ SETTLE_OPEN_DEG`. Otherwise return `progress` unchanged.

- [ ] **Step 1: Write failing tests.** Hinge H is x = 0.5 with grab [0.1, 0.5], so n = [1, 0]:
  - `straight toward the hinge swings`: cursor [0.4, 0.5] → `{mode:'swing', hinge:0}`.
  - `45° corner fold stays a new fold` (Review Focus 1): cursor [0.3, 0.3] → `{mode:'new'}`.
  - `away from the hinge is new`: cursor [0.0, 0.5] → new.
  - `hysteresis`: with prev swing, a cursor at 40° off → still swing; at 50° off → new.
  - `force new`: cursor [0.4, 0.5] with `forceNew` → new.
  - `below minDrag keeps prev`.
  - `two hinges, direction picks`: with hinges x = 0.5 and y = 0.9, grab [0.1, 0.5]: cursor [0.1, 0.8] gives hinge 1, cursor [0.4, 0.5] gives hinge 0.
  - `settleOpen`: `settleOpen(p, 180)` returns 1 when `progressToAngle(p) = 172`, and returns p when it is 160.
- [ ] **Step 2:** Run `npx vitest run src/studio/dragReading.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(studio): drag reading policy for swing vs new fold"`

### Task 7: Studio store — swing-aware drag and the fold bar label

**Files:**
- Modify: `src/studio/store.ts`, `src/studio/store.test.ts`, `src/studio/islands/FoldBar.tsx`, `src/studio/islands/islands.test.tsx`

**Interfaces:**
- Consumes: `Reading` (Task 6).
- Produces:
  - `drag(target: Vec2, progress: number, opts?: { crease?: Line; kind?: FoldKind; reading?: 'swing' | 'new' }): void`.
    - Without `opts.crease`, the gesture's `crease` is removed.
    - Without `opts.kind`, the gesture kind is the store's `kind`.
    - Existing callers (keyboard fold) are unchanged.
  - `StudioState.reading: 'swing' | 'new' | null`. It is reset to null by `begin`, `cancel` and `release`.
  - While `reading === 'swing'`, `setKind` updates only the store's `kind` and does not re-preview. The fold bar's V/M toggle is disabled.
  - The fold bar shows `Swing on crease` or `New fold` while `reading` is non-null.

- [ ] **Step 1: Write failing tests:**
  - `store.test.ts`: `drag` with `{crease, kind:'mountain', reading:'swing'}` sets `gesture.crease`, `gesture.kind === 'mountain'` and `reading === 'swing'`, while the store's `kind` stays `'valley'`. A following `drag` with no opts clears `gesture.crease` and sets `gesture.kind === 'valley'`.
  - `setKind` during a swing leaves `gesture.kind` unchanged.
  - `islands.test.tsx`: FoldBar renders the text `Swing on crease` when `reading = 'swing'`, and the V/M toggle is `disabled`.
- [ ] **Step 2:** Run `npx vitest run src/studio/store.test.ts src/studio/islands`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(studio): store carries the drag reading and swing crease"`

### Task 8: Studio gesture — swing, crease snap, force-new, settle-open, hover

**Files:**
- Modify: `src/studio/useFoldGesture.ts`, `src/studio/useFoldGesture.test.ts` (or the existing gesture test file; check `git grep -l createFoldGesture -- '*.test.*'`)
- Modify: `src/input/useInput.ts`: replace the Task 4 stub wiring with the real `g.setForceNew`.

**Interfaces:**
- Consumes: `hingesAt`, `snapCreaseLine` (Tasks 1–2); `readDrag`, `settleOpen` (Task 6); `store.drag(target, progress, opts)` (Task 7); `Stage.setHoverFlap` (Task 5).
- Produces:
  - `GestureStage.setHoverFlap?(faces: readonly number[] | null, hinges: readonly (readonly [Vec2, Vec2])[]): void`;
  - `GestureOptions.raf?: (cb: () => void) => void` (default `requestAnimationFrame`);
  - `createFoldGesture(...)` returns `setForceNew(on: boolean): void` in addition to the existing handlers.
- Behaviour:
  - **On `down`:** compute `hinges = hingesAt(frame, grab, gesture.layers, face)`, but only when `tool === 'fold'`. Other tools get `[]`.
  - **On `move`:**
    - `reading = readDrag({ grab, cursor, hinges, prev, forceNew, minDrag: 6 / pxPerUnit })`.
    - **Swing:** `store.drag(cursor, dragProgress(grab, h.line, cursor), { crease: h.line, kind: h.openKind, reading: 'swing' })`.
    - **New fold:** compute the bisector as now. If `useSettings.getState().snap.creases`, try `snapCreaseLine(frame, bisector, { angleDeg: 4, dist: radiusPaper })`. If it hits, pass `{ crease: hit, reading: 'new' }`, with progress taken from `dragProgress(grab, hit, cursor)`.
  - **On `up`:** if the reading is a swing, call `store.drag(lastTarget, settleOpen(progress, h.rangeDeg), sameOpts)` before `release()`.
  - **`hover`:** throttled with `raf`. Call `hingesAt(frame, hit.folded, 1, hit.face)`, then `stage.setHoverFlap(hinges.length ? union(faces) : [hit.face], hinges.flatMap(h => h.segments))`. `leave` and `down` clear it.

- [ ] **Step 1: Write failing tests.** Use a mock `GestureStage` over `halfFolded()` with an identity projection, as the existing gesture tests do:
  - `pulling the flap back opens it` (acceptance 1, engine side): down at [0.1, 0.5], move to [0.9, 0.5], up. The committed frame has all angles 0, and the x = 0.5 edge is `'F'`.
  - `release near open settles open`: move to a point where `progressToAngle(progress) = 172` (about 0.72 along). The committed result is fully open.
  - `forceNew makes a new fold`: `setForceNew(true)` before moving toward the hinge. The commit pushes a new crease (the edge count grows) and the x = 0.5 hinge angle is unchanged.
  - `crease snap`: on the opened frame, a drag whose bisector is x = 0.51 commits a fold whose crease is x = 0.5 (no new vertices on the x = 0.5 line).
  - `hover highlights hinge`: `hover` at [0.1, 0.5] with a sync `raf` calls `setHoverFlap` with a non-empty hinge list. Two hovers within one frame call it once.
- [ ] **Step 2:** Run `npx vitest run src/studio`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(studio): drag swings folded flaps on their creases"`

### Task 9: Layer belt — pointer flow and island

**Files:**
- Create: `src/studio/belt.ts` (geometry), `src/studio/belt.test.ts`
- Create: `src/studio/islands/LayerBelt.tsx`, plus styles in `islands.css`
- Modify: `src/studio/ui.ts`: `belt` state
- Modify: `src/studio/useFoldGesture.ts`: hold timer and belt flow
- Modify: `src/studio/App.tsx`: render `<LayerBelt />`

**Interfaces:**
- Consumes: `stackProfile` (Task 3), `store.setLayers` (existing).
- Produces:
  ```ts
  // belt.ts
  export const HOLD_MS = 400, HOLD_SLOP_PX = 4, BELT_RADIUS_PX = 72
  export type BeltState = { clientX: number; clientY: number; stack: StackProfile; hovered: number | null; keyboard: boolean }
  export function rowPx(n: number): number                         // min(14, (2 * BELT_RADIUS_PX - 16) / n)
  export function insideBelt(b: BeltState, x: number, y: number): boolean
  export function beltRowAt(b: BeltState, x: number, y: number): number | null   // rows stacked top→bottom, centred on (clientX, clientY)
  export function layerWords(i: number, n: number): string        // Global Constraints format, i 1-based
  // ui.ts additions
  belt: BeltState | null
  openBelt(b: BeltState): void
  hoverBelt(i: number | null): void
  closeBelt(): void
  ```
- Pointer flow (in `createFoldGesture`; the timer comes from injectable `opts.setTimeout`/`clearTimeout`):
  - **On `down`:** start a `HOLD_MS` timer. Any move more than `HOLD_SLOP_PX` from the press point (in client px) clears it. When it fires, call `openBelt({ clientX, clientY, stack: stackProfile(frame, grab, face), hovered: null, keyboard: false })`.
  - **`move` while the belt is open:**
    - inside the belt: `hoverBelt(beltRowAt(...))` and nothing else;
    - on leaving the belt: `setLayers((hovered ?? 0) + 1)`, recompute `hinges` for the new k, `closeBelt()`, then handle the move as a normal drag.
  - **`up` while the belt is open:** `closeBelt()`, then `store.cancel()`. No step is pushed.
  - **`cancel`:** also calls `closeBelt()`.
- `LayerBelt`:
  - an absolutely positioned circle at (clientX, clientY), with the frosted-ivory island style;
  - an SVG side view: one horizontal line per layer; each join drawn as a half-round on the left or right, chosen by the sign of `(clientOf(join.at) − clientOf(grab)) · x`;
  - the hovered row and every row above it drawn in the accent colour;
  - `role="listbox"` with one `role="option"` per row, whose `aria-label` is `layerWords(i, n)`;
  - `pointer-events: none` (the router owns the pointer).

- [ ] **Step 1: Write failing tests:**
  - `belt.test.ts`:
    - `beltRowAt` maps the centre ± rows correctly for n = 2 and n = 30;
    - `rowPx(30) < 14`;
    - `layerWords(1, 4)` is `Layer 1 of 4: top flap`, and `layerWords(3, 4)` is `Layer 3 of 4: top flap and 2 below`.
  - Gesture tests (fake timers):
    - `hold opens the belt`: after down and 400ms with no move, `ui.belt` is set and `belt.stack.faces.length === 2` on `halfFolded()`.
    - `drift under slop still opens` and `moving 5px first never opens` (Review Focus 2).
    - `drag out takes the hovered layer and those above`: hover row 1 (the second layer), then move outside the radius. Expect `gesture.layers === 2`, and `ui.belt === null`.
    - `release inside the belt does nothing` (Review Focus 3): history length unchanged, `gesture === null`.
- [ ] **Step 2:** Run `npx vitest run src/studio`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(studio): press-and-hold layer belt with side view"`

### Task 10: Keyboard belt

**Files:**
- Modify: `src/studio/keyboardFold.ts`, plus its test file (`git grep -l createKeyboardFold -- '*.test.*'`)

**Interfaces:**
- Consumes: `openBelt`, `hoverBelt`, `closeBelt` and `layerWords` (Task 9); `store.setLayers`.
- Produces: `openBelt(): boolean` on the keyboard fold object (replacing the Task 4 stub).
  - It works only in phase `'target'` (grab set). It opens the belt with `keyboard: true` at `stage.clientOf(grab)`, with `hovered: 0`, and announces `layerWords(1, n)`.
  - While the belt is open, `key()` handles it first and returns true:
    - `ArrowUp` / `ArrowDown`: move `hovered`, clamped, and announce `layerWords`;
    - `Enter`: `setLayers(hovered + 1)`, then `closeBelt()`, which re-previews;
    - `Escape`: `closeBelt()` only. The keyboard fold stays active.
  - Update the header comment table: `[ ]` becomes `L` (open the layer belt).

- [ ] **Step 1: Write failing tests:**
  - On `halfFolded()`, after `start` → Enter (grab) → Tab (target), `openBelt()` returns true.
  - `ArrowDown` announces `Layer 2 of 2: top flap and 1 below`. `Enter` sets `gesture.layers === 2` and closes the belt.
  - `Escape` closes the belt, and `phase()` is still `'target'`.
  - `openBelt()` in phase `'idle'` returns false.
- [ ] **Step 2:** Run `npx vitest run src/studio`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(studio): keyboard access to the layer belt"`

### Task 11: Acceptance scenarios and spec amendments

**Files:**
- Create: `e2e/creases.spec.ts`
- Modify: `e2e/fold.spec.ts`, `e2e/keyboard.spec.ts`, `e2e/stage.spec.ts`: drop any scroll or `[` `]` layer steps (find them with `git grep -n "wheel\|'\['\|'\]'" e2e`)
- Modify: `docs/superpowers/specs/2026-10-20-03-studio-ui-interaction-design.md`, `…-04-settings-controls-accessibility-design.md`, `…-02-rendering-visual-design.md`: apply the "Amends" section of spec 09. Add a line to the overview spec map: `| 09 | Living creases and layer picking | 6 |`.

- [ ] **Step 1: Write the Playwright specs**, using the `e2e/helpers.ts` drag helpers. Each asserts on the steps list and the mini crease-pattern view.
  - `open the second of two folds`: fold in half, fold in half again, then drag the top flap back across its hinge. Expect the 3rd step label to be a swing, and the mini CP to show one open crease plus one valley.
  - `refold reversed`: fold a corner, swing it open, press `M`, then drag across the same line. Expect the commit to land on the existing crease (the creases toggle is on) as a mountain.
  - `waterbomb from pre-creases`: fold and unfold both diagonals and both book folds, check that all four show as open creases, then collapse using the Reverse/Squash flow the cup lesson uses. Expect the final frame to match the lesson's waterbomb base target (`src/lessons/data/waterbomb.json`) via `checkStep` exposed in dev, as `lesson.spec.ts` does.
  - `belt`: press and hold the half-folded sheet for 450ms, then drag out over row 2. Expect the badge to read `2 of 2 layers`.
- [ ] **Step 2:** Run `npm run e2e -- creases.spec.ts`. Expected: PASS. Then run `npm run e2e`. Expected: the whole suite passes, with baselines unchanged.
- [ ] **Step 3:** Edit the spec amendments.
- [ ] **Step 4:** Run `npm test && npm run e2e`. Expected: all PASS.
- [ ] **Step 5:** Commit: `git commit -m "test(e2e): crease and layer-picking acceptance; amend specs 02-04"`
