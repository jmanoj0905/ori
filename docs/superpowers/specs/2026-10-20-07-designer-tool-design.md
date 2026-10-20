# Spec 07: Designer tool

Phase 4.

## Intent
Serve people who design origami: draw a crease pattern precisely, check whether it can fold flat, see it folded in 3D, and move between the crease-pattern view and the 3D view freely. It should interoperate with existing tools (Oripa, Oriedita, Rabbit Ear).

## Features

### 1. Crease pattern editor
- A 2D canvas of the unfolded sheet, alongside the 3D view or as a tab.
- **Draw creases:**
  - by clicking points, with snapping to a grid, existing vertices, intersections and midpoints;
  - with the Huzita–Justin axioms as tools (axioms 1–7).
- Assign each crease M, V or unassigned, and flip assignments. Delete, split and merge creases.
- Grid presets: 8×8, 16×16, 22.5° and custom.
- Precise numeric input for every point and angle. Measurements are shown in mono type.

### 2. Flat-foldability checks
- Live checks of Kawasaki's theorem (alternating angle sums) and Maekawa's theorem (|M − V| = 2) at every interior vertex.
- Violations are highlighted on the vertex with an explanation tooltip, and a list shows all problems.
- Global layer-order feasibility is checked when the user asks for it (it can be expensive), using the layer solver.

### 3. Crease pattern ↔ 3D sync
- **From 3D to the crease pattern:** folding in the 3D view updates the crease pattern live (this already exists from Phase 1's mini view, here at full size).
- **From the crease pattern to 3D:** "Fold all" collapses the whole pattern into its flat-folded state via the layer solver, and shows it in 3D.
  - An optional "folding progress" slider animates every crease from 0 to its target angle.
  - A Ghassaei-style whole-pattern simulation is optional. Its code is MIT licensed, so it's compatible with GPL.
- **Editing the crease pattern after folding in 3D** branches the history (with a warning) rather than rewriting earlier steps.

### 4. Import and export
- Import `.fold` (including `file_frames`) and `.cp` (Oripa/Oriedita).
- Export `.fold`, `.cp` and SVG (diagram dashes or the M/V colour convention).

## UI
- A separate Designer mode, chosen with a switch in the top bar, sharing the same washi look.
- A tools island for the axioms, grid and assignment; an issues panel for flat-foldability problems.

## Tests
- Kawasaki and Maekawa checks against known valid and invalid fixtures.
- Import/export round-trip for `.fold` and `.cp`.
- "Fold all" on classic patterns (the waterbomb, the bird base) produces a valid layer order.
- Axiom tools produce the expected creases.

## Left to the builder
- Whether the editor is SVG or canvas.
- How undo is shared between designer edits and fold steps.
