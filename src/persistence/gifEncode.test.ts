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
    const bytes = new Uint8Array((done as Extract<GifReply, { type: 'done' }>).gif)
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
})
