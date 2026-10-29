# Ori · 折り: Overview and cross-cutting design

Read this first. It explains the product, the decisions that apply to every part, and how the other specs fit together.

## Intent
Ori is a browser origami studio. You fold digital paper in 3D by dragging it, the way you'd fold a real sheet. It should feel calm, tactile and exact: a sheet of kami under soft studio light on an ivory washi desk.

It serves three audiences, in phases:
1. people playing (a freeform sandbox);
2. people learning (guided lessons);
3. people designing origami (crease-pattern tools).

The project is also a portfolio piece, so craft and polish matter as much as features.

## Goals
- Folding by dragging feels like real paper: grab a corner, pull it across, and the crease follows your hand.
- The geometry is exact. Folded states are mathematically correct, and layers never visibly pass through each other once a fold settles.
- It supports real origami vocabulary: valley and mountain folds at any angle, inside and outside reverse folds, squash folds and petal folds. Curved and wet folding come later.
- One model (FOLD frames) drives everything: history, undo, autosave, share links, lessons, designer sync and export.
- It is accessible and every control can be remapped.

## Non-goals
- No backend, accounts or cloud storage. Everything lives in the browser and in the URL.
- No mobile-first design. Touch works, but desktop is the target.
- No dark theme in v1.
- No multiplayer or collaborative folding.

## Anti-goals (these would make it a failure even if it technically works)
- A cluttered "CAD tool" look that buries the paper under chrome.
- Folds that look wrong: z-fighting, flaps passing through each other, or layers in the wrong order.
- A drag gesture that fights the user, so that people fall back to menus.
- Engine logic leaking into the UI so badly that Rabbit Ear can't be swapped out later.

## Fixed decisions (apply to every spec)
| Area | Decision |
|---|---|
| Name | **Ori** (折り). Japanese accents are used sparingly as ornament |
| Stack | Vite + React + TypeScript + Three.js; WebGPU later, only for XPBD |
| Fold library | Rabbit Ear (pinned version), isolated behind the engine boundary |
| License | **GPLv3**, because Rabbit Ear is GPLv3. LICENSE and source link are shown in the UI |
| Data model | FOLD format, with history kept as immutable frames |
| Hosting | Cloudflare Pages |
| Repo | github.com/jmanoj0905/ori (public). Specs and plans tracked in `docs/superpowers/`; `PLAN.md` stays local |
| Devices | Desktop first, touch supported |
| Theme | Light only (ivory washi) in v1 |
| Testing | Vitest for engine invariants; Playwright for gesture flows and screenshot baselines |

## Spec map
| # | Spec | Phase |
|---|---|---|
| 01 | Folding engine: model, operations, layers, collision, drag inference | 1 |
| 02 | Rendering and visual design: canvas, paper, creases, light, camera | 1 |
| 03 | Studio UI and interaction: islands, tools, fold bar, steps | 1 |
| 04 | Settings, controls and accessibility | 1 |
| 05 | Persistence, sharing and export | 1 (autosave, PNG); 2 (the rest) |
| 06 | Guided lessons | 3 |
| 07 | Designer tool | 4 |
| 08 | Curved and wet folding (XPBD) | 5 |
| 09 | Living creases and layer picking | 6 |

## Phases
1. **Sandbox:** specs 01–04, plus autosave and PNG export from 05, plus three presets (plane, cup, crane).
2. **Sharing:** the rest of spec 05.
3. **Lessons:** spec 06.
4. **Designer:** spec 07.
5. **Curved folding:** spec 08.

Each phase ships on its own to Cloudflare Pages.

## Module boundaries
| Folder | Owns | May depend on |
|---|---|---|
| `src/engine/` | FOLD frames, fold ops, layers, collision, snapping, drag→crease | Rabbit Ear only |
| `src/render/` | The Three.js scene | engine types (read-only) |
| `src/studio/` | React UI | engine API, render API, settings |
| `src/settings/` | Bindings, accessibility, prefs | nothing domain-specific |
| `src/persistence/` | Autosave, share codec, exporters | engine types |
| `src/presets/`, `src/lessons/`, `src/designer/` | Feature data and UI | engine, render, studio |

Rule: nothing outside `src/engine/` imports Rabbit Ear.

## Quality bar
- 60 fps while dragging a fold on a 300-face model on a mid-range laptop.
- First load under 300 KB of gzipped JS for the main bundle. Lessons and the designer are code-split.
- Every engine operation is covered by invariant tests (see spec 01).

## Left to the builder
- The internal API shapes, the state management library (if any), and the file naming within modules.
- Choosing between IndexedDB and localStorage for each piece of stored data.
