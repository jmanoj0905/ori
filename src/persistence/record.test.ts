// @vitest-environment jsdom
// Recording (spec 05 "Replay and recording"; Plan 3 Task 5, Review Focus 4 / 5).
// The recorder drives a fake Stage and a fake GIF worker / MediaRecorder: no
// GPU, no Worker, no codec in jsdom, but the whole protocol runs.
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  GIF_BYTES_PER_PIXEL,
  GIF_MAX_BYTES,
  GIF_MAX_FRAMES,
  HOLD_MS,
  RecordHiddenError,
  frameTimes,
  gifEstimate,
  outputSize,
  record,
  webmSupported,
  type GifReply,
  type GifRequest,
  type RecordDeps,
  type RecordSource,
  type RecordStage,
  type Surface,
} from './record'

afterEach(() => {
  vi.unstubAllGlobals()
})

type View = { t: number }

/** A 2-step replay, 800 ms per step at speed 1 (the Player's STEP_MS). */
const source = (steps = 2): RecordSource<View> => ({ steps, duration: steps * 800, viewAt: t => ({ t }) })

function fakeStage() {
  const log: string[] = []
  const drawn: number[] = []
  const stage: RecordStage<View> = {
    aspect: 1280 / 800,
    beginCapture: (w, h) => log.push(`begin ${w}x${h}`),
    draw: v => drawn.push(v.t),
    captureFrame: () => ({}) as CanvasImageSource,
    endCapture: () => log.push('end'),
  }
  return { stage, log, drawn }
}

function fakeSurface(): Surface & { buffers: ArrayBuffer[] } {
  const buffers: ArrayBuffer[] = []
  return {
    buffers,
    draw: () => {},
    pixels: (w, h) => {
      const b = new ArrayBuffer(w * h * 4)
      buffers.push(b)
      return b
    },
    captureStream: () => {
      throw new Error('not in the GIF path')
    },
  }
}

/** A fake GIF worker: records requests; `auto` acks each frame and answers finish with a tiny GIF. */
function fakeWorker({ auto = true, failAt = -1 }: { auto?: boolean; failAt?: number } = {}) {
  const sent: GifRequest[] = []
  const w = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    onmessageerror: null as ((e: MessageEvent) => void) | null,
    terminated: false,
    terminate: vi.fn(() => {
      w.terminated = true
    }),
    reply(m: GifReply) {
      if (!w.terminated) w.onmessage?.({ data: m } as MessageEvent)
    },
    postMessage(m: GifRequest, _transfer?: Transferable[]) {
      if (w.terminated) throw new Error('posted to a terminated worker')
      sent.push(m)
      if (!auto) return
      queueMicrotask(() => {
        if (m.type === 'frame') {
          if (m.index === failAt) w.reply({ type: 'error', message: 'boom' })
          else w.reply({ type: 'encoded', index: m.index })
        }
        if (m.type === 'finish') {
          // The worker posts its whole stream buffer (no slice) and the used length.
          const gif = new ArrayBuffer(64)
          new Uint8Array(gif).set(new TextEncoder().encode('GIF89a;'))
          w.reply({ type: 'done', gif, length: 7 })
        }
      })
    },
  }
  return { w, sent }
}

const gifDeps = (worker: ReturnType<typeof fakeWorker>['w'], surface = fakeSurface()): RecordDeps => ({
  makeWorker: () => worker,
  makeSurface: () => surface,
})

describe('frame timing', () => {
  test('frames sit on exact replay times, fps apart, ending on the last step', () => {
    const ts = frameTimes(source(2), 15)
    // 1.6 s at 15 fps: 24 intervals → 25 frames, t = i × (1000 / 15) / 800.
    expect(ts).toHaveLength(25)
    expect(ts[0]).toBe(0)
    expect(ts[1]).toBeCloseTo(1000 / 15 / 800, 12)
    expect(ts.at(-1)).toBe(2)
    for (let i = 1; i < ts.length; i++) expect(ts[i]!).toBeGreaterThan(ts[i - 1]!)
  })

  test('an empty replay is one frame', () => {
    expect(frameTimes(source(0), 30)).toEqual([0])
  })

  test('output size: the short side is the preset, the canvas aspect is kept, even pixels', () => {
    expect(outputSize(480, 1280 / 800)).toEqual({ width: 768, height: 480 })
    expect(outputSize(1080, 16 / 9)).toEqual({ width: 1920, height: 1080 })
    expect(outputSize(720, 0.5)).toEqual({ width: 720, height: 1440 })
    // Extreme windows are clamped to 2:1 either way.
    expect(outputSize(480, 5)).toEqual({ width: 960, height: 480 })
  })
})

