// Module worker (Plan 3 Task 5): encodes a replay recording as a GIF off the
// main thread. A thin shell around gifEncode.ts; record.ts starts it, sends
// frames (transferred ArrayBuffers) and terminates it when done or cancelled.
import { createGifHandler } from './gifEncode'
import type { GifRequest } from './record'

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage(m: unknown, transfer?: Transferable[]): void
}

const handle = createGifHandler((m, transfer) => scope.postMessage(m, transfer ?? []))
scope.onmessage = (e: MessageEvent) => handle(e.data as GifRequest)
