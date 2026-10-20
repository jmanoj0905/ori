# Phase 1b: Studio (Rendering, UI, Settings, Autosave) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v1 sandbox. It's the floating studio on ivory washi: drag-to-fold with live preview, four paper materials, diagram creases, remappable controls, keyboard folding, autosave and PNG export, all deployed to Cloudflare Pages.

**Architecture:**
- `src/render/` owns a single imperative `Stage` class that wraps Three.js. React never touches Three objects.
- `src/studio/` is the React UI. One store, `useStudio` (Zustand), holds the History, the gesture, the tool, the paper material and the UI state. It calls the engine and pushes frames to the `Stage`.
- `src/settings/` holds bindings and accessibility preferences, persisted locally.
- `src/input/` turns raw pointer and keyboard events into binding actions, through the settings.

**Tech Stack:** React 19, Three.js, Zustand, Vitest + Testing Library, Playwright + @axe-core/playwright, Wrangler (Cloudflare Pages).

**Spec:** `docs/superpowers/specs/2026-10-20-02-rendering-visual-design.md`, `-03-studio-ui-interaction-design.md`, `-04-settings-controls-accessibility-design.md`, and `-05-persistence-sharing-export-design.md` (Phase 1 parts only).

## Global Constraints
- Consumes the engine only through `@engine` (Plan 1, Task 9 API). Never import `rabbit-ear`.
- Ivory canvas base: `#F4EFE6` (a design token; may be tuned in the design pass).
- Kami swatches: vermilion, indigo, matcha, ochre, sumi, plus a custom picker. The back of kami paper is white.
- Valley crease = dashed `┄┄`; mountain crease = dash-dot `┄·┄`. Dash length stays constant in screen space.
- The settle animation takes about 250 ms; with reduced motion it is instant.
- Performance: **60 fps while dragging a fold on a 300-face model**; main bundle **< 300 KB gzip**.
- Hint copy on first visit: `"Grab a corner and drag it across."`
- Blocked-fold hint: `"Flap would pass through paper."`
- Autosave failure toast: `"Couldn't restore your last model."`
- PNG file name: `ori-<YYYY-MM-DD>-<step>.png`, rendered at 2×.
- Default bindings exactly as in the table in spec 04.
- Wordmark: `ori · 折り`. Typefaces: Instrument Serif (display), IBM Plex Sans (UI), IBM Plex Mono (numbers).
- WCAG AA contrast for all UI text. Valley and mountain creases are never distinguished by colour alone.
- Commits have no Co-Authored-By trailer.

## Review Focus
1. **The window is resized, or the device pixel ratio changes, mid-drag.** Picking must stay accurate and the gesture must not desync. Covered by a test in Task 4.
2. **The pointer leaves the canvas or window mid-drag (pointercancel or blur).** The gesture is cancelled cleanly as if Esc were pressed, with no stuck preview. Covered by a test in Task 6.
3. **localStorage is full or blocked (private mode).** Autosave fails silently, with one toast; the app still works. Covered by a test in Task 11.
4. **The user remaps Fold to right-drag while Orbit is still bound to right-drag.** A conflict is shown and the save is blocked. Covered by a test in Task 5.
5. **A preset is chosen mid-gesture, or while another preset is playing.** The gesture is cancelled, the confirm dialog shows, and the previous playback stops. Covered by a test in Task 9.

---

### Task 1: Design tokens, fonts and the app shell

**Files:**
- Create: `src/studio/tokens.css`, `src/studio/App.tsx`, `src/studio/store.ts`
- Modify: `index.html` (Google Fonts link, title `Ori · 折り`), `src/main.tsx`
- Test: `src/studio/store.test.ts`

**Interfaces:**
- Produces: `useStudio`, a Zustand store with this state:
  - `history: History`, `tool: Tool`, `kind: FoldKind`, `gesture: Gesture | null`
  - `preview: Preview | null`, `refusal: string | null`
  - `paper: PaperSettings`, `hint: string`
- And these actions:
  - `begin(grab: Vec2)`, `drag(target: Vec2, progress: number)`, `setLayers(k: number)`, `setKind(k)`
  - `release()`, `cancel()`
  - `undo()`, `redo()`, `jumpTo(i)`, `turnOver()`
  - `setTool(t)`, `setPaper(p)`, `newSheet(size)`