describe('WebM support (Review Focus 4)', () => {
  test('no MediaRecorder (Safari < 14.1): unsupported', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    expect(webmSupported()).toBe(false)
  })

  test('MediaRecorder without WebM (Safari): unsupported', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (t: string) => t.startsWith('video/mp4') })
    expect(webmSupported()).toBe(false)
  })

  test('MediaRecorder with WebM and canvas capture: supported', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (t: string) => t.startsWith('video/webm') })
    HTMLCanvasElement.prototype.captureStream ??= (() => {}) as never
    expect(webmSupported()).toBe(true)
  })
})

describe('record GIF', () => {
  test('draws every frame deterministically, reports monotonic progress to 1, resolves a GIF', async () => {
    const { w, sent } = fakeWorker()
    const { stage, log, drawn } = fakeStage()
    const progress: number[] = []
    const blob = await record(source(2), stage, { format: 'gif', size: 480, fps: 15 }, new AbortController().signal, p => progress.push(p), gifDeps(w))
    expect(blob.type).toBe('image/gif')
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toBe('GIF89a;')
    // The palette sample (first, middle, last), then every frame in order.
    const ts = frameTimes(source(2), 15)
    expect(drawn).toEqual([ts[0], ts[12], ts[24], ...ts])
    expect(log).toEqual(['begin 768x480', 'end'])
    // Protocol: start (with the transferred palette sample), one frame per time (last one held), finish.
    const start = sent[0] as Extract<GifRequest, { type: 'start' }>
    expect(start).toMatchObject({ type: 'start', width: 768, height: 480 })
    expect(start.sample!.byteLength).toBe(3 * 768 * 480 * 4)
    const frames = sent.filter(m => m.type === 'frame')
    expect(frames).toHaveLength(25)
    expect(frames[0]!.delay).toBeCloseTo(1000 / 15, 6)
    expect(frames.at(-1)!.delay).toBeCloseTo(1000 / 15 + HOLD_MS, 6)
    expect(sent.at(-1)).toEqual({ type: 'finish' })
    // Monotonic, within [0, 1], ending at exactly 1.
    expect(progress.length).toBeGreaterThan(2)
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThan(progress[i - 1]!)
    expect(Math.min(...progress)).toBeGreaterThanOrEqual(0)
    expect(progress.at(-1)).toBe(1)
    expect(w.terminate).toHaveBeenCalled() // the worker is freed after the GIF too
  })

  test('frames are transferred, not copied', async () => {
    const { w } = fakeWorker()
    const post = vi.spyOn(w, 'postMessage')
    await record(source(1), fakeStage().stage, { format: 'gif', size: 480, fps: 15 }, new AbortController().signal, () => {}, gifDeps(w))
    const call = post.mock.calls.find(([m]) => m.type === 'frame')!
    expect(call[1]).toEqual([(call[0] as Extract<GifRequest, { type: 'frame' }>).rgba])
    const start = post.mock.calls.find(([m]) => m.type === 'start')!
    expect(start[1]).toEqual([(start[0] as Extract<GifRequest, { type: 'start' }>).sample])
  })

  test('cancel midway terminates the worker and rejects with AbortError (Review Focus 5)', async () => {
    const { w, sent } = fakeWorker({ auto: false })
    const { stage, log } = fakeStage()
    const ctl = new AbortController()
    const progress: number[] = []
    const run = record(source(2), stage, { format: 'gif', size: 480, fps: 15 }, ctl.signal, p => progress.push(p), gifDeps(w))
    // Let the recorder fill its in-flight window, ack one frame, then cancel.
    await vi.waitFor(() => expect(sent.filter(m => m.type === 'frame').length).toBeGreaterThan(0))
    w.reply({ type: 'encoded', index: 0 })
    await vi.waitFor(() => expect(progress.length).toBeGreaterThan(0))
    const posted = sent.length
    ctl.abort()
    const err = await run.then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(DOMException)
    expect((err as DOMException).name).toBe('AbortError')
    expect(w.terminate).toHaveBeenCalledTimes(1)
    expect(log.at(-1)).toBe('end') // the Stage is restored
    // Nothing more reaches the (dead) worker, and a late reply changes nothing.
    await new Promise(r => setTimeout(r, 20))
    expect(sent.length).toBe(posted)
    expect(sent.some(m => m.type === 'finish')).toBe(false)
    const n = progress.length
    w.terminated = false
    w.reply({ type: 'done', gif: new ArrayBuffer(8), length: 8 })
    expect(progress.length).toBe(n)
  })

  test('an already-aborted signal rejects at once and never starts a worker', async () => {
    const makeWorker = vi.fn()
    const ctl = new AbortController()
    ctl.abort()
    const err = await record(source(2), fakeStage().stage, { format: 'gif', size: 480, fps: 15 }, ctl.signal, () => {}, { makeWorker, makeSurface: fakeSurface })
      .then(() => null, (e: unknown) => e)
    expect((err as DOMException).name).toBe('AbortError')
    expect(makeWorker).not.toHaveBeenCalled()
  })

  test('an encoder error rejects (not an AbortError) and frees the worker', async () => {
    const { w } = fakeWorker({ failAt: 3 })
    const { stage, log } = fakeStage()
    const err = await record(source(2), stage, { format: 'gif', size: 480, fps: 15 }, new AbortController().signal, () => {}, gifDeps(w))
      .then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).not.toBe('AbortError')
    expect(w.terminate).toHaveBeenCalled()
    expect(log.at(-1)).toBe('end')
  })

  test('a worker crash (onerror) rejects', async () => {
    const { w } = fakeWorker({ auto: false })
    const run = record(source(2), fakeStage().stage, { format: 'gif', size: 480, fps: 15 }, new AbortController().signal, () => {}, gifDeps(w))
    await vi.waitFor(() => expect(w.onerror).not.toBeNull())
    w.onerror!({ message: 'crash' } as ErrorEvent)
    await expect(run).rejects.toThrow(/crash/)
    expect(w.terminate).toHaveBeenCalled()
  })
})

