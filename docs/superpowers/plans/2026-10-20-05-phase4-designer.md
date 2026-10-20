# Phase 4: Designer Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A designer mode with:
- a crease pattern editor that has axiom tools and grid snapping;
- live Kawasaki and Maekawa checks;
- crease pattern ↔ 3D sync, including "Fold all";
- `.fold` and `.cp` import and export.

**Architecture:**
- `src/designer/` holds a pure crease pattern model (a FOLD graph with no folding history), editing operations, and flat-foldability checks.
- An SVG editor component handles the 2D view.
- "Fold all" goes through new engine adapter functions (`layerOrders` plus `foldedCoords` over the whole pattern).
- Designer mode is code-split and switched from the top bar.

**Tech Stack:** As before. Rabbit Ear's axioms and its `convert` module (for `.opx`/`.cp`) are reached through `rabbit.ts` only.

**Spec:** `docs/superpowers/specs/2026-10-20-07-designer-tool-design.md`

## Global Constraints
- Axioms: Huzita–Justin **1–7**.
- Grid presets: **8×8, 16×16, 22.5°, custom**.
- Kawasaki: the alternating angle sums at each interior vertex are equal to 180°. Maekawa: **|M − V| = 2**.
- Editing the crease pattern after 3D folding **branches** the history, with a warning; it never rewrites earlier steps.
- Measurements are shown in IBM Plex Mono.
- No Co-Authored-By trailers.

## Review Focus
1. **Near-coincident creases (closer than 1e-6).** They are merged on insert, and no zero-length edges appear. Covered by a test in Task 1.
2. **An import of a `.cp` file with unassigned or flat ('F') lines.** These are kept as unassigned and excluded from the M/V checks. Covered by a test in Task 4.
3. **"Fold all" on a pattern that isn't flat-foldable.** It refuses, lists the first failing vertices, and doesn't hang. A 5-second timeout runs in a worker. Covered by a test in Task 3.
4. **A huge import (5,000 or more creases).** The editor stays responsive. Checks are debounced and run in a worker. Covered by a test in Task 4.
5. **Switching modes with unsaved designer edits.** Edits persist in the autosave under their own key. Covered by a test in Task 2.

---

### Task 1: The crease pattern model and edit operations
**Files:** create `src/designer/cp.ts` and `src/designer/axioms.ts`; tests alongside.
**Interfaces:**
- Produces:
  - `type CP = Frame` (no history)
  - `addCrease(cp, a: Vec2, b: Vec2, assignment: 'M' | 'V' | 'U'): CP` (splits at intersections and merges duplicates within 1e-6)
  - `setAssignment(cp, edge, a)`, `flip(cp, edge)`, `removeCrease(cp, edge)`
  - `axiom(n: 1..7, inputs): Line[]` (adapter around Rabbit Ear's axioms)
  - `snapToGrid(p, grid: GridPreset): Vec2`

- [ ] **Step 1: Write the failing tests.**
  - Two crossing creases make 4 edges and 1 interior vertex.
  - Adding a crease within 1e-6 of an existing one leaves the edge count unchanged.
  - Axiom 1 through two points gives one line through both; axiom 2 gives the perpendicular bisector.
  - The 22.5° grid snaps the direction to the nearest multiple.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(designer): crease pattern model and axioms`.

### Task 2: The editor UI and designer mode
**Files:** create `src/designer/Editor.tsx`, `src/designer/DesignerTools.tsx` and `src/designer/designerSlice.ts`; modify `TopBar.tsx` (the mode switch); tests alongside.

- [ ] **Step 1: Write the failing tests.**
  - Clicking two grid points with the line tool adds a crease.
  - Axiom tools prompt for the right number of inputs.
  - The numeric input sets exact coordinates.
  - Switching to the sandbox and back keeps the edits (autosave key `ori.designer.v1`).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. The SVG uses diagram dashes and a grid overlay.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(designer): crease pattern editor UI`.

### Task 3: Flat-foldability checks and Fold all
**Files:** create `src/designer/checks.ts`, `src/designer/check.worker.ts`, `src/designer/IssuesPanel.tsx` and `src/designer/foldAll.ts`; tests alongside.
**Interfaces:**
- Produces:
  - `kawasaki(cp): number[]` (the failing vertices)
  - `maekawa(cp): number[]`
  - `foldAll(cp, signal): Promise<Result<{ frame: Frame }>>` (timeout 5 s)

- [ ] **Step 1: Write the failing tests.**
  - The waterbomb pattern passes both checks.
  - A single crease ending in the interior fails Maekawa at that vertex.
  - A perturbed 30° angle fails Kawasaki.
  - `foldAll` on the waterbomb and bird base patterns gives a valid layer order.
  - `foldAll` on an invalid pattern gives a refusal listing vertex ids within 5 seconds.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Highlight issues on the vertices, with tooltips.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(designer): flat-foldability checks and fold all`.

### Task 4: Crease pattern ↔ 3D sync, branching, and import/export
**Files:** create `src/designer/sync.ts` and `src/persistence/cpFormats.ts`; modify `src/engine/history.ts` (`branch(h, cp): History`) and `rabbit.ts` (convert wrappers); tests alongside.

- [ ] **Step 1: Write the failing tests.**
  - A 3D fold updates the designer crease pattern.
  - Editing the crease pattern after 3D steps calls `branch`, which keeps the original history accessible and shows a warning.
  - Round-trips of `.fold` and `.cp` keep assignments; 'F' and 'U' lines are kept as unassigned.
  - Importing 5,000 creases: the UI thread is blocked for no more than 50 ms per frame (checks run in the worker).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(designer): CP↔3D sync, branching, .fold/.cp I/O`. Then deploy.
