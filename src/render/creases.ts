// Yoshizawa–Randlett diagram creases: valley dashed ┄┄, mountain dash-dot ┄·┄,
// in a soft ink, with a dash length that stays constant in screen space.
//
// GL lines are 1 device pixel wide (hairlines on a retina screen), so each
// crease set is an instanced screen-space quad mesh (`CreaseLines`), not a
// THREE.LineSegments: one instance per segment (aStart, aEnd in world space).
// The vertex shader projects both ends, expands the quad sideways by the line
// width in pixels, and hands the fragment shader the distance along the
// segment in pixels (interpolated linearly in screen space, see vDistW); the
// fragment shader cuts the dash pattern from it. Valley and mountain share the
// ink colour and differ by pattern (never by colour alone).
//
// Crease shading: a soft dark strip on each face along each folded hinge,
// its strength taken from the dihedral angle (buildCreaseShade).
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  Vector2,
  Vector4,
} from 'three'
import type { FacePose, Frame, Vec2 } from '@engine'
import { ccwLoop, edgeFaces, edgeKey, layerOffsets, LAYER_GAP, paperSize, poseTable } from './paperMesh'

/** Dash patterns, CSS px: valley [dash, gap]; mountain [dash, gap, dot, gap]. */
export const DASH = Object.freeze({
  valley: Object.freeze([6, 4]) as readonly number[],
  mountain: Object.freeze([6, 3, 1.5, 3]) as readonly number[],
})

export const INK = '#2B2A28'

export type CreaseStyle = {
  /** Ink over the paper's front (and over its back, unless colorBack). */
  color?: string
  colorBack?: string
  opacity?: number
  /** Line width, CSS px. */
  width?: number
  /** Draw over everything (the live crease). */
  onTop?: boolean
}

const VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec3 aNormal;     // front normal of the face the crease lies on
uniform vec2 uResolution;   // drawing buffer, device px
uniform float uPixelRatio;
uniform float uWidth;       // CSS px
varying float vDistW;
varying float vW;
varying float vSide;
varying float vFront;
void main() {
  vec4 mv0 = modelViewMatrix * vec4(aStart, 1.0);
  vFront = dot(normalMatrix * aNormal, -mv0.xyz) >= 0.0 ? 1.0 : 0.0;
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
  vec2 hres = 0.5 * uResolution;
  vec2 s0 = c0.xy / c0.w * hres;
  vec2 s1 = c1.xy / c1.w * hres;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float t = position.x;
  float side = position.y;
  vec4 c = mix(c0, c1, t);
  float halfW = 0.5 * uWidth * uPixelRatio + 0.75; // + AA feather
  c.xy += nrm * side * halfW / hres * c.w;
  // Perspective-correct interpolation of (dist * w) and w gives a ratio that is
  // linear in screen space: the dash length stays constant in pixels.
  vDistW = t * len * c.w;
  vW = c.w;
  vSide = side * halfW * c.w; // screen-linear too (divided by vW)
  gl_Position = c;
}
`

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uColorBack;
uniform float uOpacity;
uniform vec4 uDash;         // CSS px: dash, gap, dot, gap
uniform float uPixelRatio;
uniform float uWidth;
varying float vDistW;
varying float vW;
varying float vSide;
varying float vFront;
void main() {
  float dist = vDistW / vW / uPixelRatio; // CSS px along the segment
  float period = uDash.x + uDash.y + uDash.z + uDash.w;
  float m = mod(dist, period);
  float aa = 0.6;
  float dash = 1.0 - smoothstep(uDash.x - aa, uDash.x, m);
  float d0 = uDash.x + uDash.y;
  float dt = uDash.z > 0.0 ? smoothstep(d0 - aa, d0, m) * (1.0 - smoothstep(d0 + uDash.z - aa, d0 + uDash.z, m)) : 0.0;
  float on = max(dash, dt);
  float edge = 0.5 * uWidth * uPixelRatio;
  float across = 1.0 - smoothstep(edge - 0.25, edge + 0.75, abs(vSide / vW));
  float a = on * across * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uColorBack, uColor, step(0.5, vFront)), a);
  #include <colorspace_fragment>
}
`

