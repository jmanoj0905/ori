// The WebGPU XPBD solver (spec 08; Plan 6 Task 3): the CPU reference solver's
// constraints (xpbd.ts buildConstraints), colours and substep, run as WGSL
// compute passes (solver.wgsl), one pass per colour. Same API as SoftSolver,
// except that positions come back asynchronously: every step queues a copy
// to a staging buffer, `positions()` returns the latest one that has arrived,
// and `read()` waits for the current state. Self-collision (a visual effect)
// runs on the CPU on that read-back copy and is written back before the next
// step.
//
// Device loss: `lost` resolves when the device is lost (driver reset, tab
// discarded, or `simulateLoss()` in tests); soft.ts then hands the model to
// the CPU solver.
import shader from './solver.wgsl?raw'
import { MAX_DT, WET_SOFTER, buildConstraints, type Constraints, type SoftParams, type Vec3 } from '../xpbd'
import { dihedral } from '../dihedral'
import { collide } from '../collision'
import type { SoftMesh } from '../remesh'

const WG = 64
// WebGPU's flag values (the spec's constants), so this module needs no global GPU* objects to load
const BUF = { MAP_READ: 0x0001, COPY_SRC: 0x0004, COPY_DST: 0x0008, UNIFORM: 0x0040, STORAGE: 0x0080 } as const
const COMPUTE = 0x4
const MAP_READ_MODE = 0x1

/** Pick a WebGPU device, or null (no navigator.gpu, no adapter). */
export async function requestDevice(gpu: GPU | undefined = (globalThis.navigator as Navigator | undefined)?.gpu): Promise<GPUDevice | null> {
  if (!gpu) return null
  try {
    const adapter = await gpu.requestAdapter()
    return adapter ? await adapter.requestDevice() : null
  } catch {
    return null
  }
}

export class GpuSolver {
  readonly mesh: SoftMesh
  readonly constraints: Constraints
  /** Resolves (once) when the device is lost. */
  readonly lost: Promise<GPUDeviceLostInfo | { reason: 'simulated'; message: string }>
  private device: GPUDevice
  private params: Required<SoftParams>
  private n: number
  private buf: Record<'sim' | 'pos' | 'prev' | 'vel' | 'pinT' | 'dist' | 'hinge' | 'hingeData' | 'staging', GPUBuffer>
  private pipelines: Record<'predict' | 'distances' | 'hinges' | 'velocities', GPUComputePipeline>
  private bind: GPUBindGroup
  private ranges: { dist: GPUBindGroup[]; hinge: GPUBindGroup[]; empty: GPUBindGroup }
  private rangeCounts: { dist: number[]; hinge: number[] }
  private mirror: Float32Array
  private invMass: Float32Array
  private pinned = new Map<number, Vec3>()
  private mapping: Promise<void> | null = null
  private dirty = false
  private hingeRestHost: Float32Array
  private simulate!: (info: { reason: 'simulated'; message: string }) => void
  private disposed = false

