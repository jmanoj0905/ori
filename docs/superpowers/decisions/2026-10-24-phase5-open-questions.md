# Phase 5 open questions (spec 08): decisions

Date: 2026-10-24. Plan: `docs/superpowers/plans/2026-10-20-06-phase5-curved.md` ("Settle before Task 3").
The user asked for the simplest option for each open question in spec 08, with sculpted steps kept out of lessons.

## 1. How curved creases are drawn

**Decision: a three-click Curve tool in the designer.** Click the start, a control point and the end; the
crease is a quadratic Bézier, stored in the crease pattern as a polyline of short straight creases
(`src/soft/curvedCrease.ts`, `CURVE_SEGMENTS` segments) with the chosen assignment.

- No new crease type: the FOLD frame, the checks, export, share links and the remesher all see ordinary
  straight edges, so nothing downstream changes.
- Rigid (exact) folding of a curved crease is not meaningful; it folds in soft mode, where the remesher
  refines along the polyline and the solver bends the sheet into a developable surface.
- Not chosen: freehand drawing, cubic curves with handles, editing a curve after it is placed (delete and
  redraw instead).

## 2. How a wet fold "dries"

**Decision: it dries on release.** With Wet on, bending stiffness and crease stiffness are lowered while you
drag. When you let go, the current shape becomes the rest shape (every bending and crease hinge takes its
current angle as its rest angle), so the sculpt holds its form. There is no drying timer, animation or
separate Dry button.

- Turning Wet off keeps the dried rest shape; the sheet is simply stiff again.
- Not chosen: time-based drying, a moisture field, a visual damp-paper material.

## 3. Sculpted steps in lessons

**Decision: not allowed.** Lessons stay made of exact, checkable rigid steps (spec 06 compares canonical
frames, which a mesh snapshot has no equivalent of).

- `lessonSkeleton` (dev export) refuses a history containing a sculpted (or designer pattern) step.
- Soft mode is unavailable while a lesson runs: the toggle is disabled with a tooltip saying why.

## Related builder choices (spec 08 "Left to the builder")

- **Rendering:** WebGPU is used for the solver's compute only. The soft mesh is drawn by the existing
  three.js WebGL Stage from the solver's positions (read back each frame), instead of switching the Stage
  to `WebGPURenderer`. This keeps one renderer, one material set and the screenshot baselines, and keeps a
  second three.js build out of the bundle.
- **Self-collision** runs on the CPU (spatial hash, vertex–triangle) for both solvers, as a visual effect
  only; regions with more than 10 stacked layers are skipped and drawn with the rigid layer order.
- **Fallback:** without WebGPU, soft mode is hidden (spec 08). The CPU solver is the test oracle and the
  fallback after a device loss (at reduced resolution).
