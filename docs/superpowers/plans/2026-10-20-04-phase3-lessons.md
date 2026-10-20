# Phase 3: Guided Lessons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Follow-along lessons. A ghost of the target fold is shown, the learner folds with the normal gesture, and the engine checks the result. A hint appears after 2 misses, and "Show me" is always available.

**Architecture:**
- Lessons are JSON data in `src/lessons/data/`.
- A pure `checkStep()` compares the learner's frame with the target frame after canonicalising both.
- Lesson mode is a state slice in the studio store. It reuses the Stage's ghost preview to show the target.
- The lesson bundle is code-split.

**Tech Stack:** As in Phases 1–2.

**Spec:** `docs/superpowers/specs/2026-10-20-06-guided-lessons-design.md`

## Global Constraints
- A hint appears after exactly **2** misses.
- A wrong fold is undone automatically, with a gentle message. "Show me" autoplays the step and then lets the learner retry.
- Launch lessons: **paper plane, cup, crane, jumping frog, waterbomb base**.
- Captions and hints are announced in the live region. Lessons can be completed fully by keyboard.
- No Co-Authored-By trailers.

## Review Focus
1. **The learner makes a correct fold, but with a different grab point or the mirror-image side,** where the lesson allows symmetry. It must be accepted. Covered by a test in Task 1.
2. **The learner jumps back in the steps list while in a lesson.** The lesson rewinds to that step, rather than desyncing. Covered by a test in Task 3.
3. **The learner changes material or turns the model over mid-lesson.** Turning over is allowed when it's the expected step and otherwise needs a confirm; changing material never breaks the check. Covered by a test in Task 3.
4. **A lesson JSON file fails validation.** The lesson is hidden from the menu with a console error, and the app doesn't crash. Covered by a test in Task 2.
5. **Reduced motion is on.** "Show me" steps without tweening. Covered by a test in Task 3.

---

### Task 1: Canonicalisation and checkStep
**Files:** create `src/lessons/check.ts`; test `check.test.ts`.
**Interfaces:**
- Produces:
  - `canonical(f: Frame, tol = 1e-4): CanonicalFrame`. Sorted, quantised creases (with assignment) plus face orders keyed by geometry.
  - `checkStep(actual: Frame, target: Frame, opts: { allowMirror: boolean }): { match: boolean; reason?: 'creases' | 'layers' }`

- [ ] **Step 1: Write the failing tests.**
  - The same fold from two different grab points matches.
  - A valley fold in place of the target's mountain fold gives `match: false` with reason `'creases'`.
  - The correct creases with the wrong layer order give reason `'layers'`.
  - A mirrored fold with `allowMirror` matches; without it, it doesn't.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(lessons): canonical frame comparison`.

### Task 2: The lesson format and authoring
**Files:** create `src/lessons/schema.ts`, `src/lessons/data/*.json` (5 lessons) and `src/lessons/devExport.ts` (dev only: export the current history as a lesson skeleton); test `schema.test.ts`.
**Interfaces:**
- Produces: `type Lesson = { id; title; difficulty: 1 | 2 | 3; paper: PaperSettings['size']; material?: Partial<PaperSettings>; steps: LessonStep[] }` and `type LessonStep = { caption; tool: Tool | 'turnOver'; target: Frame; hint; camera?: 'top' | 'reset'; allowMirror?: boolean }`, plus `loadLessons(): Lesson[]` (invalid lessons are filtered out with `console.error`).

- [ ] **Step 1: Write the failing tests.**
  - All 5 launch lessons validate.
  - Replaying each lesson's own targets passes `checkStep` at every step.
  - A lesson with a missing `target` is filtered out.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Author the lessons by playing them in the sandbox and running `devExport`, then add captions by hand.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(lessons): lesson schema and five launch lessons`.

### Task 3: Lesson mode — flow, ghost, hints and Show me
**Files:** create `src/lessons/lessonSlice.ts`, `src/lessons/LessonOutline.tsx` and `src/lessons/LessonSummary.tsx`; modify `store.ts`, `Steps.tsx`, `Tools.tsx` and `Stage.ts` (target ghost); tests alongside.
**Interfaces:**
- Produces store actions: `startLesson(id)`, `submitFold()` (called from `release`), `showMe()`, `skipStep()`, `exitLesson()`. Store state: `lesson: { id; index; misses; skipped: number[]; startedAt } | null`.

- [ ] **Step 1: Write the failing tests.**
  - A wrong fold auto-undoes and increments `misses`; on the 2nd miss the hint is visible.
  - A correct fold moves to the next step and announces the next caption.
  - `showMe` plays the target and keeps the index; with reduced motion there is no tween.
  - `skipStep` records the skip.
  - Jumping back in the outline rewinds the index.
  - The expected tool is highlighted and the others are dimmed.
  - The summary shows done, skipped and time, with the buttons "Fold it again" and "Free fold from here".
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, plus an e2e test that completes the cup lesson by keyboard. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(lessons): follow-along lesson mode`. Then deploy.