describe('record WebM', () => {
  /** A fake MediaRecorder + capture track: requestFrame logs the frame drawn last. */
  function fakeMedia({ manual = true }: { manual?: boolean } = {}) {
    const events: string[] = []
    let last = -1
    const track = { requestFrame: manual ? vi.fn(() => events.push(`frame ${last}`)) : undefined, stop: vi.fn() }
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
    const streamFps: number[] = []
    class FakeRecorder {
      static isTypeSupported = (t: string) => t === 'video/webm;codecs=vp9' || t === 'video/webm'
      static last: FakeRecorder
      state = 'inactive'
      ondataavailable: ((e: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      onerror: ((e: Event) => void) | null = null
      constructor(readonly stream: MediaStream, readonly opts: MediaRecorderOptions) {
        FakeRecorder.last = this
      }
      start() {
        this.state = 'recording'
        events.push('start')
      }
      stop() {
        if (this.state === 'inactive') return
        this.state = 'inactive'
        events.push('stop')
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob(['webm'], { type: 'video/webm' }) })
          this.onstop?.()
        })
      }
    }
    const surface: Surface = {
      draw: () => {},
      pixels: () => new ArrayBuffer(0),
      captureStream: fps => {
        streamFps.push(fps)
        return stream
      },
    }
    const { stage, drawn } = fakeStage()
    stage.draw = v => {
      drawn.push(v.t)
      last = drawn.length - 1
    }
    const waits: number[] = []
    const deps: RecordDeps = {
      makeSurface: () => surface,
      MediaRecorder: FakeRecorder as unknown as typeof MediaRecorder,
      wait: (ms, signal) => {
        waits.push(ms)
        return signal.aborted ? Promise.reject(new DOMException('Aborted', 'AbortError')) : Promise.resolve()
      },
    }
    return { deps, events, track, stage, drawn, waits, streamFps, FakeRecorder }
  }

  test('requests one capture frame per deterministic view, then holds and stops', async () => {
    const m = fakeMedia()
    const progress: number[] = []
    const blob = await record(source(1), m.stage, { format: 'webm', size: 720, fps: 30 }, new AbortController().signal, p => progress.push(p), m.deps)
    expect(blob.type).toBe('video/webm')
    expect(blob.size).toBeGreaterThan(0)
    const ts = frameTimes(source(1), 30)
    expect(m.drawn).toEqual(ts) // no palette sample for video
    expect(m.streamFps).toEqual([0]) // manual frames: captureStream(0) + requestFrame
    expect(m.FakeRecorder.last.opts.mimeType).toBe('video/webm;codecs=vp9')
    // start, each frame once in order (the last repeated at the end of the hold), stop.
    expect(m.events[0]).toBe('start')
    expect(m.events.slice(1, ts.length + 1)).toEqual(ts.map((_, i) => `frame ${i}`))
    expect(m.events.at(-1)).toBe('stop')
    expect(m.waits.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(HOLD_MS)
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThan(progress[i - 1]!)
    expect(progress.at(-1)).toBe(1)
    expect(m.track.stop).toHaveBeenCalled()
  })

  test('no requestFrame: a timed capture stream at the target fps', async () => {
    const m = fakeMedia({ manual: false })
    await record(source(1), m.stage, { format: 'webm', size: 480, fps: 15 }, new AbortController().signal, () => {}, m.deps)
    expect(m.streamFps).toEqual([0, 15]) // probed at 0 fps, no requestFrame: re-captured timed
    expect(m.track.stop).toHaveBeenCalled()
  })

  test('cancel stops the recorder and rejects with AbortError', async () => {
    const m = fakeMedia()
    const ctl = new AbortController()
    let n = 0
    const wait = m.deps.wait!
    m.deps.wait = (ms, signal) => {
      if (++n === 3) ctl.abort()
      return wait(ms, signal)
    }
    const err = await record(source(2), m.stage, { format: 'webm', size: 480, fps: 15 }, ctl.signal, () => {}, m.deps).then(() => null, (e: unknown) => e)
    expect((err as DOMException).name).toBe('AbortError')
    expect(m.events).toContain('stop')
    expect(m.track.stop).toHaveBeenCalled()
  })
})