  constructor(device: GPUDevice, mesh: SoftMesh, params: SoftParams, constraints = buildConstraints(mesh)) {
    this.device = device
    this.mesh = mesh
    this.constraints = constraints
    this.params = { gravity: [0, 0, -9.81], damping: 0.5, collide: false, ...params }
    this.n = mesh.uv.length / 2
    this.lost = Promise.race([device.lost, new Promise<{ reason: 'simulated'; message: string }>(r => (this.simulate = r))])
    const c = constraints
    const usage = BUF.STORAGE | BUF.COPY_DST | BUF.COPY_SRC
    const make = (size: number, u = usage) => device.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage: u })
    this.invMass = Float32Array.from(c.mass, m => (m > 0 ? 1 / m : 0))
    this.mirror = Float32Array.from(mesh.positions)
    this.hingeRestHost = Float32Array.from(c.hingeRest)
    this.buf = {
      sim: make(32, BUF.UNIFORM | BUF.COPY_DST),
      pos: make(16 * this.n),
      prev: make(16 * this.n),
      vel: make(16 * this.n),
      pinT: make(16 * this.n),
      dist: make(16 * (c.distRest.length || 1)),
      hinge: make(16 * (c.hingeRest.length || 1)),
      hingeData: make(16 * (c.hingeRest.length || 1)),
      staging: make(16 * this.n, BUF.MAP_READ | BUF.COPY_DST),
    }
    const q = device.queue
    q.writeBuffer(this.buf.pos, 0, this.packPositions(this.mirror))
    q.writeBuffer(this.buf.prev, 0, this.packPositions(this.mirror))
    q.writeBuffer(this.buf.vel, 0, new Float32Array(4 * this.n))
    q.writeBuffer(this.buf.pinT, 0, new Float32Array(4 * this.n))
    if (c.distRest.length) {
      const packed = new Uint32Array(4 * c.distRest.length)
      const rest = new Float32Array(1)
      const bits = new Uint32Array(rest.buffer)
      for (let k = 0; k < c.distRest.length; k++) {
        rest[0] = c.distRest[k]!
        packed.set([c.dist[2 * k]!, c.dist[2 * k + 1]!, bits[0]!, 0], 4 * k)
      }
      q.writeBuffer(this.buf.dist, 0, packed)
    }
    if (c.hingeRest.length) q.writeBuffer(this.buf.hinge, 0, c.hinge)
    this.writeHingeData()

    device.pushErrorScope('validation')
    const module = device.createShaderModule({ code: shader })
    const layout0 = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: COMPUTE, buffer: { type: 'uniform' } },
        ...[1, 2, 3].map(binding => ({ binding, visibility: COMPUTE, buffer: { type: 'storage' as const } })),
        ...[4, 5, 6, 7].map(binding => ({ binding, visibility: COMPUTE, buffer: { type: 'read-only-storage' as const } })),
      ],
    })
    const layout1 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: COMPUTE, buffer: { type: 'uniform' } }] })
    const layout = device.createPipelineLayout({ bindGroupLayouts: [layout0, layout1] })
    const pipe = (entryPoint: string) => device.createComputePipeline({ layout, compute: { module, entryPoint } })
    this.pipelines = { predict: pipe('predict'), distances: pipe('distances'), hinges: pipe('hinges'), velocities: pipe('velocities') }
    const order = ['sim', 'pos', 'prev', 'vel', 'pinT', 'dist', 'hinge', 'hingeData'] as const
    this.bind = device.createBindGroup({ layout: layout0, entries: order.map((k, binding) => ({ binding, resource: { buffer: this.buf[k] } })) })
    const rangeGroup = (start: number, count: number) => {
      const b = make(16, BUF.UNIFORM | BUF.COPY_DST)
      q.writeBuffer(b, 0, new Uint32Array([start, count, 0, 0]))
      return device.createBindGroup({ layout: layout1, entries: [{ binding: 0, resource: { buffer: b } }] })
    }
    const groups = (offsets: number[]) => offsets.slice(0, -1).map((s, k) => ({ g: rangeGroup(s, offsets[k + 1]! - s), n: offsets[k + 1]! - s }))
    const d = groups(c.distanceColors)
    const h = groups(c.hingeColors)
    this.ranges = { dist: d.map(x => x.g), hinge: h.map(x => x.g), empty: rangeGroup(0, 0) }
    this.rangeCounts = { dist: d.map(x => x.n), hinge: h.map(x => x.n) }
    this.valid = device.popErrorScope().then(e => e === null)
  }

  /** Resolves false when the pipelines failed to build on this device (the caller uses the CPU solver). */
  readonly valid: Promise<boolean>

  private packPositions(p: ArrayLike<number>): Float32Array {
    const out = new Float32Array(4 * this.n)
    for (let i = 0; i < this.n; i++) {
      out[4 * i] = p[3 * i]!
      out[4 * i + 1] = p[3 * i + 1]!
      out[4 * i + 2] = p[3 * i + 2]!
      out[4 * i + 3] = this.pinned.has(i) ? 0 : this.invMass[i]!
    }
    return out
  }

  /** Per hinge: its rest angle and compliance (negative: disabled), from the params (wet softens). */
  private writeHingeData(): void {
    const c = this.constraints
    if (!c.hingeRest.length) return
    const wet = this.params.wet ? WET_SOFTER : 1
    const a = new Float32Array(4 * c.hingeRest.length)
    for (let k = 0; k < c.hingeRest.length; k++) {
      const alpha = c.hingeIsCrease[k] ? (this.params.creaseCompliance * wet) / Math.max(c.hingeStiffness[k]!, 1e-9) : this.params.bendCompliance * wet
      a[4 * k] = this.hingeRestHost[k]!
      a[4 * k + 1] = Number.isFinite(alpha) ? alpha : -1
    }
    this.device.queue.writeBuffer(this.buf.hingeData, 0, a)
  }

  setParams(p: Partial<SoftParams>): void {
    this.params = { ...this.params, ...p }
    this.writeHingeData()
  }
  getParams(): SoftParams {
    return { ...this.params }
  }

  pin(i: number, p: Vec3): void {
    if (i < 0 || i >= this.n) return
    this.pinned.set(i, [p[0], p[1], p[2]])
    const q = this.device.queue
    q.writeBuffer(this.buf.pinT, 16 * i, new Float32Array([p[0], p[1], p[2], 1]))
    q.writeBuffer(this.buf.pos, 16 * i, new Float32Array([p[0], p[1], p[2], 0]))
    q.writeBuffer(this.buf.vel, 16 * i, new Float32Array(4))
    this.mirror.set(p, 3 * i)
  }
  unpin(i: number): void {
    if (!this.pinned.delete(i)) return
    const q = this.device.queue
    q.writeBuffer(this.buf.pinT, 16 * i, new Float32Array(4))
    q.writeBuffer(this.buf.pos, 16 * i + 12, new Float32Array([this.invMass[i]!]))
  }
  /** The pinned particles and their targets (a CPU hand-over keeps them). */
  pins(): Map<number, Vec3> {
    return new Map(this.pinned)
  }

  setPositions(p: ArrayLike<number>): void {
    for (let i = 0; i < 3 * this.n; i++) this.mirror[i] = p[i]!
    const packed = this.packPositions(this.mirror)
    this.device.queue.writeBuffer(this.buf.pos, 0, packed)
    this.device.queue.writeBuffer(this.buf.prev, 0, packed)
    this.device.queue.writeBuffer(this.buf.vel, 0, new Float32Array(4 * this.n))
  }

  /** The latest positions read back (xyz per particle). */
  positions(): Float32Array {
    return this.mirror
  }

  step(dt: number): void {
    if (!(dt > 0) || this.disposed) return
    const subs = Math.max(1, Math.round(this.params.iterations))
    const h = Math.min(dt, MAX_DT) / subs
    const [gx, gy, gz] = this.params.gravity
    const q = this.device.queue
    if (this.dirty) {
      // collision corrections made on the CPU copy since the last step
      q.writeBuffer(this.buf.pos, 0, this.packPositions(this.mirror))
      this.dirty = false
    }
    const simData = new ArrayBuffer(32)
    new Float32Array(simData, 0, 6).set([gx, gy, gz, 0, h, Math.exp(-this.params.damping * h)])
    new Uint32Array(simData, 24, 2).set([this.n, 0])
    q.writeBuffer(this.buf.sim, 0, simData)
    const enc = this.device.createCommandEncoder()
    const groupsN = Math.ceil(this.n / WG)
    for (let s = 0; s < subs; s++) {
      const run = (p: GPUComputePipeline, range: GPUBindGroup, count: number) => {
        if (count === 0) return
        const pass = enc.beginComputePass()
        pass.setPipeline(p)
        pass.setBindGroup(0, this.bind)
        pass.setBindGroup(1, range)
        pass.dispatchWorkgroups(Math.ceil(count / WG))
        pass.end()
      }
      run(this.pipelines.predict, this.ranges.empty, this.n)
      this.ranges.dist.forEach((g, k) => run(this.pipelines.distances, g, this.rangeCounts.dist[k]!))
      this.ranges.hinge.forEach((g, k) => run(this.pipelines.hinges, g, this.rangeCounts.hinge[k]!))
      run(this.pipelines.velocities, this.ranges.empty, this.n)
    }
    void groupsN
    if (!this.mapping) enc.copyBufferToBuffer(this.buf.pos, 0, this.buf.staging, 0, 16 * this.n)
    q.submit([enc.finish()])
    if (!this.mapping) this.mapping = this.readBack()
  }

  private async readBack(): Promise<void> {
    try {
      await this.buf.staging.mapAsync(MAP_READ_MODE)
      const data = new Float32Array(this.buf.staging.getMappedRange().slice(0))
      this.buf.staging.unmap()
      for (let i = 0; i < this.n; i++) {
        this.mirror[3 * i] = data[4 * i]!
        this.mirror[3 * i + 1] = data[4 * i + 1]!
        this.mirror[3 * i + 2] = data[4 * i + 2]!
      }
      const c = this.params.collide
      if (c) {
        const x = Float64Array.from(this.mirror)
        const r = collide(x, Float64Array.from(this.mirror), this.mesh, p => (this.pinned.has(p) ? 0 : this.invMass[p]!), c === true ? {} : c)
        if (r.contacts > 0) {
          this.mirror.set(x)
          this.dirty = true
        }
      }
    } catch {
      /* lost or destroyed: `lost` reports it */
    } finally {
      this.mapping = null
    }
  }

  /** Wait for the GPU to finish everything queued, and return the positions. */
  async read(): Promise<Float32Array> {
    if (this.mapping) await this.mapping
    const enc = this.device.createCommandEncoder()
    enc.copyBufferToBuffer(this.buf.pos, 0, this.buf.staging, 0, 16 * this.n)
    this.device.queue.submit([enc.finish()])
    this.mapping = this.readBack()
    await this.mapping
    return this.mirror
  }

  /** Wet folding dries: every hinge rests at its current angle (from the last read-back). */
  dry(): void {
    const { hinge } = this.constraints
    for (let k = 0; k < this.hingeRestHost.length; k++)
      this.hingeRestHost[k] = dihedral(this.mirror, hinge[4 * k]!, hinge[4 * k + 1]!, hinge[4 * k + 2]!, hinge[4 * k + 3]!)
    this.constraints.hingeRest.set(this.hingeRestHost)
    this.writeHingeData()
    this.device.queue.writeBuffer(this.buf.vel, 0, new Float32Array(4 * this.n))
  }

  setCreaseTargets(deg: number): void {
    const { hingeIsCrease } = this.constraints
    for (let k = 0; k < this.hingeRestHost.length; k++) if (hingeIsCrease[k]) this.hingeRestHost[k] = (deg * Math.PI) / 180
    this.constraints.hingeRest.set(this.hingeRestHost)
    this.writeHingeData()
  }

  /** Tests: behave as if the device were lost. */
  simulateLoss(): void {
    this.simulate({ reason: 'simulated', message: 'simulated device loss' })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const b of Object.values(this.buf)) b.destroy()
  }
}
