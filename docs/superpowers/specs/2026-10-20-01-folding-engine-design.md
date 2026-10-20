# Spec 01: Folding engine

Phase 1. This is the core of Ori. Everything else reads from it.

## Intent
Give the app exact, trustworthy folded geometry that can be animated in 3D and driven by a drag gesture. The engine is pure TypeScript with no rendering and no React, so it can be unit-tested in isolation.

## Responsibilities
1. Hold the model as FOLD frames and keep the history.
2. Run fold operations: valley/mountain (flat or at any angle), inside/outside reverse, squash, petal, and turn over.
3. Solve and keep the layer order.
4. Check for collisions while a fold is in progress.
5. Turn a drag into a crease, including snapping.
6. Compute 3D face poses for the renderer.

## 1. Model
- **A frame** is a FOLD object with:
  - `vertices_coords` (paper space, 2D);
  - `edges_vertices` and `edges_assignment` (M, V, B or F), plus `edges_foldAngle`;
  - `faces_vertices`;
  - `faceOrders` for layering.
- **Frames are immutable.** Each committed operation produces a new frame plus a step record. The step record holds:
  - the operation kind;
  - its parameters (crease line, grab point, layer count k, angle, tool);
  - a human label;
  - a timestamp.
- **History** is an ordered list of steps plus a cursor (used for undo/redo and for jumping to a step). Redo entries are dropped when a new fold is committed after an undo.
- **Paper setup:** width and height in paper units. A square is 1 × 1, A4 is 1 × √2, and custom sizes are allowed. Kami's physical size (15 cm) is used only to display measurements.
- **3D poses are derived, never stored:**
  - Pick a fixed root face.
  - Walk the face adjacency tree, composing hinge rotations by `edges_foldAngle`.
  - Cache the poses for each frame.

## 2. Operations
All operations take the current frame and parameters, and return either a new frame or a refusal with a human-readable reason.

| Operation | Source | Notes |
|---|---|---|
| Valley / mountain (flat) | Rabbit Ear `flatFold`/`simpleFold` | Through the selected layers only (top k at the grab point) |
| Valley / mountain at any angle | Built on the above | Stores the target angle. A flat fold is ±180° |
| Inside / outside reverse | Rabbit Ear `reverseFold` | Applies to a flap that is folded in half |
| Squash | Rabbit Ear `squashFold` | The flap opens and flattens symmetrically |
| Petal | Composition | Two squash folds followed by a valley lift, unless Rabbit Ear adds a primitive for it |
| Turn over | Ours | Mirrors the model and reverses the layer order |

**Folding after a partial fold.** If the model already contains a fold that isn't flat, v1 only allows further folds that are rigid single-flap hinge rotations. For anything else, the user is asked to flatten the model first.

**Refusal reasons** are short sentences. Examples:
- "That crease misses the paper."
- "This flap can't reverse-fold: it isn't folded in half."
- "No valid layer order exists for this fold."

## 3. Layers
- Rabbit Ear's layer solver (taco-taco, taco-tortilla and transitivity constraints) runs after every committed flat fold. Its result is stored as `faceOrders`.
- Incremental folds keep the known order where possible. A full re-solve happens only when needed.
- If no valid order exists, the operation is refused.
- The top-k layer selection uses the stack order at the grab point. k counts from the top layer.

## 4. Collision while folding
- While a flap rotates about its crease axis, check its faces against the faces that stay put. Use analytic tests between a rotating polygon and a static polygon, sampled at subdivided angle steps during fast drags.
- On contact, the angle is clamped at the last free angle, and a "blocked" state is reported to the UI.
- Collision checks don't affect committed geometry. Layer order stays the authority.

## 5. Drag → crease
1. **Grab:** the input is a hit face, a paper-space point and the nearest landmark. The engine resolves the top flap at that point.
2. **Drag:** the input is the current cursor projected into paper space. The crease is the perpendicular bisector of the grab point and the target point, clipped to the selected layers.
3. **Snapping**, in priority order:
   1. landmarks (corners, edge midpoints, crease intersections);
   2. points on edges and creases;
   3. with the modifier held, an angle lock to 22.5° increments;
   4. Huzita–Justin axioms (designer phase; available in settings).

   Snap radius is measured in screen pixels and passed in by the UI.
4. **Angle:** the UI passes a normalised drag progress, and the engine maps it to a fold angle in [0, 180]. Pulling past the crease means flat.
5. **Tool modes** reinterpret the same grab and drag:
   - **Reverse:** the drag direction picks inside or outside.
   - **Squash:** the drag opens the flap.
   - **Petal:** the drag lifts the flap.
6. **Output:** a live preview containing:
   - the crease segment(s);
   - the moving face ids;
   - their poses at the current angle;
   - whether the fold is blocked, and whether it's valid.

   Previews are cheap and are never committed until release.

**Numeric input:** the same operations accept exact crease coordinates or an exact angle.

## 6. Public API (shape, not code)
- `createPaper(size)` gives the first frame.
- `preview(frame, gesture)` gives a preview or a refusal.
- `commit(frame, gesture)` gives a new frame and a step, or a refusal.
- `turnOver(frame)`
- `poses(frame, partialAngle?)` gives the 3D transforms for each face.
- `landmarks(frame)` gives the snap candidates.
- `layerAt(frame, point)` gives the faces at a point, ordered top to bottom.

## Tests (Vitest)
- Area is conserved, and edge lengths in paper space are preserved.
- Every committed frame has a valid layer order.
- A point-to-point fold lands the point exactly on its target.
- A crease that misses the paper, or that moves all of the paper, is refused.
- Folding only the top flap moves only the connected flap.
- Reverse, squash and petal folds match fixtures from known bases (waterbomb base, preliminary base, bird base).
- Presets (plane, cup, crane) fold end to end without errors.
- Turning over twice gives back the original layer order.

## Left to the builder
- Caching strategy, epsilon values, and the internals of the face-tree walk.
- How to schedule a layer re-solve (synchronous vs a worker) if it gets slow on large models.
