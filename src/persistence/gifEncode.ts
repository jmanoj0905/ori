// The GIF worker's body (gif.worker.ts runs it; tests call it directly):
// gifenc (MIT) quantises each frame to its own 256-colour palette and encodes
// it as it arrives, so the worker holds one frame at a time plus the GIF
// stream. Protocol (record.ts GifRequest / GifReply): start {width, height};
// frame {index, delay ms, rgba} → encoded {index}; finish → done {gif}
// (transferred). Any failure is an error reply, never a throw: the main thread
// rejects and terminates the worker.
//
// GIF delays are whole centiseconds: the delay of each frame is the rounded
// running total minus what was already emitted, so 30 fps (33.3 ms) plays at
// the right overall speed (3, 3, 4 cs …) instead of drifting 10% fast.
import { GIFEncoder, applyPalette, quantize, type Encoder } from 'gifenc'
import type { GifReply, GifRequest } from './record'

export function createGifHandler(post: (m: GifReply, transfer?: Transferable[]) => void): (m: GifRequest) => void {
  let enc: Encoder | null = null
  let width = 0
  let height = 0
  let elapsedMs = 0
  let emittedCs = 0
  return m => {
    try {
      if (m.type === 'start') {
        enc = GIFEncoder()
        width = m.width
        height = m.height
        elapsedMs = 0
        emittedCs = 0
        return
      }
      if (!enc) throw new Error('not started')
      if (m.type === 'frame') {
        const rgba = new Uint8ClampedArray(m.rgba)
        if (rgba.length !== width * height * 4) throw new Error(`frame ${m.index} is not ${width}×${height}`)
        const palette = quantize(rgba, 256, { format: 'rgb565' })
        const index = applyPalette(rgba, palette, 'rgb565')
        elapsedMs += m.delay
        const cs = Math.max(2, Math.round(elapsedMs / 10) - emittedCs) // < 2 cs is slowed to 10 cs by browsers
        emittedCs += cs
        enc.writeFrame(index, width, height, { palette, delay: cs * 10, repeat: 0 })
        post({ type: 'encoded', index: m.index })
        return
      }
      enc.finish()
      const gif = enc.bytes().buffer as ArrayBuffer
      enc = null
      post({ type: 'done', gif }, [gif])
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }
}
