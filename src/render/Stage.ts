// The Stage: the only place Three.js lives. React talks to it through these
// methods and never touches a Three object. Renders on demand (dirty + rAF).
//
// Paper (Task 3): the committed frame is one paper mesh drawn twice (front
// material on FrontSide, back material on BackSide), plus crease shading and
// the valley / mountain diagram creases. It is rebuilt only in setFrame.
// While a preview exists the committed paper is hidden (it is still the pick
// target: raycasts ignore visibility, so picks always name committed faces)
// and Preview.frame is drawn instead (R25): its stationary faces opaque, its
// moving faces as the translucent ghost, plus the accent live crease. The
// stationary part is rebuilt only when Preview.frame changes; each pointer
// move rebuilds just the ghost and the live crease.
import * as THREE from 'three'
import type { FacePose, FoldKind, Frame, Preview, Tool, Vec2 } from '@engine'
import { DEFAULT_PAPER, type PaperSettings } from '../studio/store'
import {
  DEFAULT_TILT,
  FOV_DEG,
  MAX_TILT,
  frameBounds,
  offsetFor,
} from './camera'
import { buildCreaseLines, buildCreaseShade, buildLiveCrease, CREASE_LIFT, INK, makeShadeMaterial, type CreaseLines } from './creases'
import {
  ACCENT,
  disposeGhost,
  disposeMaterials,
  luminance,
  makeGhostMaterials,
  makeMaterials,
  sideColors,
  tintGhost,
  type GhostMaterials,
  type PaperMaterials,
} from './materials'
import { buildPaperGeometry, LAYER_GAP, layerOffsets, poseTable, type LayerOffsets } from './paperMesh'
import { IVORY, createWashi, detectShadowMapSize, type WashiUniforms } from './washi'

export type Pick = { face: number; paper: Vec2; folded: Vec2 }

/** How to draw a preview: from the gesture that produced it. */
export type PreviewStyle = { kind?: FoldKind; tool?: Tool; progress?: number }

type CamState = { tx: number; ty: number; tilt: number; azimuth: number; distance: number }

/** A built piece of paper: mesh (front + back), crease shading, diagram creases. */
type Built = {
  group: THREE.Group
  geometry: THREE.BufferGeometry
  front: THREE.Mesh
  back: THREE.Mesh
  shade: THREE.Mesh
  valley: CreaseLines
  mountain: CreaseLines
}

type Ghost = {
  group: THREE.Group
  geometry: THREE.BufferGeometry
  valley: CreaseLines
  mountain: CreaseLines
  live: CreaseLines
}

const VIEW_ANIM_MS = 300
const LIGHT_DIR = new THREE.Vector3(-2.2, -1.6, 4.5).normalize()

