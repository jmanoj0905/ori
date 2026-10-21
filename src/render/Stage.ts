// The Stage: the only place Three.js lives. React talks to it through these
// methods and never touches a Three object. Renders on demand (dirty + rAF).
import * as THREE from 'three'
import type { FacePose, Frame, Preview, Vec2 } from '@engine'
import type { PaperSettings } from '../studio/store'
import {
  DEFAULT_TILT,
  FOV_DEG,
  MAX_TILT,
  frameBounds,
  offsetFor,
} from './camera'
import { IVORY, createWashi, detectShadowMapSize, type WashiUniforms } from './washi'

export type Pick = { face: number; paper: Vec2; folded: Vec2 }

type CamState = { tx: number; ty: number; tilt: number; azimuth: number; distance: number }

const VIEW_ANIM_MS = 300

export class Stage {
  private readonly host: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 500)
  private readonly key: THREE.DirectionalLight
  private readonly washi: THREE.Mesh
  private readonly washiUniforms: WashiUniforms
  private readonly paperMaterial: THREE.MeshStandardMaterial
  private readonly ro: ResizeObserver
  private readonly raycaster = new THREE.Raycaster()
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

  private paperMesh: THREE.Mesh | null = null
  /** Face id of each triangle of paperMesh. */
  private triFace: number[] = []
  private poseByFace = new Map<number, THREE.Matrix4>()

  private frame: Frame | null = null
  private poses: FacePose[] = []
  private preview: Preview | null = null
  private paper: PaperSettings | null = null
  private sheet = { width: 1, height: 1 }

  private cam: CamState = { tx: 0, ty: 0, tilt: DEFAULT_TILT, azimuth: 0, distance: 3 }
  private anim: { from: CamState; to: CamState; start: number } | null = null
  private width = 1
  private height = 1
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
    this.key.position.set(-2.2, -1.6, 4.5)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(size, size)
    this.key.shadow.radius = 5
    this.key.shadow.bias = -0.0004
    this.key.shadow.normalBias = 0.01
    const sc = this.key.shadow.camera
    sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4; sc.near = 0.5; sc.far = 14
    this.scene.add(this.key, this.key.target)
    this.scene.add(new THREE.HemisphereLight(0xfffaf0, 0xefe6d6, 1.3))

    this.paperMaterial = new THREE.MeshStandardMaterial({ color: '#C8381F', roughness: 0.92, metalness: 0, side: THREE.DoubleSide })

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    window.addEventListener('resize', this.resize)
    this.resize()
    this.applyCamera(this.cam)
    this.cam.distance = this.fitDistance()
    this.applyCamera(this.cam)
  }

  // ---- inputs ------------------------------------------------------------

  setFrame(frame: Frame, poses: FacePose[]): void {
    this.frame = frame
    this.poses = poses
    const b = bboxOf(frame)
    const changed = Math.abs(b.width - this.sheet.width) > 1e-6 || Math.abs(b.height - this.sheet.height) > 1e-6
    this.sheet = b
    if (changed) {
      this.cam.distance = this.fitDistance()
      this.applyCamera(this.cam)
    }
    this.rebuild()
  }

  setPreview(p: Preview | null): void {
    this.preview = p
    this.rebuild()
  }

  setPaper(s: PaperSettings): void {
    this.paper = s
    this.paperMaterial.color.set(s.front)
    this.invalidate()
  }

  // ---- queries -----------------------------------------------------------

  /** Raycast the paper mesh; null if there is none or nothing is hit. */
  pick(clientX: number, clientY: number): Pick | null {
    if (!this.paperMesh) return null
    this.setRay(clientX, clientY)
    const hit = this.raycaster.intersectObject(this.paperMesh, false)[0]
    if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return null
    const face = this.triFace[hit.faceIndex]
    if (face === undefined) return null
    const m = this.poseByFace.get(face)
    const local = hit.point.clone()
    if (m) local.applyMatrix4(m.clone().invert())
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
    const to: CamState = {
      tx: 0, ty: 0, azimuth: 0,
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
    this.clearPaper()
    this.paperMaterial.dispose()
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

  // ---- internals ---------------------------------------------------------

  private readonly resize = (): void => {
    if (this.disposed) return
    const rect = this.host.getBoundingClientRect()
    this.width = Math.max(1, Math.floor(rect.width))
    this.height = Math.max(1, Math.floor(rect.height))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(this.width, this.height, false)
    this.washiUniforms.uResolution.value.set(this.width * dpr, this.height * dpr)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
    this.invalidate()
  }

  private fitDistance(): number {
    return frameBounds(this.sheet, FOV_DEG, this.width / this.height).distance
  }

  private applyCamera(c: CamState): void {
    const [ox, oy, oz] = offsetFor(c.tilt, c.azimuth)
    this.camera.position.set(c.tx + ox * c.distance, c.ty + oy * c.distance, oz * c.distance)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(c.tx, c.ty, 0)
    this.camera.updateMatrixWorld(true)
    this.invalidate()
  }

  private setRay(clientX: number, clientY: number): void {
    const r = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1))
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(ndc, this.camera)
  }

  private clearPaper(): void {
    if (this.paperMesh) {
      this.scene.remove(this.paperMesh)
      this.paperMesh.geometry.dispose()
      this.paperMesh = null
    }
  }

  /**
   * Placeholder paper (Task 3 replaces it with the real mesh/materials/creases):
   * each face fan-triangulated and posed. Draws the preview's frame/poses when
   * a preview is active (engine contract R14), else the committed frame.
   */
  private rebuild(): void {
    const frame = this.preview ? this.preview.frame : this.frame
    const poses = this.preview ? this.preview.poses : this.poses
    this.clearPaper()
    this.triFace = []
    this.poseByFace = new Map()
    if (!frame) return this.invalidate()
    const coords = frame.vertices_coords ?? []
    const faces = frame.faces_vertices ?? []
    for (const p of poses) this.poseByFace.set(p.face, new THREE.Matrix4().fromArray(p.matrix))
    const pos: number[] = []
    const v = new THREE.Vector3()
    faces.forEach((fv, f) => {
      const m = this.poseByFace.get(f)
      for (let i = 1; i + 1 < fv.length; i++) {
        for (const k of [fv[0]!, fv[i]!, fv[i + 1]!]) {
          const c = coords[k]!
          v.set(c[0]!, c[1]!, 0)
          if (m) v.applyMatrix4(m)
          pos.push(v.x, v.y, v.z)
        }
        this.triFace.push(f)
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.computeVertexNormals()
    const mesh = new THREE.Mesh(g, this.paperMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.paperMesh = mesh
    this.scene.add(mesh)
    this.invalidate()
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
