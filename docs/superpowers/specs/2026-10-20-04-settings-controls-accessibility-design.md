# Spec 04: Settings, controls and accessibility

Phase 1. The settings menu (⚙ in the top bar).

## Intent
Every input, keyboard **and mouse**, can be remapped. All accessibility options live in one place. Ori must be fully usable without a mouse.

## Settings menu
A side sheet or modal with these sections:

### 1. Controls
- **Remappable actions:**
  - Fold (grab/drag button), orbit, pan, zoom.
  - Layers (fewer/more), the angle-snap modifier.
  - Valley / Mountain, Reverse, Squash, Petal, Turn over.
  - Undo, Redo, Cancel, Top view, Reset view, the shortcut sheet, and opening settings.
- **What can be bound:** a key or chord (with modifiers), a mouse button with or without modifiers, or the scroll wheel with or without modifiers.
- **Conflicts** are detected inline: a clash is shown and you must resolve it before saving.
- Reset a single binding or all of them. Export or import bindings as JSON (optional).

**Default bindings:**

| Action | Default |
|---|---|
| Fold | Left-drag on paper |
| Orbit | Right-drag |
| Pan | Middle-drag |
| Zoom | Scroll |
| Layer picker (keyboard fold) | `L` |
| Force a new fold (hold while dragging; never blocks the drag) | Hold Alt |
| Angle snap | Hold Shift |
| Valley / Mountain | `V` / `M` |
| Reverse / Squash / Petal | `R` / `S` / `P` |
| Turn over | `T` |
| Undo / Redo | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z |
| Cancel | Esc |
| Shortcut sheet | `?` |

### 2. Keyboard folding
This is a complete fold path with no mouse:
1. Press the fold key. The landmark cursor appears.
2. Tab or the arrow keys cycle through landmarks, ordered by proximity in the direction of the arrow. Enter sets the grab point.
3. Cycle through target landmarks the same way. The live preview shows.
4. `L` opens the layer belt at the grab point (spec 09): Up and Down move through the stack, Enter takes that layer and those above it, Esc closes the belt. Each layer is announced ("Layer 2 of 4: top flap and 1 below"). `V` and `M` switch the fold type, and `+` and `-` change the angle in 22.5° steps.
5. Enter commits; Esc cancels.

Tool modes use the same flow.

### 3. Screen-reader step log
- An ARIA live region (polite) announces each committed or refused fold. Example: "Step 4: valley fold, top flap, 2 layers, 180 degrees."
- The steps list is a proper list with labels, and the islands are landmarks. Every control has an accessible name.

### 4. Motion
- Reduced motion follows `prefers-reduced-motion` by default, with an override: Always / Never / System.
- With reduced motion on:
  - fold settling and camera moves are instant or short crossfades;
  - preset playback steps through frames instead of animating.

### 5. Paper defaults
The default material mode, colours and paper size for new sheets.

### 6. Snapping
Turn each landmark type, angle snapping and the axioms on or off. The snap radius is a slider in pixels.

### 7. Behaviour
- Tool returns to Fold after one use (on or off).
- Confirm before replacing work with a preset (on or off).

### 8. About
Version, GPLv3 license, source link, and credits (Rabbit Ear).

## Other accessibility requirements
- WCAG AA contrast for all UI text on the ivory frosted islands.
- A visible focus ring in an ink colour, with logical tab order across the islands.
- No information carried only by colour: valley and mountain creases differ by dash pattern, not colour alone.

## Persistence
All settings are saved locally and applied on load. Versioned migrations are used when the format changes.

## Tests
- Remapping a binding takes effect immediately; conflicts are blocked; reset works.
- A complete keyboard-only fold from an empty sheet (Playwright).
- The live region announces each fold. Reduced motion skips animations.
- An axe accessibility scan passes on the studio and on the settings screen.

## Left to the builder
- The layout of the settings screen, and how bindings are captured ("press a key or mouse button…").