/** One crease set (valley or mountain): an instanced screen-space quad per segment. */
export class CreaseLines extends Mesh<InstancedBufferGeometry, ShaderMaterial> {
  readonly isCreaseLines = true
  get segments(): number {
    return this.geometry.instanceCount
  }
  /** Keep the drawing-buffer size and pixel ratio current (Stage calls this on resize). */
  setViewport(width: number, height: number, pixelRatio: number): void {
    ;(this.material.uniforms.uResolution!.value as Vector2).set(width, height)
    this.material.uniforms.uPixelRatio!.value = pixelRatio
  }
  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

/** World-space segments → a CreaseLines mesh with `pattern`. */
export function makeCreaseLines(
  segments: Float32Array,
  pattern: readonly number[],
  style: CreaseStyle = {},
  normals?: Float32Array,
): CreaseLines {
  const count = segments.length / 6
  const g = new InstancedBufferGeometry()
  // Base quad: x = t along the segment (0..1), y = side (−1..1).
  g.setAttribute('position', new Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, 1, 0, 1, -1, 0], 3))
  g.setIndex([0, 1, 2, 0, 2, 3])
  const start = new Float32Array(3 * count)
  const end = new Float32Array(3 * count)
  for (let i = 0; i < count; i++) {
    start.set(segments.subarray(6 * i, 6 * i + 3), 3 * i)
    end.set(segments.subarray(6 * i + 3, 6 * i + 6), 3 * i)
  }
  g.setAttribute('aStart', new InstancedBufferAttribute(start, 3))
  g.setAttribute('aEnd', new InstancedBufferAttribute(end, 3))
  const nrm = normals ?? new Float32Array(3 * count).map((_, i) => (i % 3 === 2 ? 1 : 0))
  g.setAttribute('aNormal', new InstancedBufferAttribute(nrm, 3))
  g.instanceCount = count
  const onTop = style.onTop ?? false
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uResolution: { value: new Vector2(1, 1) },
      uPixelRatio: { value: 1 },
      uWidth: { value: style.width ?? 1.6 },
      uColor: { value: new Color(style.color ?? INK) },
      uColorBack: { value: new Color(style.colorBack ?? style.color ?? INK) },
      uOpacity: { value: style.opacity ?? 0.85 },
      uDash: { value: new Vector4(pattern[0] ?? 0, pattern[1] ?? 0, pattern[2] ?? 0, pattern[3] ?? 0) },
    },
    transparent: true,
    depthWrite: false,
    depthTest: !onTop,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  })
  const mesh = new CreaseLines(g, material)
  mesh.frustumCulled = false
  mesh.renderOrder = onTop ? 20 : 5
  return mesh
}

export type CreaseOptions = CreaseStyle & {
  /** Per-face offsets from layerOffsets (computed if absent). */
  offsets?: Float32Array
  levels?: readonly number[]
  /** Only edges touching these faces. */
  faces?: readonly number[]
}

/**
 * The frame's valley and mountain creases (edges assigned V / M), posed into
 * world space on the higher of the two faces they join.
 */
export function buildCreaseLines(
  frame: Frame,
  poses: readonly FacePose[],
  opts: CreaseOptions = {},
): { valley: CreaseLines; mountain: CreaseLines } {
  const table = poseTable(frame, poses)
  const lo = opts.offsets && opts.levels ? { offsets: opts.offsets, levels: opts.levels } : layerOffsets(frame, poses, LAYER_GAP)
  const ef = edgeFaces(frame)
  const only = opts.faces ? new Set(opts.faces) : null
  const valley: number[] = []
  const mountain: number[] = []
  const vN: number[] = []
  const mN: number[] = []
  const c = frame.vertices_coords
  frame.edges_vertices.forEach(([a, b], e) => {
    const asg = frame.edges_assignment[e]
    const isV = asg === 'V' || asg === 'v'
    const isM = asg === 'M' || asg === 'm'
    if (!isV && !isM) return
    let faces = ef.get(edgeKey(frame, a, b)) ?? []
    if (only) faces = faces.filter(f => only.has(f))
    if (!faces.length) return
    const f = faces.reduce((best, g) => (lo.levels[g]! > lo.levels[best]! ? g : best), faces[0]!)
    const m = table[f]!
    const out = isV ? valley : mountain
    ;(isV ? vN : mN).push(m[8]!, m[9]!, m[10]!)
    for (const v of [a, b]) {
      const [x, y] = c[v]!
      out.push(
        m[0]! * x + m[4]! * y + m[12]! + lo.offsets[3 * f]!,
        m[1]! * x + m[5]! * y + m[13]! + lo.offsets[3 * f + 1]!,
        m[2]! * x + m[6]! * y + m[14]! + lo.offsets[3 * f + 2]!,
      )
    }
  })
  return {
    valley: makeCreaseLines(new Float32Array(valley), DASH.valley, opts, new Float32Array(vN)),
    mountain: makeCreaseLines(new Float32Array(mountain), DASH.mountain, opts, new Float32Array(mN)),
  }
}

