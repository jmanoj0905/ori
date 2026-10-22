// The GIF worker's body (gif.worker.ts is a thin shell around it): start,
// frames, finish → a real GIF89a, encoded with gifenc.
import { describe, expect, test } from 'vitest'
import { createGifHandler } from './gifEncode'
import type { GifReply } from './record'

function frame(w: number, h: number, rgb: [number, number, number]): ArrayBuffer {
  const a = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < a.length; i += 4) a.set([...rgb, 255], i)
  return a.buffer
}

describe('GIF encoder handler', () => {
  test('encodes frames into an animated GIF89a, acking each frame', () => {
    const out: GifReply[] = []
    const handle = createGifHandler(m => out.push(m))
    handle({ type: 'start', width: 4, height: 3 })
    handle({ type: 'frame', index: 0, delay: 66.7, rgba: frame(4, 3, [245, 240, 230]) })
    handle({ type: 'frame', index: 1, delay: 1066.7, rgba: frame(4, 3, [200, 60, 50]) })
    handle({ type: 'finish' })
    expect(out.slice(0, 2)).toEqual([{ type: 'encoded', index: 0 }, { type: 'encoded', index: 1 }])
    const done = out[2]!
    expect(done.type).toBe('done')
    const d = done as Extract<GifReply, { type: 'done' }>
    expect(d.gif.byteLength).toBeGreaterThanOrEqual(d.length) // the stream buffer itself, no slice copy
    const bytes = new Uint8Array(d.gif, 0, d.length)
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a')
    expect(bytes[6]! | (bytes[7]! << 8)).toBe(4) // logical screen width
    expect(bytes[8]! | (bytes[9]! << 8)).toBe(3)
    expect(bytes.at(-1)).toBe(0x3b) // trailer
    expect(new TextDecoder().decode(bytes)).toContain('NETSCAPE2.0') // loops
  })

  test('a frame of the wrong size, or before start, is an error reply (not a throw)', () => {
    const out: GifReply[] = []
    const handle = createGifHandler(m => out.push(m))
    handle({ type: 'frame', index: 0, delay: 10, rgba: frame(2, 2, [0, 0, 0]) })
    expect(out[0]!.type).toBe('error')
    handle({ type: 'start', width: 4, height: 4 })
    handle({ type: 'frame', index: 0, delay: 10, rgba: frame(2, 2, [0, 0, 0]) })
    expect(out[1]!.type).toBe('error')
  })

  test('a palette sample gives one global palette: no per-frame colour tables, a smaller file', () => {
    const encode = (sample?: ArrayBuffer) => {
      const out: GifReply[] = []
      const handle = createGifHandler(m => out.push(m))
      handle({ type: 'start', width: 8, height: 8, sample })
      const colours: [number, number, number][] = [[245, 240, 230], [200, 60, 50], [47, 74, 138], [245, 240, 230]]
      colours.forEach((c, i) => handle({ type: 'frame', index: i, delay: 70, rgba: frame(8, 8, c) }))
      handle({ type: 'finish' })
      const d = out.at(-1) as Extract<GifReply, { type: 'done' }>
      expect(d.type).toBe('done')
      return new Uint8Array(d.gif, 0, d.length)
    }
    const sample = new Uint8ClampedArray(8 * 8 * 4 * 3)
    sample.set(new Uint8ClampedArray(frame(8, 8, [245, 240, 230])), 0)
    sample.set(new Uint8ClampedArray(frame(8, 8, [200, 60, 50])), 256)
    sample.set(new Uint8ClampedArray(frame(8, 8, [47, 74, 138])), 512)
    const global = encode(sample.buffer)
    const local = encode()
    expect(global.length).toBeLessThan(local.length)
    // Image descriptors (0x2C …, packed byte at +9): no local colour table flag on any frame.
    const packed: number[] = []
    for (let i = 0; i < global.length - 10; i++) {
      if (global[i] === 0x2c && global[i + 1] === 0 && global[i + 2] === 0 && global[i + 3] === 0 && global[i + 4] === 0 && global[i + 5] === 8) packed.push(global[i + 9]!)
    }
    expect(packed).toHaveLength(4)
    expect(packed.every(p => (p & 0x80) === 0)).toBe(true)
  })
})
