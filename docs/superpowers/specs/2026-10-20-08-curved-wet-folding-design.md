# Spec 08: Curved and wet folding (XPBD)

Phase 5. This was scheduled for the future during planning; it is specified here so the earlier phases don't block it.

## Intent
Let the paper bend smoothly, not just crease: curved-crease designs, soft wet-folded shapes, and paper that sags and springs a little when you handle it. The exact FOLD frames remain the source of truth whenever the model is flat-folded. The physics layer is how the paper looks and feels, not what it is.

## Approach
- An XPBD (extended position-based dynamics) sheet solver on WebGPU, with a CPU fallback (or the feature simply turned off) on browsers without WebGPU.
- The sheet is remeshed from the current FOLD frame into particles and triangles, refined along creases and curved creases.
- **Constraints:**
  - distance (no stretching);
  - bending (paper stiffness; lower when "wet");
  - dihedral crease constraints with a target angle and stiffness;
  - pins for the grabbed point.
- **Self-collision** uses vertex–triangle and edge–edge tests with spatial hashing, as a visual effect. Known weakness: stacks of more than about 10 layers. Those regions fall back to the rigid layer-order rendering.

## User features
1. **Curved crease tool** (designer and sandbox): draw a curved crease, then fold along it. The surface bends into a developable curve.
2. **Wet folding mode:** a toggle that lowers bending stiffness and softens creases. Shapes are sculpted by dragging and hold their form when you let go ("dry").
3. **Physical handling:** an optional "soft paper" feel in the sandbox, where flaps settle with a little give.

## Hand-off between rigid and soft
- Entering soft mode builds a mesh from the current frame.
- **Leaving soft mode:**
  - if the shape is still flat-foldable, snap back to an exact frame;
  - otherwise keep it as a "sculpted" step, which stores the mesh snapshot in the history and is excluded from the layer solver.
- Share links and `.fold` exports include sculpted steps as mesh snapshots (or warn that they can't be shared, if they're too large).

## Performance
- Target: 60 fps on about 5,000 particles on a mid-range GPU. Quality degrades gracefully: fewer iterations, a coarser mesh.

## Tests
- Solver stability: no explosion over 10,000 steps on reference shapes.
- A flat model goes into soft mode and back with no geometric drift.
- A curved crease produces a developable surface (Gaussian curvature close to 0) within a tolerance.

## Open questions (to settle when Phase 5 starts)
- The UX for drawing curved creases, and how "drying" a wet fold is represented.
- Whether sculpted steps are allowed in lessons.

## Left to the builder
- Solver iteration counts, the graph-colouring strategy, the remeshing algorithm, and the WebGPU vs fallback detail.
