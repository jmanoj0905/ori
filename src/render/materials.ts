// The four paper materials (spec 02): kami two-tone, patterned washi, plain
// white, and the full editor. Each is a front-face / back-face pair of matte
// MeshStandardMaterials: the paper mesh is drawn twice (FrontSide with
// `front`, BackSide with `back`), so a face mirrored by a fold shows the other
// side automatically. Textures are in paper coordinates (the mesh's uv is
// paper coord / paper size), so patterns stay fixed to the sheet.
//
// Washi patterns (seigaiha, asanoha) are drawn on a canvas (browser only;
// node tests get no texture). The kozo-fibre term is the desk's procedural
// fibre, injected via onBeforeCompile and sampled in paper space.
// Translucency (editor) is not implemented (spec: optional, may be cut).
import {
  BackSide,
  CanvasTexture,
  Color,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'
import type { PaperSettings, SheetSize } from '../studio/store'
import { FIBRE_GLSL } from './washi'

/** Accent (live crease, ghost) and the warm-red "blocked" tint (tokens.css). */
export const ACCENT = '#B23A22'
export const BLOCKED = '#E2553B'
export const KAMI_BACK = '#FFFFFF'
const WASHI_BACK = '#F8F4EC'
const PLAIN_FRONT = '#FCFCFA'
const PLAIN_BACK = '#F4F4F1'

export type PaperMaterials = { front: MeshStandardMaterial; back: MeshStandardMaterial }

/** Paper height / width for a sheet size. */
export function sheetAspect(size: SheetSize): number {
  if (size === 'square') return 1
  if (size === 'a4') return Math.SQRT2
  return size.width > 0 && size.height > 0 ? size.height / size.width : 1
}

type Look = { color: string; pattern?: 'seigaiha' | 'asanoha'; fibre: number; roughness: number }

function looks(s: PaperSettings): { front: Look; back: Look } {
  switch (s.mode) {
    case 'washi':
      return {
        front: { color: s.front, pattern: s.pattern ?? 'seigaiha', fibre: 0.06, roughness: 0.95 },
        back: { color: WASHI_BACK, fibre: 0.06, roughness: 0.95 },
      }
    case 'plain':
      return {
        front: { color: PLAIN_FRONT, fibre: 0, roughness: 0.95 },
        back: { color: PLAIN_BACK, fibre: 0, roughness: 0.95 },
      }
    case 'custom':
      return {
        front: { color: s.front, pattern: s.pattern, fibre: 0.04, roughness: 0.92 },
        back: { color: s.back, fibre: 0.04, roughness: 0.92 },
      }
    case 'kami':
    default:
      // The back of kami is always white.
      return {
        front: { color: s.front, fibre: 0.015, roughness: 0.85 },
        back: { color: KAMI_BACK, fibre: 0.015, roughness: 0.88 },
      }
  }
}

/** Patch a standard material with the kozo-fibre term in paper space. */
function withFibre(m: MeshStandardMaterial, amount: number, aspect: number): MeshStandardMaterial {
  if (amount <= 0) return m
  m.onBeforeCompile = shader => {
    shader.uniforms.uFibre = { value: amount }
    shader.uniforms.uAspect = { value: aspect }
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vPaperUv;\nvoid main() {')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vPaperUv = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FIBRE_GLSL}\nvarying vec2 vPaperUv;\nuniform float uFibre;\nuniform float uAspect;\nvoid main() {`)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  diffuseColor.rgb *= 1.0 + washiFibre(vPaperUv * vec2(1.0, uAspect) * 1.6) * uFibre;',
      )
  }
  m.customProgramCacheKey = () => 'ori-paper-fibre'
  return m
}

function material(look: Look, side: typeof FrontSide | typeof BackSide, aspect: number): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: new Color(look.color),
    roughness: look.roughness,
    metalness: 0,
    side,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  m.shadowSide = DoubleSide
  if (look.pattern) {
    const tex = patternTexture(look.pattern, look.color, aspect)
    if (tex) {
      m.map = tex
      m.color.set('#FFFFFF')
    }
  }
  return withFibre(m, look.fibre, aspect)
}

/** Front-side and back-side materials for the paper settings. */
export function makeMaterials(s: PaperSettings): PaperMaterials {
  const aspect = sheetAspect(s.size)
  const l = looks(s)
  return { front: material(l.front, FrontSide, aspect), back: material(l.back, BackSide, aspect) }
}

export function disposeMaterials(m: PaperMaterials): void {
  m.front.map?.dispose()
  m.back.map?.dispose()
  m.front.dispose()
  m.back.dispose()
}

/** The side colours (for the ghost and for choosing an ink that reads on the paper). */
export function sideColors(s: PaperSettings): { front: string; back: string } {
  const l = looks(s)
  return { front: l.front.color, back: l.back.color }
}

export const luminance = (hex: string): number => {
  const c = new Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b // linear
}

// ---- ghost (preview flap) -------------------------------------------------

