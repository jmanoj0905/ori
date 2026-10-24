// XPBD sheet solver on the GPU (Plan 6 Task 3): the same substep as the CPU
// reference (src/soft/xpbd.ts), one kernel per pass. A constraint pass runs
// one colour (no two constraints of a colour share a particle), so the
// threads never write the same particle and the result equals the CPU's
// Gauss–Seidel order. Particles are vec4: xyz, and w = the inverse mass in
// force (0 when pinned).

struct Sim {
  gravity: vec4<f32>, // xyz; w: the desk's z
  h: f32,             // substep
  keep: f32,          // velocity damping factor per substep
  n: u32,             // particles
  floorOn: u32,       // 1: no particle goes below the desk
}

struct Range {
  start: u32,
  count: u32,
}

@group(0) @binding(0) var<uniform> sim: Sim;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> prev: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> vel: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> pinT: array<vec4<f32>>;
// distance constraints: particle a, particle b, the rest length's bits, unused
@group(0) @binding(5) var<storage, read> dist: array<vec4<u32>>;
@group(0) @binding(6) var<storage, read> hinge: array<vec4<u32>>;
// per hinge: rest angle, compliance (negative: disabled), unused, unused
@group(0) @binding(7) var<storage, read> hingeData: array<vec4<f32>>;
@group(1) @binding(0) var<uniform> range: Range;

@compute @workgroup_size(64)
fn predict(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.n) { return; }
  let p = pos[i];
  prev[i] = p;
  if (pinT[i].w > 0.5) {
    pos[i] = vec4<f32>(pinT[i].xyz, p.w);
    return;
  }
  if (p.w == 0.0) { return; }
  let v = vel[i].xyz + sim.gravity.xyz * sim.h;
  vel[i] = vec4<f32>(v, 0.0);
  pos[i] = vec4<f32>(p.xyz + v * sim.h, p.w);
}

@compute @workgroup_size(64)
fn distances(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= range.count) { return; }
  let c = range.start + id.x;
  let e = dist[c];
  let pa = pos[e.x];
  let pb = pos[e.y];
  let wa = pa.w;
  let wb = pb.w;
  if (wa + wb == 0.0) { return; }
  let d = pa.xyz - pb.xyz;
  let l = length(d);
  if (l < 1e-12) { return; }
  let s = -(l - bitcast<f32>(e.z)) / (wa + wb) / l;
  pos[e.x] = vec4<f32>(pa.xyz + wa * s * d, wa);
  pos[e.y] = vec4<f32>(pb.xyz - wb * s * d, wb);
}

const PI = 3.14159265358979;

fn wrapAngle(x: f32) -> f32 {
  return x - 2.0 * PI * round(x / (2.0 * PI));
}

@compute @workgroup_size(64)
fn hinges(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= range.count) { return; }
  let c = range.start + id.x;
  let alpha = hingeData[c].y;
  if (alpha < 0.0) { return; } // disabled (infinite compliance)
  let q = hinge[c];
  let A = pos[q.x];
  let B = pos[q.y];
  let C = pos[q.z];
  let D = pos[q.w];
  let x3 = A.xyz;
  let x4 = B.xyz;
  let x1 = C.xyz;
  let x2 = D.xyz;
  let e = x4 - x3;
  let n1 = cross(x1 - x3, x1 - x4);
  let n2 = cross(x2 - x4, x2 - x3);
  let el = length(e);
  let l1 = dot(n1, n1);
  let l2 = dot(n2, n2);
  if (el < 1e-12 || l1 < 1e-24 || l2 < 1e-24) { return; }
  let theta = -atan2(dot(cross(n1, n2), e) / el, dot(n1, n2));
  let m1 = n1 / l1;
  let m2 = n2 / l2;
  let ga = dot(x1 - x4, e) / el * m1 + dot(x2 - x4, e) / el * m2;
  let gb = -dot(x1 - x3, e) / el * m1 - dot(x2 - x3, e) / el * m2;
  let gc = el * m1;
  let gd = el * m2;
  let Cv = wrapAngle(theta - hingeData[c].x);
  let denom = A.w * dot(ga, ga) + B.w * dot(gb, gb) + C.w * dot(gc, gc) + D.w * dot(gd, gd);
  let at = alpha / (sim.h * sim.h);
  if (denom + at < 1e-12) { return; }
  let dl = -Cv / (denom + at);
  pos[q.x] = vec4<f32>(x3 + A.w * dl * ga, A.w);
  pos[q.y] = vec4<f32>(x4 + B.w * dl * gb, B.w);
  pos[q.z] = vec4<f32>(x1 + C.w * dl * gc, C.w);
  pos[q.w] = vec4<f32>(x2 + D.w * dl * gd, D.w);
}

@compute @workgroup_size(64)
fn velocities(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.n) { return; }
  var p = pos[i];
  if (sim.floorOn == 1u && p.z < sim.gravity.w) {
    // on the desk: held there, and most of the slide taken back (friction, as xpbd.ts DESK_FRICTION)
    let q = prev[i];
    p = vec4<f32>(q.x + (p.x - q.x) * 0.1, q.y + (p.y - q.y) * 0.1, sim.gravity.w, p.w);
    pos[i] = p;
  }
  vel[i] = vec4<f32>((p.xyz - prev[i].xyz) / sim.h * sim.keep, 0.0);
}