describe('GIF budget (fix round 1)', () => {
  const crane = { steps: 22, duration: 22 * 800 } // 17.6 s

  test('estimates frames and bytes from the output size and the replay length', () => {
    const e = gifEstimate(source(2), { size: 480, fps: 15 }, 1.6)
    expect(e.frames).toBe(25)
    expect(e.bytes).toBeCloseTo(768 * 480 * 25 * GIF_BYTES_PER_PIXEL, 0)
    expect(e.ok).toBe(true)
  })

  test('a long replay at 1080p is over budget at either frame rate; 480p / 15 fps fits', () => {
    expect(gifEstimate(crane, { size: 1080, fps: 30 }, 1.6)).toMatchObject({ ok: false, reason: 'bytes' })
    expect(gifEstimate(crane, { size: 1080, fps: 15 }, 1.6)).toMatchObject({ ok: false, reason: 'bytes' })
    expect(gifEstimate(crane, { size: 480, fps: 15 }, 1.6).ok).toBe(true)
    expect(gifEstimate(crane, { size: 480, fps: 15 }, 1.6).bytes).toBeLessThanOrEqual(GIF_MAX_BYTES)
  })

  test('an absolute frame cap applies whatever the size', () => {
    const long = { steps: 40, duration: 40 * 800 } // 32 s → 961 frames at 30 fps
    expect(gifEstimate(long, { size: 480, fps: 30 }, 0.5)).toMatchObject({ ok: false, reason: 'frames' })
    expect(gifEstimate(long, { size: 480, fps: 30 }, 0.5).frames).toBeGreaterThan(GIF_MAX_FRAMES)
  })

  test('record refuses an over-budget GIF before starting a worker or touching the Stage', async () => {
    const makeWorker = vi.fn()
    const { stage, log } = fakeStage()
    const src = { ...crane, viewAt: (t: number) => ({ t }) }
    const err = await record(src, stage, { format: 'gif', size: 1080, fps: 30 }, new AbortController().signal, () => {}, { makeWorker, makeSurface: fakeSurface })
      .then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(RangeError)
    expect(makeWorker).not.toHaveBeenCalled()
    expect(log).toEqual([])
  })
})

