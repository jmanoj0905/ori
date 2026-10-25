// Module worker for the designer (Plan 5 Task 3): Kawasaki / Maekawa checks
// and Fold all, off the main thread. Receives { id, req } and posts back
// { id, result } or { id, error } (see foldAll.ts for the client).
import { handleDesignerRequest, type DesignerReply, type DesignerRequest } from './foldAll'

const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown): void }

scope.onmessage = (e: MessageEvent) => {
  const { id, req } = e.data as { id: number; req: DesignerRequest }
  let reply: DesignerReply
  try {
    reply = { id, result: handleDesignerRequest(req) }
  } catch (err) {
    reply = { id, error: err instanceof Error ? err.message : String(err) }
  }
  scope.postMessage(reply)
}