export type GhostMaterials = {
  front: MeshStandardMaterial
  back: MeshStandardMaterial
  /** Faint, depth-test-free pass so a flap swinging under the sheet stays visible. */
  xray: MeshBasicMaterial
}

export function makeGhostMaterials(): GhostMaterials {
  const make = (side: typeof FrontSide | typeof BackSide) =>
    new MeshStandardMaterial({
      color: new Color(ACCENT),
      roughness: 0.9,
      metalness: 0,
      side,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  const xray = new MeshBasicMaterial({ color: new Color(ACCENT), transparent: true, opacity: 0.14, depthTest: false, depthWrite: false, side: DoubleSide })
  return { front: make(FrontSide), back: make(BackSide), xray }
}

/** Tint the ghost: the paper's sides mixed toward the accent, or toward warm red when blocked. */
export function tintGhost(g: GhostMaterials, sides: { front: string; back: string }, blocked: boolean, fade = 1): void {
  const tint = new Color(blocked ? BLOCKED : ACCENT)
  const k = blocked ? 0.6 : 0.35
  g.front.color.set(sides.front).lerp(tint, k)
  g.back.color.set(sides.back).lerp(tint, k)
  const o = (blocked ? 0.72 : 0.6) * fade
  g.front.opacity = o
  g.back.opacity = o
  g.xray.color.copy(tint)
  g.xray.opacity = (blocked ? 0.2 : 0.14) * fade
}

export function disposeGhost(g: GhostMaterials): void {
  g.front.dispose()
  g.back.dispose()
  g.xray.dispose()
}

// ---- washi patterns ---------------------------------------------------------

function patternTexture(kind: 'seigaiha' | 'asanoha', base: string, aspect: number): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext?.('2d')
  if (!ctx) return null
  const W = 1024
  const H = kind === 'asanoha' ? Math.round(4 * 128 * Math.sqrt(3)) : 1024
  canvas.width = W
  canvas.height = H
  const bg = new Color(base)
  const light = luminance(base) < 0.35
  const line = bg.clone().lerp(new Color(light ? '#FFFFFF' : '#2B2A28'), light ? 0.42 : 0.22)
  ctx.fillStyle = `#${bg.getHexString()}`
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = `#${line.getHexString()}`
  ctx.lineCap = 'round'
  if (kind === 'seigaiha') drawSeigaiha(ctx, W, H, `#${bg.getHexString()}`)
  else drawAsanoha(ctx, W, H)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.anisotropy = 4
  // uv spans 0..1 on both axes; keep the motif square on non-square sheets.
  tex.repeat.set(1, aspect * (W / H))
  return tex
}

/** Seigaiha: overlapping fans of concentric arcs, rows offset by half a fan. Tiles on W × H. */
function drawSeigaiha(ctx: CanvasRenderingContext2D, W: number, H: number, bg: string): void {
  const R = W / 20 // 10 fans across
  ctx.lineWidth = R * 0.075
  const rows = Math.round(H / (R / 2))
  for (let j = -2; j <= rows + 2; j++) {
    const y = j * (R / 2)
    const off = j % 2 === 0 ? 0 : R
    for (let x = -2 * R + off; x <= W + 2 * R; x += 2 * R) {
      ctx.fillStyle = bg
      ctx.beginPath()
      ctx.arc(x, y, R, 0, Math.PI * 2)
      ctx.fill()
      for (const r of [0.9, 0.68, 0.46, 0.24]) {
        ctx.beginPath()
        ctx.arc(x, y, R * r, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }
}

/** Asanoha: a triangle lattice with spokes from each corner to the centroid. Tiles on W × H. */
function drawAsanoha(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const s = W / 8
  const h = (s * Math.sqrt(3)) / 2
  ctx.lineWidth = s * 0.03
  const pt = (i: number, j: number): [number, number] => [i * s + (j % 2 !== 0 ? s / 2 : 0), j * h]
  const seg = (a: [number, number], b: [number, number]) => {
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
  }
  ctx.beginPath()
  const rows = Math.ceil(H / h)
  for (let j = -1; j <= rows + 1; j++) {
    for (let i = -1; i <= 9; i++) {
      const a = pt(i, j)
      const b = pt(i + 1, j)
      // the row below's apex between a and b
      const odd = j % 2 !== 0
      const c = odd ? pt(i + 1, j + 1) : pt(i, j + 1)
      const d = odd ? pt(i + 2, j + 1) : pt(i + 1, j + 1)
      for (const tri of [[a, b, c], [b, d, c]] as [number, number][][]) {
        const cx = (tri[0]![0] + tri[1]![0] + tri[2]![0]) / 3
        const cy = (tri[0]![1] + tri[1]![1] + tri[2]![1]) / 3
        seg(tri[0]!, tri[1]!)
        seg(tri[1]!, tri[2]!)
        seg(tri[2]!, tri[0]!)
        for (const p of tri) seg(p, [cx, cy])
      }
    }
  }
  ctx.stroke()
}
