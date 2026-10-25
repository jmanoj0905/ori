# Spec 09: Living creases and layer picking

This spec changes how a drag is read on folded paper and how layers are chosen. It amends spec 03 (the fold gesture, the fold bar, touch), spec 04 (bindings, keyboard folding) and spec 02 (crease drawing). The paper cutter is a separate, later spec.

## Intent
Ori should behave like a real sheet. Today, when you fold a flap and try to lift it back, Ori makes a new fold near the old crease instead of opening the flap. That happens because every drag is read as "a new crease on the perpendicular bisector of grab and cursor". An unfold only happens when that bisector lands within 1e-7 of the old crease (`hingePlan`, `src/engine/ops.ts`), which no hand can manage. Choosing layers is also blind: a press takes the top layer, and scrolling or `[` `]` takes more from the top down without showing which layers you are getting.

The goal: a flap you grab pivots on its existing fold, the way paper does. You can see and choose which layers you are taking. Creases you have opened stay visible and can be folded along again.

## Acceptance scenarios
Each must feel effortless with a mouse, with no numeric input or retries:
1. **Open the second of two folds.** Fold a square in half, fold it in half again, then open only the second fold.
2. **Refold reversed.** Fold a corner, unfold it, then refold the same crease the other way (valley ↔ mountain).
3. **Waterbomb from pre-creases.** Fold and unfold both diagonals and both book folds, then collapse the sheet into a waterbomb base along those creases.

## Goals
- Dragging a folded flap swings it on its existing hinge when that is what the drag means, with no precise aim.
- Layers are chosen by seeing the stack, not by counting blind.
- Open creases are visible, and new folds lock onto them.

## Non-goals
- A one-step "crease and open" (pre-crease) tool. Fold, then swing back.
- Remembering a crease's last direction. An open crease is neutral.
- Cutting. That's the next spec.
- Changes to Reverse, Squash and Petal. Their drags keep their current meaning. This spec covers the Fold tool and keyboard folding.

## Anti-goals
- The gesture guessing wrong mid-drag and flickering between meanings.
- The tool belt getting in the way of a quick fold. A press-and-drag must still fold at once.
- Engine logic leaking into the UI (overview anti-goal). Hinge finding stays in `src/engine/`.

## Decisions

### 1. Reading the drag: swing or new fold
When the Fold tool grabs paper, the engine reports the **candidate hinges** for the grabbed layers. These are existing folded creases (non-zero fold angle) that the selected flap hangs on, as `hingePlan` already defines them, but found from the flap rather than from a crease line.

As the cursor moves, the drag is read **live**:
- **Across a candidate hinge → swing** the flap on that hinge, rigidly, toward flat (0°) or onward, exactly as `hingePlan` does today.
- **Otherwise → new fold**, the current bisector behaviour.
- **Several candidate hinges:** the drag direction picks among them.
- **Stickiness (hysteresis):** once a reading is chosen, it holds until the drag clearly favours another, so the preview never flickers.
- **Fold bar:** it shows which reading is live: "Swing on crease" or "New fold".
- **Toward the hinge means swing.** Dragging a folded flap's tip toward or across its hinge looks the same from above whether you mean "unfold it" or "fold this flap in half". Swing wins, so unfolding feels right from the first pixel.
- **Alt override.** Holding a rebindable modifier (`forceNewFold`, default Alt) forces a new fold. It's needed only in that toward-the-hinge case, because every other direction already reads as a new fold. Otherwise the drag alone decides.
- **Hover:** before any press, hovering over a flap softly highlights the layers a press would take and the hinge or hinges they could swing on.
- **Settling open:** a swing released within 10° of flat (0°) settles fully open, leaving the crease flat ('F'). A swing released elsewhere stays at its angle, as any partial fold does, and the partial-fold rule still applies.

### 2. Picking layers: the tool belt
- **Opening it:** press and hold still for about 400 ms on the paper. A small circular tool belt opens at that point. A press that starts moving before then is an ordinary fold of the top layer, as now.
- **What it shows:** only a **side view** (a cross-section) of the paper stack at that point. Layers are drawn top to bottom. Where layers join at a fold, the side view shows the join. No other tools are on the belt.
- **Picking:** keep holding, slide onto a layer in the side view, then drag out onto the paper. It's one continuous gesture. Picking a layer takes **that layer and every layer above it**, which is the gesture's existing `layers = k` (`selectFlap` already takes the top k plus the faces hinged to them).
- **Dismissing:** releasing over the belt without dragging out, or pressing Esc, closes it and does nothing.
- **Removed:** scroll and `[` `]` no longer change layers. The `layersLess` and `layersMore` actions and their bindings are removed, along with the fold-bar layer stepper (− +) and the wheel-means-layers context in the router. The fold bar keeps a read-only layer badge ("2 of 4 layers").
- **Keyboard:** a new rebindable action (`layerPicker`, default `L`) opens the belt at the keyboard-fold cursor once a grab point is set. Up and Down move through the stack, Enter picks, Esc closes. This replaces `[` `]` in keyboard folding (spec 04 §2). The belt announces each layer through the live region ("Layer 2 of 4: top flap and 1 below").
- **Touch:** the same press-and-hold opens the belt.