/** The live crease (Preview.crease, world z = 0 segments) in the accent colour, over everything. */
export function buildLiveCrease(crease: readonly (readonly [Vec2, Vec2])[], kind: 'valley' | 'mountain', color: string, z = 0): CreaseLines {
  const seg = new Float32Array(6 * crease.length)
  crease.forEach(([p, q], i) => seg.set([p[0], p[1], z, q[0], q[1], z], 6 * i))
  return makeCreaseLines(seg, DASH[kind], { color, opacity: 0.95, width: 2, onTop: true })
}

/**
 * Crease shading: on each face, along each folded hinge it has (V/M edge with
 * a non-zero fold angle), a strip fading from the hinge inward, alpha
 * ∝ |dihedral| / 180. Vertex colours are RGBA (ink with alpha).
 */
export function buildCreaseShade(
  frame: Frame,
  poses: readonly FacePose[],
  opts: { offsets?: Float32Array; faces?: readonly number[]; strength?: number } = {},
): BufferGeometry {
  const table = poseTable(frame, poses)
  const offsets = opts.offsets ?? layerOffsets(frame, poses, LAYER_GAP).offsets
  const only = opts.faces ? new Set(opts.faces) : null
  const { width, height } = paperSize(frame)
  const reach = 0.035 * Math.min(width, height)
  const strength = opts.strength ?? 0.16
  const angle = new Map<number, number>()
  frame.edges_vertices.forEach(([a, b], e) => {
    const asg = frame.edges_assignment[e]
    if (!/^[VMvm]$/.test(asg ?? '')) return
    const deg = Math.abs(frame.edges_foldAngle[e] ?? 0)
    if (deg > 1e-6) angle.set(edgeKey(frame, a, b), deg)
  })
  const pos: number[] = []
  const col: number[] = []
  const c = frame.vertices_coords
  if (angle.size) {
    frame.faces_vertices.forEach((_, f) => {
      if (only && !only.has(f)) return
      const loop = ccwLoop(frame, f)
      let cx = 0, cy = 0
      for (const v of loop) { cx += c[v]![0]; cy += c[v]![1] }
      cx /= loop.length; cy /= loop.length
      const m = table[f]!
      const ox = offsets[3 * f]!, oy = offsets[3 * f + 1]!, oz = offsets[3 * f + 2]!
      const world = (x: number, y: number) => [
        m[0]! * x + m[4]! * y + m[12]! + ox,
        m[1]! * x + m[5]! * y + m[13]! + oy,
        m[2]! * x + m[6]! * y + m[14]! + oz,
      ]
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!, b = loop[(i + 1) % loop.length]!
        const deg = angle.get(edgeKey(frame, a, b))
        if (deg === undefined) continue
        const p: Vec2 = c[a]!, q: Vec2 = c[b]!
        const ex = q[0] - p[0], ey = q[1] - p[1]
        const len = Math.hypot(ex, ey)
        if (len < 1e-12) continue
        // inward normal (towards the centroid)
        let nx = -ey / len, ny = ex / len
        const toC = (cx - p[0]) * nx + (cy - p[1]) * ny
        if (toC < 0) { nx = -nx; ny = -ny }
        const w = Math.min(reach, Math.abs(toC) * 0.45)
        if (w <= 1e-9) continue
        const alpha = strength * Math.min(1, deg / 180)
        const P0 = world(p[0], p[1]), P1 = world(q[0], q[1])
        const Q1 = world(q[0] + nx * w, q[1] + ny * w), Q0 = world(p[0] + nx * w, p[1] + ny * w)
        for (const [pt, al] of [[P0, alpha], [P1, alpha], [Q1, 0], [P0, alpha], [Q1, 0], [Q0, 0]] as const) {
          pos.push(pt[0]!, pt[1]!, pt[2]!)
          col.push(0.17, 0.165, 0.157, al)
        }
      }
    })
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new Float32BufferAttribute(col, 4))
  return g
}

/** Material for buildCreaseShade geometry. */
export function makeShadeMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  })
}
