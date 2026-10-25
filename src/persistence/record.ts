// Recording (spec 05 "Replay and recording"; Plan 3 Task 5): the history
// replay as an animated GIF or a WebM video. Lazy-loaded with the Record
// dialog (R58); gifenc lives only in the GIF worker's chunk.
//
// Capture is deterministic: output frame i shows replay time
// t_i = i × (1000 / fps) / msPerStep (msPerStep = the Player's duration /
// steps), drawn through `viewAt(t_i)` — the Player's pure API — never the wall
// clock, so a slow machine records the same smooth frames as a fast one. The
// Stage renders each frame at the output size (beginCapture / endCapture
// resize its drawing buffer for the capture and put everything back), with
// the user's paper material and the washi desk exactly as on screen.
//
//   GIF:  frames are copied into a 2D canvas, read as RGBA and *transferred*
//         to a module worker (gif.worker.ts → gifEncode.ts) that quantises and
//         encodes each frame as it arrives. At most MAX_IN_FLIGHT frames are
//         unacknowledged, so memory stays bounded on long replays. Abort
//         terminates the worker at once (its buffers die with it) and rejects
//         with an AbortError; nothing is downloaded.
//   WebM: MediaRecorder on a capture stream of the same 2D canvas. With
//         CanvasCaptureMediaStreamTrack.requestFrame the stream is captured at
//         0 fps and each deterministic frame is pushed by hand; otherwise a
//         timed stream at the target fps. MediaRecorder timestamps frames by
//         wall clock, so frames are paced 1000 / fps ms apart: a WebM takes as
//         long to record as the replay lasts (the content of every frame is
//         still exact). Hidden where WebM is unsupported (Safari, Review Focus 4).
//
// The last frame is held for HOLD_MS so a looping GIF (or a video's end)
// rests on the finished model. Progress is monotonic in [0, 1] and ends at 1.
//
// Module boundaries: persistence imports no render or studio code, so the
// Player and the Stage come in through the structural RecordSource /
// RecordStage interfaces (the Record dialog adapts the real ones).

import { GIF_BYTES_PER_PIXEL, GIF_MAX_BYTES, GIF_MAX_FRAMES } from './gifBudget'

export type RecordFormat = 'gif' | 'webm'
export type RecordSize = 480 | 720 | 1080
export type RecordFps = 15 | 30
export type RecordOptions = { format: RecordFormat; size: RecordSize; fps: RecordFps }

export const SIZES: readonly RecordSize[] = [480, 720, 1080]
export const FPS: readonly RecordFps[] = [15, 30]

/** The finished model stays on screen this long at the end. */
export const HOLD_MS = 1000
/** GIF frames sent to the worker and not yet encoded. */
export const MAX_IN_FLIGHT = 3
/** Output aspect is the canvas's, clamped to 2:1 either way. */
const MAX_ASPECT = 2
const WEBM_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
const BITRATE: Record<RecordSize, number> = { 480: 2_500_000, 720: 5_000_000, 1080: 8_000_000 }

/** What the recorder replays: the Player (steps, duration at its speed, the pure viewAt). */
export interface RecordSource<V> {
  readonly steps: number
  /** Whole replay length in ms. */
  readonly duration: number
  viewAt(t: number): V
}

/** What the recorder draws on: the Stage, plus the replay drawer (studio/replay/draw.ts). */
export interface RecordStage<V> {
  /** The live canvas's width / height (the recording keeps it). */
  readonly aspect: number
  /** Render subsequent captures at width × height px, centred, until endCapture. */
  beginCapture(width: number, height: number): void
  draw(view: V): void
  /** Render now and return the canvas holding the frame (read it before yielding). */
  captureFrame(): CanvasImageSource
  /** Put the live view back exactly as it was. */
  endCapture(): void
}

/** The 2D canvas frames are copied into (GIF pixels; WebM capture stream). */
export interface Surface {
  draw(src: CanvasImageSource): void
  pixels(width: number, height: number): ArrayBuffer
  captureStream(fps: number): MediaStream
}

/** Main thread → GIF worker. `sample`: a few frames' RGBA, back to back, for one global palette. */
export type GifRequest =
  | { type: 'start'; width: number; height: number; sample?: ArrayBuffer }
  | { type: 'frame'; index: number; delay: number; rgba: ArrayBuffer }
  | { type: 'finish' }

/** GIF worker → main thread. */
export type GifReply =
  | { type: 'encoded'; index: number }
  /** The encoder's stream buffer itself (transferred, not sliced): the GIF is its first `length` bytes. */
  | { type: 'done'; gif: ArrayBuffer; length: number }
  | { type: 'error'; message: string }

