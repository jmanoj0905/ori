# Spec 06: Guided lessons

Phase 3.

## Intent
Teach real origami by having the learner fold, not watch. Each step shows what to do, the learner does it with the normal drag gesture, and Ori checks the result. Help comes gradually instead of giving the answer away.

## Lesson format
A lesson is data, not code. It contains:
- its title, difficulty, paper size and a suggested material;
- an ordered list of steps.

Each step has:
- a **caption**, for example "Fold the top corner down to the bottom corner";
- the **expected tool** (fold, reverse, squash, petal or turn over);
- the **target frame**, a FOLD frame after the step;
- **hint text**;
- an optional **camera framing**.

Lessons are authored by recording a sequence in the sandbox, exporting it to lesson data, and adding captions by hand.

## Follow-along flow
1. The step caption appears, with a translucent **ghost** of the target fold: the crease in diagram dashes and the flap's end position.
2. The learner folds with the normal gesture. The preview behaves the same as in the sandbox.
3. **On release, the result is checked against the target frame:**
   - crease graph equivalence within a tolerance (canonicalised, so order and minor numeric drift don't matter);
   - layer order equivalence for the affected region.
4. **If it matches:** a quiet success (a soft ink check, with an optional sound), and the next step.
5. **If it doesn't match:** the fold is undone automatically, with a gentle message.
   - After **2 misses**, the hint text appears and the target landmarks pulse.
   - **"Show me"** is always available; it autoplays the step and then lets the learner try again.
6. The learner can skip a step. Skipped steps are marked in the summary.

## Launch lessons
Paper plane, cup, crane, jumping frog, and the waterbomb base.

## UI
- In lesson mode, the steps island turns into a lesson outline: done, current and upcoming.
- The other studio tools stay available but are dimmed. The expected tool is highlighted.
- At the end, a summary shows steps done, steps skipped and time taken, with "Fold it again" and "Free fold from here".

## Accessibility
- Captions and hints are announced in the live region.
- Lessons can be completed fully with keyboard folding (spec 04).

## Tests
- The check accepts equivalent folds (different grab point, same result) and rejects wrong ones.
- The hint appears after 2 misses; "Show me" plays the step; skipping works.
- Every launch lesson can be completed by replaying its own targets.

## Left to the builder
- The canonicalisation algorithm and the tolerance values.
- The lesson authoring tooling (a dev-only export button is enough).
