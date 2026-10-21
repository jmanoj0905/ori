// Module worker (R33): runs engine commits off the main thread. Receives
// { id, req: { frame, gesture } | { frame, turnOver: true } } and posts back
// { id, result } (the engine's Result, refusals included) or { id, error }
// if the engine threw. Frames are plain FOLD data, so structured clone
// carries them both ways.
import { handleRequest, type WorkerReply, type WorkerRequest } from './committer'

const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown): void }

scope.onmessage = (e: MessageEvent) => {
  const { id, req } = e.data as WorkerRequest
  let reply: WorkerReply
  try {
    reply = { id, result: handleRequest(req) }
  } catch (err) {
    reply = { id, error: err instanceof Error ? err.message : String(err) }
  }
  scope.postMessage(reply)
}
