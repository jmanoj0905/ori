import * as THREE from 'three'

export const IVORY = '#F4EFE6'

/**
 * Shadow map size. Low-end (<= 4 logical cores, or <= 4 GB reported memory)
 * gets 1024; everything else 2048. `deviceMemory` is Chromium-only, so cores
 * is the main signal; unknown values count as desktop.
 */
export function shadowMapSizeFor(env: { cores?: number; memoryGB?: number }): 1024 | 2048 {
  if (env.cores !== undefined && env.cores <= 4) return 1024
  if (env.memoryGB !== undefined && env.memoryGB <= 4) return 1024
  return 2048
}

export function detectShadowMapSize(): 1024 | 2048 {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number })
  return shadowMapSizeFor({ cores: nav?.hardwareConcurrency, memoryGB: nav?.deviceMemory })
}

const FIBRE_GLSL = /* glsl */ `
float wHash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float wNoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(wHash(i), wHash(i+vec2(1,0)), f.x), mix(wHash(i+vec2(0,1)), wHash(i+vec2(1,1)), f.x), f.y);
}
// One layer of long thin strands at a given angle: noise stretched ~40:1.
float wStrands(vec2 p, float ang, float scale){
  float c = cos(ang), s = sin(ang);
  vec2 q = vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  return wNoise(vec2(q.x*scale*0.025, q.y*scale));
}
float washiFibre(vec2 p){
  float a = wStrands(p, 0.35, 90.0);
  float b = wStrands(p + 7.3, -0.9, 70.0);
  float c = wStrands(p + 13.1, 1.7, 110.0);
  float cloud = wNoise(p*3.0);
  float strands = (a + b + c) / 3.0 - 0.5;
  return strands * 1.0 + (cloud - 0.5) * 0.35;
}
`

export type WashiUniforms = { uResolution: { value: THREE.Vector2 } }

/**
 * The washi desk: one large plane. It is a MeshStandardMaterial (so it takes
 * the studio light and shadows: it is the shadow catcher) patched with a
 * procedural kozo-fibre term (long thin low-contrast strands) on the ivory base
 * and a soft screen-space vignette.
 */
export function createWashi(): { mesh: THREE.Mesh; uniforms: WashiUniforms } {
  const uniforms: WashiUniforms = { uResolution: { value: new THREE.Vector2(1, 1) } }
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(IVORY), roughness: 1, metalness: 0 })
  material.onBeforeCompile = shader => {
    shader.uniforms.uResolution = uniforms.uResolution
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vDesk;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDesk = position.xy;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FIBRE_GLSL}\nvarying vec2 vDesk;\nuniform vec2 uResolution;\nvoid main() {`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= 1.0 + washiFibre(vDesk) * 0.05;')
      .replace(
        '#include <dithering_fragment>',
        `vec2 vq = gl_FragCoord.xy / uResolution - 0.5;
  gl_FragColor.rgb *= 1.0 - smoothstep(0.25, 0.95, length(vq * vec2(1.0, 1.1))) * 0.14;
  #include <dithering_fragment>`,
      )
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), material)
  mesh.receiveShadow = true
  mesh.position.z = -0.002
  return { mesh, uniforms }
}
