# Phase 2: Sharing, Export and Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share a model as a URL with no backend; export `.fold` and crease-pattern SVG; replay the history; record GIF/WebM.

**Architecture:**
- `src/persistence/` gains a versioned share codec (encodes steps, not geometry) and exporters.
- Replay is a player over `History` that drives the existing `Stage`.
- Recording captures the canvas stream. GIF encoding runs in a Web Worker.

**Tech Stack:** As in Phase 1, plus `fflate` (MIT) for compression and `gifenc` (MIT) for GIF encoding. Both are GPL-compatible.

**Spec:** `docs/superpowers/specs/2026-10-20-05-persistence-sharing-export-design.md`

## Global Constraints
- The share payload lives in the URL **hash**, prefixed with a version: `#v1:<base64url>`.
- Soft limit: warn when the encoded hash is longer than **4096** characters, and suggest a `.fold` export.
- `.fold` includes the current frame plus `file_frames` for the history.
- The SVG uses Yoshizawa–Randlett dashes: valley `6 4`, mountain `6 3 1.5 3`.
- Recording respects the paper material and the canvas look.
- No Co-Authored-By trailers.

## Review Focus
1. **A link from a newer codec version (`#v9:`).** Show the message `"This link was made with a newer Ori."` and keep the current work. Covered by a test in Task 1.
2. **A truncated or edited hash.** The decode fails gracefully, and the autosaved work is not overwritten. Covered by a test in Task 1.
3. **Opening a share link while autosaved work exists.** Ask before replacing it. Covered by a test in Task 2.
4. **Recording on a browser without MediaRecorder WebM support (Safari).** Fall back to GIF, or hide WebM. Covered by a test in Task 5.
5. **Cancelling GIF encoding midway.** The worker is terminated, with no orphaned memory and no partial download. Covered by a test in Task 5.

---

### Task 1: Share codec
**Files:** create `src/persistence/shareCodec.ts`; test `shareCodec.test.ts`.
**Interfaces:**
- Produces:
  - `encodeShare(paper: PaperSettings, steps: Step[]): string` (the returned string has no leading `#`)
  - `decodeShare(hash: string): Result<{ paper: PaperSettings; steps: Step[] }>`
  - `CODEC_VERSION = 1`
- Steps are packed as compact tuples, with coordinates quantised to 1e-5, and compressed with fflate deflate.

- [ ] **Step 1: Write the failing tests.**
  - The crane preset steps round-trip exactly (within the quantisation).
  - `#v9:...` gives the refusal `"This link was made with a newer Ori."`.
  - Garbage input gives the refusal `"This link is damaged."`.
  - The plane preset encodes to fewer than 600 characters.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(share): versioned share codec`.

### Task 2: Share UI and open-from-link
**Files:** create `src/studio/ShareDialog.tsx` and `src/persistence/openFromHash.ts`; modify `TopBar.tsx`; test `openFromHash.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - On load with a valid hash and no autosave, the steps are replayed through the engine and the history equals the decoded steps.
  - With an autosave present, a confirm dialog appears ("Replace your current model?"). Cancel keeps the autosave.
  - A decode failure shows a toast and leaves the autosave untouched.
  - The Share dialog copies the URL, and shows the 4096-character warning when the URL is over the limit.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(share): share dialog and open-from-link`.

### Task 3: `.fold` and SVG export
**Files:** create `src/persistence/foldExport.ts` and `src/persistence/svgExport.ts`; modify the export menu; tests alongside.

**Interfaces:**
- Produces:
  - `toFoldFile(h: History): string` (JSON with `file_spec: 1.2`, `file_creator: "Ori"` and `file_frames`)
  - `toCreasePatternSvg(f: Frame, opts: { grid?: number; style: 'diagram' | 'mv-color' }): string`

- [ ] **Step 1: Write the failing tests.**
  - A `.fold` file re-imported through the engine adapter's FOLD parse gives the same `faces_vertices` count and `edges_assignment`.
  - The SVG has a boundary path, and valley strokes use `stroke-dasharray="6 4"`.
  - A snapshot test of the plane's crease pattern.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(export): .fold and crease-pattern SVG`.

### Task 4: Replay player
**Files:** create `src/studio/replay/Player.ts` and `src/studio/replay/ReplayBar.tsx`; tests alongside.

**Interfaces:**
- Produces: `class Player` with `play()`, `pause()`, `seek(stepFloat: number)`, `setSpeed(0.5 | 1 | 2)`, `onFrame(cb)`, and `autoFrame: boolean`.

- [ ] **Step 1: Write the failing tests.**
  - `seek(2.5)` shows step 3 at 50% of its angle.
  - Speed 2 halves the duration.
  - Reduced motion steps through frames without tweening.
  - `pause` holds the current frame.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement on top of `Stage.setFrame` and `Stage.setPreview` (a swing for the step in progress).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(replay): history replay player`.

### Task 5: GIF and WebM recording
**Files:** create `src/persistence/record.ts`, `src/persistence/gif.worker.ts` and `src/studio/RecordDialog.tsx`; tests alongside.

**Interfaces:**
- Produces: `record(player: Player, stage: Stage, opts: { format: 'gif' | 'webm'; size: 480 | 720 | 1080; fps: 15 | 30 }, signal: AbortSignal, onProgress: (p: number) => void): Promise<Blob>`

- [ ] **Step 1: Write the failing tests.**
  - Without `MediaRecorder.isTypeSupported('video/webm')`, the WebM option is hidden.
  - An abort terminates the worker and rejects with an `AbortError`, with no download triggered.
  - Progress increases monotonically to 1.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run an e2e test that records a 2-step GIF and checks its size is greater than 0.
- [ ] **Step 5:** Commit with `feat(record): GIF/WebM export of replays`. Then deploy, as in Phase 1, Task 14.