describe('WebM in a hidden tab (fix round 1)', () => {
  function fakeVisibility(hidden = false) {
    const subs = new Set<() => void>()
    const v = {
      hidden,
      isHidden: () => v.hidden,
      onChange: (cb: () => void) => {
        subs.add(cb)
        return () => subs.delete(cb)
      },
      set(h: boolean) {
        v.hidden = h
        for (const cb of [...subs]) cb()
      },
      get listeners() {
        return subs.size
      },
    }
    return v
  }

  function media() {
    const track = { requestFrame: vi.fn(), stop: vi.fn() }
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
    const events: string[] = []
    class R {
      static isTypeSupported = () => true
      state = 'inactive'
      ondataavailable: ((e: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      onerror: ((e: Event) => void) | null = null
      start() {
        this.state = 'recording'
      }
      stop() {
        if (this.state === 'inactive') return
        this.state = 'inactive'
        events.push('stop')
        queueMicrotask(() => this.onstop?.())
      }
    }
    const surface: Surface = { draw: () => {}, pixels: () => new ArrayBuffer(0), captureStream: () => stream }
    return { track, events, R, surface }
  }

  test('hiding the tab mid-recording stops it with RecordHiddenError (no stretched video)', async () => {
    const m = media()
    const vis = fakeVisibility()
    let n = 0
    const deps: RecordDeps = {
      makeSurface: () => m.surface,
      MediaRecorder: m.R as unknown as typeof MediaRecorder,
      visibility: vis,
      wait: (_ms, signal) => {
        if (++n === 3) vis.set(true) // the user switches tabs
        return signal.aborted ? Promise.reject(new DOMException('x', 'AbortError')) : Promise.resolve()
      },
    }
    const { stage, log } = fakeStage()
    const err = await record(source(2), stage, { format: 'webm', size: 480, fps: 15 }, new AbortController().signal, () => {}, deps)
      .then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(RecordHiddenError)
    expect((err as Error).name).toBe('RecordHiddenError')
    expect(m.events).toContain('stop')
    expect(m.track.stop).toHaveBeenCalled()
    expect(vis.listeners).toBe(0)
    expect(log.at(-1)).toBe('end')
  })

  test('starting in a hidden tab is refused at once', async () => {
    const m = media()
    const err = await record(source(2), fakeStage().stage, { format: 'webm', size: 480, fps: 15 }, new AbortController().signal, () => {}, {
      makeSurface: () => m.surface,
      MediaRecorder: m.R as unknown as typeof MediaRecorder,
      visibility: fakeVisibility(true),
      wait: () => Promise.resolve(),
    }).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(RecordHiddenError)
  })

  test('a MediaRecorder constructor throw still stops the capture tracks', async () => {
    const m = media()
    class Throws {
      static isTypeSupported = () => true
      constructor() {
        throw new DOMException('no', 'NotSupportedError')
      }
    }
    const err = await record(source(1), fakeStage().stage, { format: 'webm', size: 480, fps: 15 }, new AbortController().signal, () => {}, {
      makeSurface: () => m.surface,
      MediaRecorder: Throws as unknown as typeof MediaRecorder,
      visibility: fakeVisibility(),
      wait: () => Promise.resolve(),
    }).then(() => null, (e: unknown) => e)
    expect((err as DOMException).name).toBe('NotSupportedError')
    expect(m.track.stop).toHaveBeenCalled()
  })
})
