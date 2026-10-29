# Spec 02: Rendering and visual design

Phase 1. This spec covers how Ori looks: the canvas, the paper, the creases, the light and the camera.

## Intent
The paper is the hero. The scene should read like a sheet of real origami paper on an ivory washi desk under soft studio light: calm, warm and precise. Nothing on screen competes with the sheet.

## Canvas: subtle ivory washi
- A warm ivory base, around #F4EFE6 (the exact token is settled in the design pass).
- Faint procedural kozo-fibre noise: long, thin, low-contrast strands. It must stay subtle at any zoom level.
- A soft vignette toward the edges.
- The canvas also acts as a shadow catcher, receiving a soft contact shadow from the paper.

## Paper materials
These are user-selectable (see spec 03 for the panel):

1. **Kami, two-tone** (the default):
   - A coloured front and a white back.
   - Swatches: vermilion, indigo, matcha, ochre, sumi, plus a custom colour picker.
2. **Washi, patterned:**
   - A fibrous texture.
   - A printed pattern on the front: seigaiha or asanoha.
3. **Plain white:** a technical-drawing feel.
4. **Full material editor:** colour, texture, pattern, thickness and translucency.

**Rules:**
- Textures are mapped in **paper coordinates**, so patterns stay fixed to the sheet through every fold.
- The front and back come from separate front-face and back-face materials, so a mirrored face automatically shows the other side.
- Thickness is visual only: a tiny offset between layers plus edge shading. It never changes the geometry.
- Translucency (editor mode) lets light through slightly at thin layers. It's optional and can be cut if it costs too much.

## Creases
They follow the Yoshizawa–Randlett diagram convention:
- **Valley:** dashed `┄┄`.
- **Mountain:** dash-dot `┄·┄`.
- **Open crease** (spec 09; assignment F, or a valley/mountain at 0°): a faint, thin, solid line, never dashed.

**How they're drawn:**
- On the paper's surface, in a soft ink colour, with a dash length that stays constant in screen space.
- Together with a subtle physical crease shadow: slight shading along the hinge, taken from the dihedral angle.

**Preview states:**
| State | Look |
|---|---|
| Live crease (while dragging) | Accent colour; dash style matches the fold type |
| Ghost flap | Translucent preview of the moving flap at its current angle |
| Blocked | A gentle warm-red tint on the flap where it is clamped |

## Light
- Soft studio light: one soft-shadow directional key light, plus a hemisphere light for fill.
- The contact shadow on the washi canvas should make layer thickness and lifted flaps easy to read.
- No harsh specular highlights. Paper is matte.

## Layer rendering
- Each layer is offset by a tiny amount along the face normal (epsilon × layer index), with polygon offset, so stacks never z-fight.
- Geometry is rebuilt only when the frame changes. During a drag, only the moving flap's transforms are updated.

## Camera
- Perspective, starting from a slightly tilted front view.
- Orbit, zoom and pan bindings come from settings (spec 04). Defaults: right-drag orbit and scroll zoom. While a fold drag is active, scroll changes the layer count instead.
- "Top view" and "Reset view" buttons, with smooth transitions. Transitions are instant when reduced motion is on.
- Picking works from any angle, because it raycasts against the paper faces.

## Typography and identity
- Wordmark: `ori · 折り`, set in an editorial serif.
- UI text: a quiet sans. Measurements and coordinates: mono.
- Kanji appear only as small accents: the wordmark, and optionally the step numerals.
- The specific typefaces are chosen in the design pass. Candidates are Instrument Serif and IBM Plex Sans/Mono.

## Performance
- 60 fps while dragging a fold on a 300-face model on a mid-range laptop.
- Shadow map resolution adapts to the device. Antialiasing is on.

## Tests
- Playwright screenshot baselines: an empty sheet, a half fold, a paper plane, and blocked and preview states.

## Left to the builder
- The shader approach for the washi noise (texture vs procedural), and how the dashed creases are drawn (instanced quads, a line material, or a texture).
- The exact colour tokens, until the design pass settles them.
