// The GIF worker's body (gif.worker.ts runs it; tests call it directly):
// gifenc (MIT) quantises each frame to its own 256-colour palette and encodes
// it as it arrives, so the worker holds one frame at a time plus the GIF
// stream. Protocol (record.ts GifRequest / GifReply): start {width, height};
// frame {index, delay ms, rgba} → encoded {index}; finish → done {gif, length}
// (the stream's own buffer, transferred — no slice copy; the main thread wraps
// the first `length` bytes). Any failure is an error reply, never a throw: the
// main thread rejects and terminates the worker.
//
// Palette: `start` carries a sample (first, middle and last frames). One
// global 256-colour palette is quantised from it and used for every frame, so
// the washi does not shimmer and no frame carries its own colour table. With
// no sample, or if quantising it fails, each frame gets its own palette.
//
// GIF delays are whole centiseconds: the delay of each frame is the rounded
// running total minus what was already emitted, so 30 fps (33.3 ms) plays at
// the right overall speed (3, 3, 4 cs …) instead of drifting 10% fast.
import { GIFEncoder, applyPalette, quantize, type Encoder, type Palette } from 'gifenc'
import { GIF_ABORT_BYTES } from './gifBudget'
import type { GifReply, GifRequest } from './record'

/**
 * `abortBytes`: the estimate is only an estimate, so after each frame the real
 * stream is checked and the recording fails (error reply, encoder dropped) once
 * it passes this (default 1.5x the GIF cap).
 */
export function createGifHandler(post: (m: GifReply, transfer?: Transferable[]) => void, abortBytes = GIF_ABORT_BYTES): (m: GifRequest) => void {
  let enc: Encoder | null = null
  let width = 0
  let height = 0
  let elapsedMs = 0
  let emittedCs = 0
  let global: Palette | null = null
  let written = 0
  return m => {
    try {
      if (m.type === 'start') {
        enc = GIFEncoder()
        width = m.width
        height = m.height
        elapsedMs = 0
        emittedCs = 0
        written = 0
        global = null
        if (m.sample) {
          try {
            global = quantize(new Uint8ClampedArray(m.sample), 256, { format: 'rgb565' })
          } catch {
            global = null // per-frame palettes instead
          }
        }
        return
      }
      if (!enc) throw new Error('not started')
      if (m.type === 'frame') {
        const rgba = new Uint8ClampedArray(m.rgba)
        if (rgba.length !== width * height * 4) throw new Error(`frame ${m.index} is not ${width}×${height}`)
        const palette = global ?? quantize(rgba, 256, { format: 'rgb565' })
        const index = applyPalette(rgba, palette, 'rgb565')
        elapsedMs += m.delay
        const cs = Math.max(2, Math.round(elapsedMs / 10) - emittedCs) // < 2 cs is slowed to 10 cs by browsers
        emittedCs += cs
        // With a global palette only the first frame passes it (it becomes the global colour table).
        enc.writeFrame(index, width, height, { palette: global && written > 0 ? undefined : palette, delay: cs * 10, repeat: 0 })
        written++
        if (enc.bytesView().byteLength > abortBytes) {
          enc = null
          throw new Error('This GIF grew too large to keep. Try a smaller size or a lower frame rate.')
        }
        post({ type: 'encoded', index: m.index })
        return
      }
      enc.finish()
      const view = enc.bytesView()
      const gif = view.buffer as ArrayBuffer
      enc = null
      post({ type: 'done', gif, length: view.byteLength }, [gif])
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }
}