export type GifWorkerLike = {
  onmessage: ((e: MessageEvent) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  onmessageerror: ((e: MessageEvent) => void) | null
  postMessage(msg: GifRequest, transfer?: Transferable[]): void
  terminate(): void
}

/** Injection points (tests; jsdom has no Worker, canvas or MediaRecorder). */
export type RecordDeps = {
  makeWorker?: () => GifWorkerLike
  makeSurface?: (width: number, height: number) => Surface
  MediaRecorder?: typeof MediaRecorder
  /** Resolve after ms; reject with an AbortError if `signal` aborts. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
  /** Page visibility (WebM): defaults to `document`. */
  visibility?: Visibility
}

export type Visibility = { isHidden(): boolean; onChange(cb: () => void): () => void }

const documentVisibility: Visibility = {
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  onChange: cb => {
    document.addEventListener('visibilitychange', cb)
    return () => document.removeEventListener('visibilitychange', cb)
  },
}

/**
 * WebM recording needs the tab visible: hidden tabs throttle timers to ≥ 1 s,
 * which would stretch the video (MediaRecorder timestamps by wall clock). A
 * recording that starts hidden, or is hidden midway, stops with this error.
 */
export class RecordHiddenError extends Error {
  constructor() {
    super('Keep this tab visible while recording video.')
    this.name = 'RecordHiddenError'
  }
}

// ---- GIF budget -------------------------------------------------------------
// A GIF of a long replay at 1080p / 30 fps can run to hundreds of MB, and the
// encoder's growing stream plus the transfer and the Blob can hold 2-3x that
// at the peak. The estimate (gifBudget.ts: 0.1 B/px/frame, about 2x the 0.04-0.06
// measured on real 1080p washi/kami GIFs) refuses combinations over the cap
// (the dialog disables Record and says why; record() throws), and the worker
// aborts a recording whose real stream passes 1.5x the cap.

export { GIF_BYTES_PER_PIXEL, GIF_MAX_BYTES, GIF_MAX_FRAMES, GIF_ABORT_BYTES } from './gifBudget'

export type GifEstimate = {
  frames: number
  width: number
  height: number
  bytes: number
  ok: boolean
  reason: 'frames' | 'bytes' | null
}

export function gifEstimate(
  src: Pick<RecordSource<unknown>, 'steps' | 'duration'>,
  { size, fps }: { size: RecordSize; fps: RecordFps },
  aspect: number,
): GifEstimate {
  const frames = frameTimes(src, fps).length
  const { width, height } = outputSize(size, aspect)
  const bytes = width * height * frames * GIF_BYTES_PER_PIXEL
  const reason = frames > GIF_MAX_FRAMES ? 'frames' : bytes > GIF_MAX_BYTES ? 'bytes' : null
  return { frames, width, height, bytes, ok: reason === null, reason }
}

type MR = { isTypeSupported(type: string): boolean } | undefined

const recorderClass = (): MR => (globalThis as { MediaRecorder?: MR }).MediaRecorder

/** The WebM type to record, or null. */
export function webmType(Recorder: MR = recorderClass()): string | null {
  if (typeof Recorder === 'undefined' || !Recorder || typeof Recorder.isTypeSupported !== 'function') return null
  if (!Recorder.isTypeSupported('video/webm')) return null
  return WEBM_TYPES.find(t => Recorder.isTypeSupported(t)) ?? null
}

/** WebM is offered only with MediaRecorder WebM support and canvas capture (Review Focus 4). */
export function webmSupported(): boolean {
  const capture = typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
  return capture && webmType() !== null
}

/** The replay times of every output frame: fps apart, from 0 to the last step exactly. */
export function frameTimes(src: Pick<RecordSource<unknown>, 'steps' | 'duration'>, fps: number): number[] {
  if (!(src.steps > 0) || !(src.duration > 0)) return [0]
  const dt = 1000 / fps
  const msPerStep = src.duration / src.steps
  const intervals = Math.max(1, Math.ceil(src.duration / dt - 1e-9))
  const out: number[] = []
  for (let i = 0; i < intervals; i++) out.push(Math.min(src.steps, (i * dt) / msPerStep))
  out.push(src.steps)
  return out
}

/** Output pixels: the short side is the preset, the canvas aspect (clamped) is kept, even sizes (video codecs). */
export function outputSize(size: RecordSize, aspect: number): { width: number; height: number } {
  const a = Math.min(MAX_ASPECT, Math.max(1 / MAX_ASPECT, Number.isFinite(aspect) && aspect > 0 ? aspect : 1))
  const even = (x: number) => 2 * Math.round(x / 2)
  return a >= 1 ? { width: even(size * a), height: size } : { width: size, height: even(size / a) }
}

export const abortError = (): DOMException => new DOMException('The recording was cancelled.', 'AbortError')

/**
 * Record `player`'s replay on `stage` as a GIF or WebM blob. Rejects with an
 * AbortError when `signal` aborts (worker terminated, recorder stopped, nothing
 * returned), or an Error if encoding fails. The Stage is always restored.
 */
export async function record<V>(
  player: RecordSource<V>,
  stage: RecordStage<V>,
  opts: RecordOptions,
  signal: AbortSignal,
  onProgress: (p: number) => void,
  deps: RecordDeps = {},
): Promise<Blob> {
  if (signal.aborted) throw abortError()
  if (opts.format === 'gif') {
    const e = gifEstimate(player, opts, stage.aspect)
    if (!e.ok) throw new RangeError(`A ${e.width}×${e.height} GIF of ${e.frames} frames is over the size budget`)
  }
  const times = frameTimes(player, opts.fps)
  const { width, height } = outputSize(opts.size, stage.aspect)
  let shown = -1
  const progress = (p: number) => {
    const q = Math.min(1, Math.max(0, p))
    if (q > shown) {
      shown = q
      onProgress(q)
    }
  }
  progress(0)
  let capturing = true
  const release = () => {
    if (!capturing) return
    capturing = false
    stage.endCapture()
  }
  stage.beginCapture(width, height)
  try {
    const job: Job = {
      times,
      width,
      height,
      fps: opts.fps,
      dt: 1000 / opts.fps,
      signal,
      progress,
      release,
      shoot: i => {
        stage.draw(player.viewAt(times[i]!))
        return stage.captureFrame()
      },
    }
    const blob = opts.format === 'gif' ? await recordGif(job, deps) : await recordWebm(job, opts.size, deps)
    if (signal.aborted) throw abortError()
    progress(1)
    return blob
  } finally {
    release()
  }
}

type Job = {
  times: number[]
  width: number
  height: number
  fps: RecordFps
  /** Output frame interval, ms. */
  dt: number
  signal: AbortSignal
  progress(p: number): void
  /** End the Stage capture (after the last frame is grabbed). */
  release(): void
  /** Draw and render frame i; returns the source canvas. */
  shoot(i: number): CanvasImageSource
}

// ---- GIF ------------------------------------------------------------------

const defaultGifWorker = (): GifWorkerLike =>
  new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' }) as unknown as GifWorkerLike

function recordGif(job: Job, deps: RecordDeps): Promise<Blob> {
  const { times, width, height, signal } = job
  const surface = (deps.makeSurface ?? canvasSurface)(width, height)
  const worker = (deps.makeWorker ?? defaultGifWorker)()
  const total = times.length
  return new Promise<Blob>((resolve, reject) => {
    let done = false
    let sent = 0
    let encoded = 0
    let wake: (() => void) | null = null
    const end = (err: unknown, blob?: Blob) => {
      if (done) return
      done = true
      signal.removeEventListener('abort', onAbort)
      worker.onmessage = worker.onerror = worker.onmessageerror = null
      worker.terminate() // frees the encoder and any frames still queued in it
      wake?.()
      wake = null
      if (blob) resolve(blob)
      else reject(err)
    }
    const onAbort = () => end(abortError())
    signal.addEventListener('abort', onAbort)
    worker.onmessage = e => {
      const m = e.data as GifReply
      if (m.type === 'encoded') {
        encoded++
        job.progress((0.99 * encoded) / total)
        const w = wake
        wake = null
        w?.()
      } else if (m.type === 'done') end(null, new Blob([new Uint8Array(m.gif, 0, m.length)], { type: 'image/gif' }))
      else end(new Error(`GIF encoder: ${m.message}`))
    }
    worker.onerror = e => {
      e.preventDefault?.()
      end(new Error(`GIF worker failed: ${e.message ?? 'unknown error'}`))
    }
    worker.onmessageerror = () => end(new Error('GIF worker: unreadable message'))

    const pump = async () => {
      // One global palette from the first, middle and last frames: the washi does not shimmer
      // between frames and no frame carries its own colour table.
      const picks = [...new Set([0, Math.floor((total - 1) / 2), total - 1])]
      const px = width * height * 4
      const sample = new Uint8ClampedArray(picks.length * px)
      picks.forEach((i, k) => {
        surface.draw(job.shoot(i))
        sample.set(new Uint8ClampedArray(surface.pixels(width, height)), k * px)
      })
      if (done) return
      worker.postMessage({ type: 'start', width, height, sample: sample.buffer }, [sample.buffer])
      for (let i = 0; i < total; i++) {
        while (!done && sent - encoded >= MAX_IN_FLIGHT) await new Promise<void>(r => (wake = r))
        if (done) return
        surface.draw(job.shoot(i))
        const rgba = surface.pixels(width, height)
        if (i === total - 1) job.release()
        const delay = job.dt + (i === total - 1 ? HOLD_MS : 0)
        worker.postMessage({ type: 'frame', index: i, delay, rgba }, [rgba])
        sent++
      }
      if (!done) worker.postMessage({ type: 'finish' })
    }
    pump().catch(err => end(err instanceof Error ? err : new Error(String(err))))
  })
}

// ---- WebM -----------------------------------------------------------------

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(id)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

async function recordWebm(job: Job, size: RecordSize, deps: RecordDeps): Promise<Blob> {
  const { times, width, height, signal, dt } = job
  const Recorder = deps.MediaRecorder ?? (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder
  const mimeType = webmType(Recorder)
  if (!Recorder || !mimeType) throw new Error('WebM recording is not supported here')
  const visibility = deps.visibility ?? documentVisibility
  if (visibility.isHidden()) throw new RecordHiddenError()
  const wait = deps.wait ?? sleep
  const surface = (deps.makeSurface ?? canvasSurface)(width, height)
  surface.draw(job.shoot(0)) // the stream starts on frame 0, not a blank canvas

  // Manual frames where the browser has requestFrame; a timed stream otherwise.
  let stream = surface.captureStream(0)
  let track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
  const manual = typeof track?.requestFrame === 'function'
  if (!manual) {
    stream.getTracks().forEach(t => t.stop())
    stream = surface.captureStream(job.fps)
    track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
  }

  const chunks: Blob[] = []
  let rec: MediaRecorder | null = null
  let failed: Error | null = null
  const failure = new AbortController()
  const fail = (e: Error) => {
    failed ??= e
    failure.abort()
  }
  // Hidden tabs throttle timers to >= 1 s: stop rather than record a stretched video.
  const unwatch = visibility.onChange(() => {
    if (visibility.isHidden()) fail(new RecordHiddenError())
  })
  const both = AbortSignal.any ? AbortSignal.any([signal, failure.signal]) : signal
  const check = () => {
    if (signal.aborted) throw abortError()
    if (failed) throw failed
  }
  try {
    // Inside the try: a constructor throw (NotSupportedError) still stops the capture tracks.
    const r = (rec = new Recorder(stream, { mimeType, videoBitsPerSecond: BITRATE[size] }))
    r.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    const stopped = new Promise<void>(resolve => {
      r.onstop = () => resolve()
    })
    r.onerror = () => fail(new Error('MediaRecorder failed'))
    r.start()
    const t0 = performance.now()
    for (let i = 0; i < times.length; i++) {
      check()
      if (i > 0) surface.draw(job.shoot(i))
      if (manual) track!.requestFrame()
      if (i === times.length - 1) job.release()
      job.progress((0.99 * (i + 1)) / times.length)
      // Pace by deadline (frame i + 1 is due at (i + 1) × dt), so drawing time does not stretch the video.
      await wait(Math.max(0, t0 + (i + 1) * dt - performance.now()), both)
    }
    await wait(HOLD_MS, both)
    check()
    if (manual) track!.requestFrame() // the held last frame gets a timestamp at the end
    r.stop()
    await stopped
    check()
    return new Blob(chunks, { type: 'video/webm' })
  } catch (err) {
    if (rec && rec.state !== 'inactive') rec.stop() // the partial recording is dropped with `chunks`
    chunks.length = 0
    if (signal.aborted) throw abortError()
    throw failed ?? err
  } finally {
    unwatch()
    stream.getTracks().forEach(t => t.stop())
  }
}

// ---- the 2D surface -------------------------------------------------------

function canvasSurface(width: number, height: number): Surface {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  if (!ctx) throw new Error('No 2D canvas for the recording')
  return {
    draw: src => ctx.drawImage(src, 0, 0, width, height),
    pixels: (w, h) => ctx.getImageData(0, 0, w, h).data.buffer as ArrayBuffer,
    captureStream: fps => canvas.captureStream(fps),
  }
}
