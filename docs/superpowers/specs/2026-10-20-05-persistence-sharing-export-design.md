# Spec 05: Persistence, sharing and export

- **Phase 1:** autosave and PNG export.
- **Phase 2:** share links, `.fold` and SVG export, replay, and GIF/WebM export.

## Intent
Nothing is ever lost on refresh. Sharing a model is a single link, with no backend. Exported files work in other origami tools.

## Autosave (phase 1)
- Saves the current history (the step records, plus the frame at the cursor) and the paper settings.
- Saved after every commit, undo or redo, debounced. Restored silently on load.
- If the saved data can't be read (corrupt or old version), start a fresh sheet and show a non-blocking toast: "Couldn't restore your last model."
- One autosaved model in v1. A gallery of saved models is out of scope.

## PNG export (phase 1)
- A snapshot of the current view at 2× resolution, with an option for a transparent or washi background.
- File name: `ori-<date>-<step>.png`.

## Share link (phase 2)
- Encodes the paper setup and the **step sequence** (not the geometry), compactly packed and compressed, into the URL hash.
- Opening the link replays the steps through the engine to rebuild the model.
- The codec is versioned. Links from older versions must still decode, or fail with a clear message.
- Soft limit: if a link gets very long (around 4 KB), warn the user and suggest a `.fold` export instead.

## File export (phase 2)
| Format | Contents |
|---|---|
| `.fold` | The current frame, plus the history as FOLD `file_frames` |
| Crease pattern SVG | The unfolded sheet, with M/V lines in Yoshizawa–Randlett dash style, a boundary, and an optional grid |
| PNG | As in phase 1 |

## Replay and recording (phase 2)
- **Replay:** plays the history from step 1 with fold animations. Controls: play/pause, speed, scrub. The camera can be kept or auto-framed.
- **GIF/WebM export:** records the replay from the canvas (MediaRecorder for WebM; a GIF encoder in a worker). Size and frame-rate presets. A progress indicator and a cancel button.
- Recording respects the user's paper material and canvas look.

## Tests
- Autosave round-trip: commit steps, reload, and get an identical history.
- A corrupt save falls back gracefully.
- A share link round-trips (encode → decode gives identical steps), and old-version links decode.
- A `.fold` export loads in Rabbit Ear and gives the same frame.
- The SVG export matches a snapshot.

## Left to the builder
- The compression method and encoding alphabet; the choice of GIF encoder library (must be GPL-compatible).
