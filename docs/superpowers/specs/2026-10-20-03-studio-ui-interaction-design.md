# Spec 03: Studio UI and interaction

Phase 1. This spec covers the controls that surround the paper and how a fold is performed.

## Intent
A minimal "floating studio". The canvas is full bleed, and small frosted control islands sit at the edges. Folding happens on the paper itself, by dragging. The UI only appears when it's needed.

## Layout
| Island | Position | Contents |
|---|---|---|
| Top bar | Top | Wordmark `ori · 折り` · Undo / Redo · Export · Settings ⚙ |
| Tools | Left | Fold (drag) · Reverse · Squash · Petal · Turn over · Snap toggles |
| Steps | Right | Numbered history (click a step to jump to it) · Mini crease-pattern view · Presets |
| Fold bar | Bottom (only while folding) | Valley/Mountain toggle · Angle slider 0–180° · Layer badge "2 of 4 layers" |
| Hint line | Bottom, below the fold bar | One quiet sentence describing what to do next |
| Paper panel | Opens from the top bar or the tools | Material mode (4 choices), colours, size |

The islands are frosted, semi-opaque ivory with hairline borders. They fade back when the cursor is busy folding.

## The fold gesture
1. **Hover over the paper.** The nearest landmark highlights, and the cursor changes to a grab hand.
2. **Press.** This grabs the top flap at that point, and the layer badge appears with k = 1.
3. **Drag.**
   - The crease follows as the perpendicular bisector of the grab point and the cursor.
   - The ghost flap rotates live, and the fold bar appears.
   - Snapping happens as you drag: landmarks always; with the modifier held, the crease locks to 22.5° steps.
   - Scroll, or `[` and `]`, changes how many layers are taken. The badge updates and the preview recomputes.
   - Valley is the default. The `V` and `M` keys, or the fold bar toggle, switch between valley and mountain mid-drag.
4. **Release.** This commits the fold at the current angle. Dragging past the crease gives a flat fold.
   - The flap settles with a short eased animation, about 250 ms, which is skipped with reduced motion.
   - A step is added to the history.
5. **Esc** cancels at any point.
6. **When the engine refuses:** the ghost turns a muted red, and the hint line shows the reason. Nothing is committed.
7. **When the fold is blocked by a collision:** the flap is clamped and tinted, and the hint reads "Flap would pass through paper."

**After release:** the fold bar's angle slider stays available for the last fold, until the next fold is made. This lets the user open a fold partially to see the model in 3D.

### Tool modes
Selecting Reverse, Squash or Petal changes what the drag means:
- **Reverse:** grab a flap that's folded in half and drag it. Dragging into the flap gives an inside reverse fold; dragging around it gives an outside reverse fold.
- **Squash:** grab a flap and drag it down and open. It flattens symmetrically.
- **Petal:** grab the lower point of a flap and lift it.

The hint line explains the active tool in a single sentence. The tool returns to Fold after one use (this is a setting).

### Numeric input
Click the crease readout in the fold bar to type exact values: two points, or a point plus an angle. Esc closes it.

## Steps island
- A numbered list, for example "3 · Valley fold · top flap · 180°". Steps after the cursor are greyed out until redo.
- Clicking a step jumps to it. A new fold after jumping back truncates the redo history, with an undo toast.
- The mini crease-pattern view is an SVG of the unfolded sheet with M/V lines in diagram style. It updates live.
- Presets: Paper plane, Cup, Crane. Choosing one asks whether to replace the current work, then plays the steps with animation. Playback can be stopped.

## Empty state and onboarding
- On first visit the sheet is flat, and the hint reads "Grab a corner and drag it across."
- A single dismissible coach mark points at a corner, then never shows again.
- No modal tour.

## Touch
- Tap and drag on paper performs the fold gesture. Two fingers orbit and pinch to zoom.
- A layer stepper (− and +) replaces scrolling during a touch drag.
- On narrow screens the islands collapse into a bottom sheet.

## Tests (Playwright)
- Drag a corner to fold and check that a step is added.
- Change layers mid-drag; cancel with Esc; refused fold; blocked fold.
- Reverse and squash on a preset base.
- Undo/redo; jump to a step; preset playback.

## Left to the builder
- The tuning of how drag distance maps to angle (to be refined in testing).
- The micro-interaction timing and easing, within the reduced-motion constraints.