export class Stage {
  private readonly host: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 500)
  private readonly key: THREE.DirectionalLight
  private readonly washi: THREE.Mesh
  private readonly washiUniforms: WashiUniforms
  private readonly ro: ResizeObserver
  private readonly raycaster = new THREE.Raycaster()
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

  private materials: PaperMaterials
  private readonly ghostMats: GhostMaterials = makeGhostMaterials()
  private readonly shadeMat = makeShadeMaterial()

  private committed: Built | null = null
  private committedLayers: LayerOffsets | null = null
  private committedTable: (readonly number[])[] = []
  private stationary: Built | null = null
  private stationaryFrame: Frame | null = null
  private ghost: Ghost | null = null

  private frame: Frame | null = null
  private poses: FacePose[] = []
  private preview: Preview | null = null
  private previewStyle: PreviewStyle = {}
  private paper: PaperSettings = DEFAULT_PAPER
  private sheet = { width: 1, height: 1 }
  private framed = false
  /** Wall time of the last setPreview, ms (dev diagnostics). */
  lastPreviewMs = 0

  private cam: CamState = { tx: 0.5, ty: 0.5, tilt: DEFAULT_TILT, azimuth: 0, distance: 3 }
  private anim: { from: CamState; to: CamState; start: number } | null = null
  private width = 1
  private height = 1
  private dpr = 1
  private dirty = true
  private raf = 0
  private disposed = false

  constructor(host: HTMLElement) {
    this.host = host
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false })
    this.renderer.setClearColor(new THREE.Color(IVORY), 1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    host.appendChild(this.renderer.domElement)

    const { mesh, uniforms } = createWashi()
    this.washi = mesh
    this.washiUniforms = uniforms
    this.scene.add(this.washi)

    // (PCFSoftShadowMap was removed in three 0.18x; PCFShadowMap is the soft filter now.)
    // Studio light: a soft key from up-left-front plus a warm/cool hemisphere fill.
    const size = detectShadowMapSize()
    this.key = new THREE.DirectionalLight(0xfff8ee, 2.3)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(size, size)
    this.key.shadow.radius = 5
    this.key.shadow.bias = -0.0004
    this.key.shadow.normalBias = 0.004
    this.scene.add(this.key, this.key.target)
    this.scene.add(new THREE.HemisphereLight(0xfffaf0, 0xefe6d6, 1.3))
    this.fitShadow(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 0)))

    this.materials = makeMaterials(this.paper)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    window.addEventListener('resize', this.resize)
    this.resize()
    this.cam.distance = this.fitDistance()
    this.applyCamera(this.cam)
  }

  // ---- inputs ------------------------------------------------------------

  setFrame(frame: Frame, poses: FacePose[]): void {
    if (frame === this.frame && poses === this.poses) return
    this.frame = frame
    this.poses = poses
    const b = bboxOf(frame)
    const changed = Math.abs(b.width - this.sheet.width) > 1e-6 || Math.abs(b.height - this.sheet.height) > 1e-6
    this.sheet = { width: b.width, height: b.height }
    this.buildCommitted()
    if (changed || !this.framed) {
      this.framed = true
      const c = this.modelCenter()
      this.anim = null
      this.cam = { ...this.cam, tx: c.x, ty: c.y, distance: this.fitDistance() }
      this.applyCamera(this.cam)
    }
    this.invalidate()
  }

  setPreview(p: Preview | null, style: PreviewStyle = {}): void {
    const t0 = performance.now()
    this.preview = p
    this.previewStyle = style
    this.buildPreview()
    this.lastPreviewMs = performance.now() - t0
    this.invalidate()
  }

  setPaper(s: PaperSettings): void {
    const gapChanged = gapFor(s) !== gapFor(this.paper)
    this.paper = s
    disposeMaterials(this.materials)
    this.materials = makeMaterials(s)
    if (gapChanged) {
      this.buildCommitted()
      this.disposeStationary()
      this.buildPreview()
    } else {
      for (const b of [this.committed, this.stationary]) {
        if (!b) continue
        b.front.material = this.materials.front
        b.back.material = this.materials.back
        this.inkLines(b.valley, b.mountain)
      }
      if (this.preview) tintGhost(this.ghostMats, sideColors(s), this.preview.blocked, this.ghostFade())
    }
    this.invalidate()
  }

  // ---- queries -----------------------------------------------------------

  /**
   * Raycast the committed paper (front and back); the nearest hit is the face
   * visually on top from this view (layers are lifted apart). Face ids are of
   * the committed frame, also mid-preview.
   */
  pick(clientX: number, clientY: number): Pick | null {
    const b = this.committed
    const lo = this.committedLayers
    if (!b || !lo) return null
    this.setRay(clientX, clientY)
    const hit = this.raycaster.intersectObjects([b.front, b.back], false)[0]
    if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return null
    const triFace = b.geometry.userData.triFace as Int32Array
    const face = triFace[hit.faceIndex]
    if (face === undefined) return null
    const local = hit.point.clone().sub(new THREE.Vector3(lo.offsets[3 * face], lo.offsets[3 * face + 1], lo.offsets[3 * face + 2]))
    const m = this.committedTable[face]
    if (m) local.applyMatrix4(new THREE.Matrix4().fromArray(m as number[]).invert())
    return { face, paper: [local.x, local.y], folded: [hit.point.x, hit.point.y] }
  }

  /** Intersect the view ray with the z = 0 plane; paper coordinates (x, y). */
  projectToPaperPlane(clientX: number, clientY: number): Vec2 {
    this.setRay(clientX, clientY)
    const p = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(this.plane, p)) return [this.cam.tx, this.cam.ty]
    return [p.x, p.y]
  }

  // ---- camera ------------------------------------------------------------

  /** 'top' looks straight down -z; 'reset' returns to the tilted studio view, refit to the sheet. */
  view(name: 'top' | 'reset', animate: boolean): void {
    const c = this.modelCenter()
    const to: CamState = {
      tx: c.x, ty: c.y, azimuth: 0,
      tilt: name === 'top' ? 0 : DEFAULT_TILT,
      distance: this.fitDistance(),
    }
    if (!animate) {
      this.anim = null
      this.cam = to
      this.applyCamera(this.cam)
      return
    }
    this.anim = { from: { ...this.cam }, to, start: performance.now() }
    this.invalidate()
  }

  /** Orbit by a pointer delta in pixels (Task 6 binds this to actions). */
  orbit(dx: number, dy: number): void {
    this.anim = null
    this.cam.azimuth -= dx * 0.006
    this.cam.tilt = clamp(this.cam.tilt - dy * 0.006, 0, MAX_TILT)
    this.applyCamera(this.cam)
  }

  /** Pan by a pointer delta in pixels, in the view plane. */
  pan(dx: number, dy: number): void {
    this.anim = null
    const worldPerPx = (2 * this.cam.distance * Math.tan((FOV_DEG * Math.PI) / 360)) / this.height
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
    const d = right.multiplyScalar(-dx * worldPerPx).add(up.multiplyScalar(dy * worldPerPx))
    this.cam.tx += d.x
    this.cam.ty += d.y
    this.applyCamera(this.cam)
  }

  /** Zoom by a wheel-like delta (positive = out). */
  zoom(delta: number): void {
    this.anim = null
    this.cam.distance = clamp(this.cam.distance * Math.exp(delta * 0.001), 0.3, 40)
    this.applyCamera(this.cam)
  }

  // ---- output ------------------------------------------------------------

  /** Render at 2x to a PNG blob; `transparent` drops the washi desk and background. */
  snapshot(scale: 2, transparent: boolean): Promise<Blob> {
    const w = this.width * scale
    const h = this.height * scale
    const prevAlpha = this.renderer.getClearAlpha()
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(w, h, false)
    this.washiUniforms.uResolution.value.set(w, h)
    this.syncLines(w, h, scale)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.washi.visible = !transparent
    this.renderer.setClearAlpha(transparent ? 0 : 1)
    this.renderer.render(this.scene, this.camera)
    const canvas = this.renderer.domElement
    const blob = new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('snapshot failed'))), 'image/png'),
    )
    // toBlob captures the buffer synchronously; restore the live view now.
    this.washi.visible = true
    this.renderer.setClearAlpha(prevAlpha)
    this.resize()
    return blob
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    window.removeEventListener('resize', this.resize)
    this.disposeBuilt(this.committed)
    this.committed = null
    this.disposeStationary()
    this.disposeGhostPieces()
    disposeMaterials(this.materials)
    disposeGhost(this.ghostMats)
    this.shadeMat.dispose()
    this.scene.traverse(o => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.Material | undefined
      if (mat) mat.dispose()
    })
    this.key.shadow.map?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }

  // ---- paper -------------------------------------------------------------

  private gap(): number {
    return gapFor(this.paper)
  }

  private buildCommitted(): void {
    this.disposeBuilt(this.committed)
    this.committed = null
    this.committedLayers = null
    const frame = this.frame
    if (!frame) return
    const lo = layerOffsets(frame, this.poses, this.gap())
    this.committedLayers = lo
    this.committedTable = poseTable(frame, this.poses)
    this.committed = this.build(frame, this.poses, lo)
    this.committed.group.visible = !this.preview
    this.scene.add(this.committed.group)
    const box = this.committed.geometry.boundingBox
    if (box) this.fitShadow(box)
  }

  private build(frame: Frame, poses: readonly FacePose[], lo: LayerOffsets, faces?: readonly number[]): Built {
    const geometry = buildPaperGeometry(frame, poses, this.gap(), { offsets: lo.offsets, faces })
    const front = new THREE.Mesh(geometry, this.materials.front)
    const back = new THREE.Mesh(geometry, this.materials.back)
    front.castShadow = true // shadowSide = DoubleSide: one caster is enough
    front.receiveShadow = true
    back.receiveShadow = true
    const lift = CREASE_LIFT * this.gap()
    const shade = new THREE.Mesh(buildCreaseShade(frame, poses, { offsets: lo.offsets, up: lo.up, lift, faces }), this.shadeMat)
    shade.renderOrder = 2
    const { valley, mountain } = buildCreaseLines(frame, poses, { offsets: lo.offsets, levels: lo.levels, up: lo.up, lift, faces })
    this.inkLines(valley, mountain)
    const group = new THREE.Group()
    group.add(front, back, shade, valley, mountain)
    return { group, geometry, front, back, shade, valley, mountain }
  }

  /** Ink that reads on each side of the paper (dark on light paper, pale on dark). */
  private inkLines(...lines: CreaseLines[]): void {
    const sides = sideColors(this.paper)
    const ink = (hex: string) => new THREE.Color(luminance(hex) < 0.09 ? '#EDE6D8' : INK)
    for (const l of lines) {
      ;(l.material.uniforms.uColor!.value as THREE.Color).copy(ink(sides.front))
      ;(l.material.uniforms.uColorBack!.value as THREE.Color).copy(ink(sides.back))
      l.setViewport(this.width * this.dpr, this.height * this.dpr, this.dpr)
    }
  }

  private buildPreview(): void {
    const p = this.preview
    if (this.committed) this.committed.group.visible = !p
    if (!p) {
      this.disposeStationary()
      this.disposeGhostPieces()
      return
    }
    const st = this.previewStyle
    const above = (st.tool ?? 'fold') !== 'fold' || st.kind !== 'mountain'
    const lo = layerOffsets(p.frame, p.poses, this.gap(), { moving: p.moving, above })
    const moving = new Set(p.moving)
    if (this.stationaryFrame !== p.frame || !this.stationary) {
      this.disposeStationary()
      const faces = p.frame.faces_vertices.map((_, f) => f).filter(f => !moving.has(f))
      this.stationary = this.build(p.frame, p.poses, lo, faces)
      this.stationaryFrame = p.frame
      this.scene.add(this.stationary.group)
    }
    this.disposeGhostPieces()
    const geometry = buildPaperGeometry(p.frame, p.poses, this.gap(), { offsets: lo.offsets, faces: p.moving })
    const front = new THREE.Mesh(geometry, this.ghostMats.front)
    const back = new THREE.Mesh(geometry, this.ghostMats.back)
    const xray = new THREE.Mesh(geometry, this.ghostMats.xray)
    front.castShadow = true
    front.renderOrder = back.renderOrder = 10
    xray.renderOrder = 11
    const { valley, mountain } = buildCreaseLines(p.frame, p.poses, {
      offsets: lo.offsets, levels: lo.levels, up: lo.up, lift: CREASE_LIFT * this.gap(), faces: p.moving, opacity: 0.55,
    })
    this.inkLines(valley, mountain)
    valley.renderOrder = mountain.renderOrder = 12
    const live = buildLiveCrease(p.crease, st.kind ?? 'valley', ACCENT)
    live.setViewport(this.width * this.dpr, this.height * this.dpr, this.dpr)
    tintGhost(this.ghostMats, sideColors(this.paper), p.blocked, this.ghostFade())
    const group = new THREE.Group()
    group.add(front, back, xray, valley, mountain, live)
    this.ghost = { group, geometry, valley, mountain, live }
    this.scene.add(group)
  }

  /** Compound tools give end-state poses at any progress (R15): fade the ghost in by progress. */
  private ghostFade(): number {
    const st = this.previewStyle
    if ((st.tool ?? 'fold') === 'fold') return 1
    return 0.45 + 0.55 * clamp(st.progress ?? 1, 0, 1)
  }

  private disposeBuilt(b: Built | null): void {
    if (!b) return
    b.group.removeFromParent()
    b.geometry.dispose()
    b.shade.geometry.dispose()
    b.valley.dispose()
    b.mountain.dispose()
  }

  private disposeStationary(): void {
    this.disposeBuilt(this.stationary)
    this.stationary = null
    this.stationaryFrame = null
  }

  private disposeGhostPieces(): void {
    const g = this.ghost
    if (!g) return
    g.group.removeFromParent()
    g.geometry.dispose()
    g.valley.dispose()
    g.mountain.dispose()
    g.live.dispose()
    this.ghost = null
  }

  private modelCenter(): THREE.Vector3 {
    const box = this.committed?.geometry.boundingBox
    if (box && !box.isEmpty()) return box.getCenter(new THREE.Vector3())
    return new THREE.Vector3(this.sheet.width / 2, this.sheet.height / 2, 0)
  }

  /** Size the key light's shadow frustum to the model (plus room for a lifted flap). */
  private fitShadow(box: THREE.Box3): void {
    const c = box.getCenter(new THREE.Vector3())
    const s = box.getSize(new THREE.Vector3())
    const r = 0.5 * Math.hypot(s.x, s.y, s.z) + 0.5 * Math.max(this.sheet.width, this.sheet.height) + 0.05
    this.key.target.position.copy(c)
    this.key.position.copy(c).addScaledVector(LIGHT_DIR, 4 * r + 2)
    const sc = this.key.shadow.camera
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r
    sc.near = 0.1
    sc.far = 8 * r + 4
    sc.updateProjectionMatrix()
    this.key.target.updateMatrixWorld()
    this.key.updateMatrixWorld()
  }

  // ---- internals ---------------------------------------------------------

  private readonly resize = (): void => {
    if (this.disposed) return
    const rect = this.host.getBoundingClientRect()
    this.width = Math.max(1, Math.floor(rect.width))
    this.height = Math.max(1, Math.floor(rect.height))
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(this.width, this.height, false)
    this.washiUniforms.uResolution.value.set(this.width * this.dpr, this.height * this.dpr)
    this.syncLines(this.width * this.dpr, this.height * this.dpr, this.dpr)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
    this.invalidate()
  }

  /** Crease dash shaders work in pixels: keep their viewport current. */
  private syncLines(w: number, h: number, pixelRatio: number): void {
    this.scene.traverse(o => {
      if ((o as Partial<CreaseLines>).isCreaseLines) (o as CreaseLines).setViewport(w, h, pixelRatio)
    })
  }

  private fitDistance(): number {
    return frameBounds(this.sheet, FOV_DEG, this.width / this.height).distance
  }

  private applyCamera(c: CamState): void {
    const [ox, oy, oz] = offsetFor(c.tilt, c.azimuth)
    this.camera.position.set(c.tx + ox * c.distance, c.ty + oy * c.distance, oz * c.distance)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(c.tx, c.ty, 0)
    // Depth precision follows the zoom, so the tiny layer gaps never z-fight.
    this.camera.near = Math.max(0.01, c.distance * 0.04)
    this.camera.far = 400 // the desk plane reaches 100 units; precision is set by near
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld(true)
    this.invalidate()
  }

  private setRay(clientX: number, clientY: number): void {
    const r = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1))
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(ndc, this.camera)
  }

  private invalidate(): void {
    this.dirty = true
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.tick)
  }

  private readonly tick = (now: number): void => {
    this.raf = 0
    if (this.disposed) return
    if (this.anim) {
      const t = clamp((now - this.anim.start) / VIEW_ANIM_MS, 0, 1)
      const e = t * t * (3 - 2 * t)
      const { from, to } = this.anim
      this.cam = {
        tx: lerp(from.tx, to.tx, e), ty: lerp(from.ty, to.ty, e), tilt: lerp(from.tilt, to.tilt, e),
        azimuth: lerp(from.azimuth, to.azimuth, e), distance: lerp(from.distance, to.distance, e),
      }
      this.applyCamera(this.cam)
      if (t >= 1) this.anim = null
    }
    if (this.dirty) {
      this.dirty = false
      this.renderer.render(this.scene, this.camera)
    }
    if (this.anim) this.invalidate()
  }
}

/** Layer gap from the paper thickness (visual only): 0.5 (the default) → LAYER_GAP. */
function gapFor(s: PaperSettings): number {
  const t = Number.isFinite(s.thickness) ? s.thickness : 0.5
  return LAYER_GAP * clamp(t / 0.5, 0.4, 2.5)
}

function bboxOf(frame: Frame): { width: number; height: number } {
  const c = frame.vertices_coords ?? []
  if (!c.length) return { width: 1, height: 1 }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of c) {
    x0 = Math.min(x0, p[0]!); x1 = Math.max(x1, p[0]!)
    y0 = Math.min(y0, p[1]!); y1 = Math.max(y1, p[1]!)
  }
  return { width: x1 - x0 || 1, height: y1 - y0 || 1 }
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