- `type PaperSettings = { mode: 'kami' | 'washi' | 'plain' | 'custom'; front: string; back: string; pattern?: 'seigaiha' | 'asanoha'; thickness: number; translucency: number; size: 'square' | 'a4' | { width: number; height: number } }`

- [ ] **Step 1: Write the failing tests.**
  - The initial hint is `"Grab a corner and drag it across."`.
  - `begin` → `drag` → `release` on a fresh square adds 1 step.
  - `cancel` mid-drag leaves the history unchanged and sets `preview` to null.
  - A refused drag sets `refusal` to the engine's reason, and `release` does not commit it.
  - `undo` and `redo` work through the store.
- [ ] **Step 2:** Run `npx vitest run src/studio/store.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the store over the `@engine` API. Define CSS tokens: `--ivory: #F4EFE6`, ink, accent, frost, the swatch hexes (the design pass settles them; start with vermilion `#D9472B`, indigo `#2F4A8A`, matcha `#7A9A57`, ochre `#C9962B`, sumi `#2B2A28`), and the font stacks.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(studio): app shell, tokens, studio store`.

---

### Task 2: The Stage — scene, studio light, washi canvas and camera

**Files:**
- Create: `src/render/Stage.ts`, `src/render/washi.ts`, `src/render/camera.ts`
- Test: `src/render/camera.test.ts`

**Interfaces:**
- Produces: `class Stage`, with these members:
  - `constructor(host: HTMLElement)`
  - `setFrame(frame: Frame, poses: FacePose[])`, `setPreview(p: Preview | null)`
  - `setPaper(s: PaperSettings)`, `pick(clientX, clientY): { face: number; paper: Vec2; folded: Vec2 } | null`
  - `projectToPaperPlane(clientX, clientY): Vec2`
  - `view('top' | 'reset', animate: boolean)`, `snapshot(scale: 2, transparent: boolean): Promise<Blob>`
  - `dispose()`
- `camera.ts` exports `frameBounds(bounds, fovDeg, aspect): { distance: number }`.

- [ ] **Step 1: Write the failing tests** (pure camera maths).
  - `frameBounds` fits a 1×1 sheet at fov 35 with a 15% margin.
  - The top view's direction is (0, 0, −1).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - **Washi canvas:** a large plane with a procedural fibre-noise ShaderMaterial on the ivory base, plus a vignette. The same plane receives shadows (shadow catcher).
  - **Light:** a soft directional key light (PCFSoft shadows, map size 2048 desktop / 1024 low-end) plus a hemisphere fill. Matte paper.
  - **Camera:** a perspective camera at a slight tilt.
  - Render only on demand (when something is dirty).
- [ ] **Step 4:** Run the tests. Expected: PASS. Manual check with `npm run dev`: the ivory canvas shows a faint fibre texture.
- [ ] **Step 5:** Commit with `feat(render): stage, studio light, washi canvas, camera`.

---

### Task 3: Paper mesh, the four materials and diagram creases

**Files:**
- Create: `src/render/paperMesh.ts`, `src/render/materials.ts`, `src/render/creases.ts`
- Test: `src/render/paperMesh.test.ts`, `src/render/creases.test.ts`

**Interfaces:**
- Produces:
  - `buildPaperGeometry(frame: Frame, poses: FacePose[], layerGap = 0.0015): BufferGeometry`. UVs are in paper coordinates. Each face is offset along its normal by `layerGap × layerIndex`.
  - `makeMaterials(s: PaperSettings): { front: Material; back: Material }`. Front-side and back-side materials; washi patterns are generated on a canvas.
  - `buildCreaseLines(frame, poses): { valley: LineSegments; mountain: LineSegments }`. The dash pattern is encoded in a screen-space shader.
  - `DASH = { valley: [6, 4], mountain: [6, 3, 1.5, 3] }` (px).

- [ ] **Step 1: Write the failing tests.**
  - The UV of every vertex equals its paper coordinate divided by the paper size.
  - A face at layer 2 sits higher than a face at layer 0 along the normal (by 2 × 0.0015).
  - `buildCreaseLines` on a valley fold has 1 valley segment and 0 mountain segments.
  - The two dash patterns differ.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Paper uses `polygonOffset`; crease shading darkens slightly along hinges based on the dihedral angle.
  - **Preview:** the ghost flap is translucent and in the accent colour; when blocked, it gets a warm-red tint.