### 3. Creases
- **Open creases are drawn.** An open crease (assignment 'F', angle 0) is drawn as a faint, thin, solid line. That's distinct from valley (dashed) and mountain (dash-dot), and drawn with the same instanced line mesh in `src/render/creases.ts`. Today 'F' edges aren't drawn at all.
- **No direction memory.** An open crease is neutral, and the next fold along it takes whatever the drag says.
- **Crease line snap.** When a new fold's crease comes close to an existing crease line, it locks onto that line, both angle and position. A "Creases" toggle joins the snap toggles in the Tools island, on by default, and is stored in snap settings. With the line locked, the fold runs exactly along the old crease. On a flat pre-creased sheet, this is how scenario 3 folds along its pre-creases.

## Approaches

**A. The engine finds hinges and the studio reads the drag (chosen; my call, made because you asked me to go straight to the spec).**
- A new engine query, `hingesAt(frame, grab, k, face?)`, returns each candidate hinge: its line, its flap and its current angle.
- `useFoldGesture` reads the drag against those lines with hysteresis. For a swing, it sends the gesture with `crease` set to the hinge line, which `hingePlan` already accepts.
- A new fold goes through the existing path.
- **Trade-off:** the reading policy lives in the studio, which is easy to tune and test, while all geometry stays in the engine. It needs one new engine export.

**B. The engine reads the drag.** `Gesture` gets an `auto` mode, and `plan()` decides between swing and new fold itself.
- This keeps the studio thin.
- **Trade-off:** hysteresis needs the previous reading, so the engine would have to hold gesture state across `preview` calls. That works against its stateless, per-frame-cached design.

**C. Swing as a line snap.** Treat hinge lines as strong crease-line snap targets, so the bisector locks onto the hinge.
- This needs no new concept.
- **Trade-off (why it was dropped):** midway through lifting a flap, the bisector of grab and cursor is nowhere near the hinge, so the snap can't engage until the very end. It fails scenario 1.

## Constraints
- **Engine stays stateless.** Hinge finding is a pure query, cached per frame like `landmarks`. Nothing outside `src/engine/` imports Rabbit Ear.
- **Speed.** The hover highlight and `hingesAt` must keep 60 fps on a 300-face model (overview quality bar). Hover queries are throttled to one per animation frame.
- **Settings migration.** Settings schema `version` goes from 1 to 2. Stored bindings for `layersLess` and `layersMore` are dropped on load, and `layerPicker` and `forceNewFold` get their defaults.
- **Lessons and presets.** They replay recorded gesture params (`layers`, `crease`, …) and check results by frame (`src/lessons/check.ts`). Neither depends on the live drag reading, so they need no change. Lesson hint text that mentions `[` `]` is updated.
- **Accessibility.** Everything the belt does is reachable by keyboard and is announced (spec 04).

## Amends
- **Spec 03 (fold gesture):**
  - step 2 now takes the top layer, or opens the belt on hold;
  - step 3 loses the scroll and `[` `]` bullet and gains the swing/new-fold reading;
  - the fold bar gains the reading label, and its layer badge becomes read-only;
  - touch loses the layer stepper.
- **Spec 04:** the binding table loses `layersLess` and `layersMore` and gains `layerPicker` and the hold-modifier `forceNewFold`. Like `angleSnap`, `forceNewFold` must never block a fold drag. Keyboard folding uses the belt.
- **Spec 02:** open-crease line style.
- **Hint line:** `[ ] layers` becomes `L layers`.

## Left to the builder
- What counts geometrically as "across" a hinge, and the hysteresis margins.
- The exact hold time (about 400 ms) and how far the pointer may drift during the hold and still count as still.
- The crease-line snap tolerance (angle and offset, in screen pixels like the point snap radius).
- The belt's visual design within the studio language: frosted ivory, hairline borders, and drawing the side view as SVG from `layerAt` / `layerRanks`.
- Hover highlight styling.
- Test split: Vitest for `hingesAt` and the reading policy; Playwright for the three acceptance scenarios and the belt.