- [ ] **Step 4:** Run the tests. Expected: PASS. Manual check: valley and mountain creases are visibly different.
- [ ] **Step 5:** Commit with `feat(render): paper mesh, four materials, diagram creases`.

---

### Task 4: Picking and the drag → gesture bridge

**Files:**
- Create: `src/studio/useFoldGesture.ts`
- Modify: `src/render/Stage.ts`
- Test: `src/studio/useFoldGesture.test.ts`

**Interfaces:**
- Consumes: `Stage.pick`, `Stage.projectToPaperPlane`, the store actions, `snapPoint`, `landmarks`.
- Produces:
  - `dragProgress(grab: Vec2, crease: Line, cursor: Vec2): number`. 0 at the grab point; 1 when the cursor reaches the grab point's mirror across the crease.
  - The hook `useFoldGesture(stage)`.

- [ ] **Step 1: Write the failing tests.**
  - `dragProgress` is 0 at the grab point, 0.5 at the crease, and 1 at the mirror point.
  - The snap radius is 12 px converted to paper units through the current zoom.
  - After a simulated resize mid-drag, the next pick maps to the same paper point. (Review Focus 1)
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. `pick` raycasts against the paper mesh; layer selection is left to the engine. The hook calls `begin`, `drag` and `release` on the store.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(studio): picking and drag gesture bridge`.

---

### Task 5: Settings model, bindings and conflict detection

**Files:**
- Create: `src/settings/schema.ts`, `src/settings/bindings.ts`, `src/settings/store.ts`
- Test: `src/settings/bindings.test.ts`

**Interfaces:**
- Produces:
  - `type Action = 'fold' | 'orbit' | 'pan' | 'zoom' | 'layersLess' | 'layersMore' | 'angleSnap' | 'valley' | 'mountain' | 'reverse' | 'squash' | 'petal' | 'turnOver' | 'undo' | 'redo' | 'cancel' | 'topView' | 'resetView' | 'shortcuts' | 'settings'`
  - `type Binding = { type: 'key'; code: string; mods: Mods } | { type: 'mouse'; button: 0 | 1 | 2; mods: Mods } | { type: 'wheel'; mods: Mods }`
  - `DEFAULT_BINDINGS: Record<Action, Binding[]>`, copied from the spec 04 table.
  - `findConflicts(b: Record<Action, Binding[]>): [Action, Action][]`
  - `useSettings`, holding `bindings`, `reducedMotion: 'system' | 'always' | 'never'`, `snap: {...}`, `snapRadiusPx: 12`, `toolReturnsToFold: true`, `confirmPresetReplace: true`, `paperDefaults`, `version: 1`
  - `migrate(raw: unknown): Settings`

- [ ] **Step 1: Write the failing tests.**
  - Defaults have no conflicts.
  - Binding fold to right mouse while orbit is on right mouse gives a conflict between `fold` and `orbit`. (Review Focus 4)
  - `angleSnap` (Shift held) does not conflict with `[` (modifier-only bindings are a separate class).
  - `migrate(undefined)` returns the defaults, and `migrate` of a v0 object returns v1.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, persisting to localStorage key `ori.settings`, wrapped in try/catch.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(settings): bindings, conflicts, persisted prefs`.

---

### Task 6: Input router (pointer, keyboard, wheel → actions)

**Files:**
- Create: `src/input/router.ts`
- Modify: `src/studio/useFoldGesture.ts`, `src/render/Stage.ts` (orbit, pan and zoom driven by actions instead of OrbitControls' defaults)
- Test: `src/input/router.test.ts`

**Interfaces:**
- Produces: `createRouter(el: HTMLElement, getBindings: () => Bindings, handlers: Partial<Record<Action, (e: ActionEvent) => void>>): () => void`, where `ActionEvent = { phase: 'start' | 'move' | 'end' | 'tap'; clientX?: number; clientY?: number; delta?: number }`.

- [ ] **Step 1: Write the failing tests** (synthetic events).
  - Left-drag emits `fold` start, move, end.
  - Wheel while folding emits `layersMore` or `layersLess`; wheel otherwise emits `zoom`.
  - `V` emits `valley`; Ctrl+Z emits `undo`; Ctrl+Shift+Z emits `redo`.
  - `pointercancel` or window `blur` mid-fold emits `cancel`. (Review Focus 2)
  - Remapped bindings take effect without re-creating the router.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(input): binding-driven input router`.

---

### Task 7: Islands — top bar, tools, fold bar, hint line, paper panel

**Files:**
- Create: `src/studio/islands/TopBar.tsx`, `Tools.tsx`, `FoldBar.tsx`, `HintLine.tsx`, `PaperPanel.tsx`, `src/studio/islands/islands.css`
- Test: `src/studio/islands/islands.test.tsx`

**Interfaces:**
- Consumes: `useStudio`, `useSettings`, `Stage.view`.
- Produces: none (UI leaves).

- [ ] **Step 1: Write the failing tests** (Testing Library).
  - The fold bar renders only while `gesture` is set (or for the last fold until the next fold starts), and shows "2 of 4 layers".
  - The angle slider has range 0–180.
  - Choosing a tool sets `tool`; after one commit it returns to `fold` when `toolReturnsToFold` is on.
  - The paper panel offers exactly 4 modes, with 5 kami swatches plus a custom option.
  - The hint shows `refusal` text when it is set.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the frosted ivory islands with hairline borders. They fade to 40% opacity while a gesture is active. Numeric input opens from the crease readout in the fold bar.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(studio): floating islands and paper panel`.

---

### Task 8: Settle animation and reduced motion

**Files:**
- Create: `src/studio/motion.ts`
- Modify: `src/studio/store.ts` (release animates `angleDeg` to its committed value)
- Test: `src/studio/motion.test.ts`

**Interfaces:**
- Produces: `prefersReducedMotion(setting: 'system' | 'always' | 'never'): boolean`, and `tween(from, to, ms, onFrame, reduced): Promise<void>`, which jumps straight to `to` when `reduced` is true.

- [ ] **Step 1: Write the failing tests.**
  - `tween` with `reduced` set calls `onFrame(to)` exactly once.
  - The settle duration is 250 ms.
  - `'system'` reads `matchMedia('(prefers-reduced-motion: reduce)')`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, and use the same tween for the camera views.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(studio): settle animation with reduced motion`.

---

### Task 9: Steps island, mini crease-pattern view and preset playback

**Files:**
- Create: `src/studio/islands/Steps.tsx`, `src/studio/islands/MiniCP.tsx`, `src/studio/presetPlayer.ts`
- Test: `src/studio/islands/steps.test.tsx`, `src/studio/presetPlayer.test.ts`

**Interfaces:**
- Consumes: `PRESETS` and `runPreset` (Plan 1, Task 10).
- Produces: `playPreset(id, { onStep, signal: AbortSignal }): Promise<void>`

- [ ] **Step 1: Write the failing tests.**
  - Steps are listed as "3 · Valley fold · top flap · 180°"; steps after the cursor have `aria-disabled`.
  - Clicking a step calls `jumpTo`.
  - MiniCP renders valley creases with `stroke-dasharray` "6 4" and mountain creases with "6 3 1.5 3".
  - Choosing a preset with work present and `confirmPresetReplace` on shows a confirm dialog.
  - Choosing a preset mid-gesture cancels the gesture first; starting a new preset aborts the running one. (Review Focus 5)
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(studio): step list, mini crease pattern, preset playback`.

---

### Task 10: Keyboard folding, screen-reader log, settings screen and shortcut sheet

**Files:**
- Create: `src/studio/keyboardFold.ts`, `src/studio/LiveLog.tsx`, `src/settings/SettingsSheet.tsx`, `src/studio/ShortcutSheet.tsx`
- Test: `src/studio/keyboardFold.test.ts`, `src/settings/settingsSheet.test.tsx`

**Interfaces:**
- Produces:
  - `nextLandmark(ls: Landmark[], from: Vec2 | null, dir: 'tab' | 'up' | 'down' | 'left' | 'right'): Landmark`. The nearest landmark in a ±45° cone in the given direction; Tab follows reading order.
  - `announce(text: string)`, writing to a polite live region.

- [ ] **Step 1: Write the failing tests.**
  - `nextLandmark` from the bottom-left corner going right gives the bottom midpoint.
  - The keyboard flow: fold key → Enter on grab → arrows → Enter on target. This commits a step; `+` and `-` change the angle in 22.5° steps.
  - The live log reads `"Step 1: valley fold, top flap, 1 layer, 180 degrees."` after a commit, and announces refusals too.
  - The settings sheet:
    - captures a new binding;
    - shows conflicts and disables Save;
    - "Reset all" restores the defaults;
    - the Motion option offers System / Always / Never;
    - the About section shows GPLv3 and the source link `https://github.com/jmanoj0905/ori`.
  - `?` opens the shortcut sheet, which lists the current (remapped) bindings.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. The focus ring is in the ink colour, and the islands are ARIA landmarks.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(a11y): keyboard folding, live log, settings sheet, shortcuts`.

---

### Task 11: Autosave and PNG export

**Files:**
- Create: `src/persistence/autosave.ts`, `src/persistence/png.ts`
- Test: `src/persistence/autosave.test.ts`

**Interfaces:**
- Produces:
  - `saveHistory(h: History): void` (debounced 500 ms, key `ori.autosave.v1`)
  - `loadHistory(): History | null`
  - `exportPng(stage: Stage, step: number, transparent: boolean): Promise<void>`
  - `pngName(date: Date, step: number): string`

- [ ] **Step 1: Write the failing tests.**
  - Save then load round-trips the step list and the cursor.
  - Corrupt JSON gives `null`, and the store shows `"Couldn't restore your last model."` once.
  - When `setItem` throws (quota or private mode), nothing crashes and the toast shows once per session. (Review Focus 3)
  - `pngName(new Date('2026-10-20'), 4)` equals `"ori-2026-10-20-4.png"`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Store steps and paper settings, and rebuild by replaying the steps through the engine on load.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(persistence): autosave and PNG export`.

---

### Task 12: Touch and narrow layout

**Files:**
- Modify: `src/input/router.ts`, `src/studio/islands/islands.css`, `src/studio/islands/FoldBar.tsx` (layer stepper)
- Test: `src/input/touch.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - One-finger drag on the paper emits `fold`.
  - Two-finger drag emits `orbit`; pinch emits `zoom`.
  - The fold bar shows − and + layer buttons on coarse pointers.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Below 720 px wide, the islands collapse into a bottom sheet.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(input): touch gestures and narrow layout`.

---

### Task 13: End-to-end, accessibility, visual and performance gates

**Files:**
- Create: `playwright.config.ts`, `e2e/fold.spec.ts`, `e2e/keyboard.spec.ts`, `e2e/a11y.spec.ts`, `e2e/visual.spec.ts`, `e2e/perf.spec.ts`
- Modify: `package.json` (script `e2e`)

- [ ] **Step 1: Write the specs.**
  - `fold`: drag the top-right corner to the bottom-left corner, and the step list shows 1 step. Also cover: Esc cancel, a refused crease off the paper, a reverse and a squash on the cup preset's base, undo/redo, and jump to a step.
  - `keyboard`: complete a fold from a blank sheet with no mouse events.
  - `a11y`: an axe scan of the studio and the open settings sheet shows 0 serious or critical violations.
  - `visual`: screenshot baselines for the blank sheet, a half fold, the finished plane, a preview, and a blocked preview.
  - `perf`: load the crane preset (300+ faces), simulate a 2-second drag, and measure frame times through `requestAnimationFrame`; the p95 must be ≤ 16.7 ms on the CI runner.
- [ ] **Step 2:** Run `npx playwright install chromium && npm run e2e`. Expected: all pass after the baselines are recorded once with `--update-snapshots`.
- [ ] **Step 3:** Run the bundle check: `npm run build`, then gzip size of `dist/assets/index-*.js` must be < 300 KB. Code-split the settings sheet if needed.
- [ ] **Step 4:** Commit with `test: e2e, a11y, visual and perf gates`.

---

### Task 14: Deploy to Cloudflare Pages

**Files:**
- Create: `wrangler.toml` (with `pages_build_output_dir = "dist"`), `public/_headers` (long cache for `/assets/*`)
- Modify: `README.md` (what Ori is, the license, how to run it)

- [ ] **Step 1:** Load the `wrangler` skill. Run `npx wrangler pages project create ori --production-branch main`, and confirm with the user before creating the project.
- [ ] **Step 2:** Run `npm run build && npx wrangler pages deploy dist --project-name ori`. Expected: a `*.pages.dev` URL that loads the studio.
- [ ] **Step 3:** Smoke test the deployed URL with Playwright against the `fold.spec.ts` happy path.
- [ ] **Step 4:** Commit with `chore: Cloudflare Pages deploy config`. Push the branch and open a PR to `main` (with no co-author trailer in the commits or the PR body).
