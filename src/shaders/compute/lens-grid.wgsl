// Lens pass 1: deflection (cored isothermal ellipsoids plus shear) at every vertex of the
// image-plane grid, giving each vertex its source-plane position beta = x - alpha(x), and the
// extent of the grid in the source plane (ADR 0008). Reference: lensModel and the first loop of
// lensSolver (app23.js:L594-612).
//
// Entry points:
//   grid_vertices  one vertex: (x, y, beta_x, beta_y) into `verts`, and its beta into the extent
//                  as ordered u32 keys, with atomicMin and atomicMax, which commute: the extent
//                  does not depend on scheduling;
//   grid_finish    ONE invocation: the extent decoded, and the bin size (v21's `(bx1 - bx0) / H || 1`).
//
// A non-singular isothermal ellipsoid (Keeton 2001): atan and atanh of the rotated, scaled
// position. atanh is written out as a logarithm. CPU twin: src/fallback/kernels/lens.ts
// `deflectF`, `gridKernel`.

// #import "common/lens-types.wgsl"

struct Job {
  // the solver this dispatch works on
  s: u32,
}

@group(0) @binding(0) var<storage, read_write> solvers: array<Solver>;
@group(0) @binding(1) var<storage, read> halos: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> verts: array<vec4<f32>>;
// per solver: min beta_x, max beta_x, min beta_y, max beta_y, as ordered keys
@group(0) @binding(3) var<storage, read_write> ext: array<atomic<u32>>;
@group(0) @binding(4) var<uniform> job: Job;

// A float as a u32 whose unsigned order is the float's order.
fn ordered_key(x: f32) -> u32 {
  let b = bitcast<u32>(x);
  if ((b & 0x80000000u) != 0u) {
    return ~b;
  }
  return b | 0x80000000u;
}

fn from_ordered_key(k: u32) -> f32 {
  if ((k & 0x80000000u) != 0u) {
    return bitcast<f32>(k & 0x7fffffffu);
  }
  return bitcast<f32>(~k);
}

fn deflect(S: Solver, x: f32, y: f32) -> vec2<f32> {
  var ax = 0.0;
  var ay = 0.0;
  for (var k = 0u; k < S.n_halo; k++) {
    let h0 = halos[S.hbase + 3u * k];
    let h1 = halos[S.hbase + 3u * k + 1u];
    let ca = h0.z;
    let sa = h0.w;
    let dx = x - h0.x;
    let dy = y - h0.y;
    let u = dx * ca + dy * sa;
    let v = -dx * sa + dy * ca;
    let q = h1.x;
    let s = h1.y;
    let e = h1.z;
    let kk = h1.w;
    let q2 = q * q;
    let ps = sqrt(q2 * (s * s + u * u) + v * v);
    let au = kk * atan(e * u / (ps + s));
    let t = clamp(e * v / (ps + q2 * s), -0.999999, 0.999999);
    let av = kk * (0.5 * log((1.0 + t) / (1.0 - t)));
    ax = ax + (au * ca - av * sa);
    ay = ay + (au * sa + av * ca);
  }
  ax = ax + S.sh_g * (S.sh_c2 * x + S.sh_s2 * y);
  ay = ay + S.sh_g * (S.sh_s2 * x - S.sh_c2 * y);
  return vec2<f32>(ax * S.f, ay * S.f);
}

@compute @workgroup_size(64)
fn grid_vertices(@builtin(global_invocation_id) id: vec3<u32>) {
  let S = solvers[job.s];
  let i = id.x;
  if (i >= S.n * S.n) {
    return;
  }
  let ix = i % S.n;
  let iy = i / S.n;
  let g = f32(S.g);
  let x = -S.r + 2.0 * S.r * f32(ix) / g;
  let y = -S.r + 2.0 * S.r * f32(iy) / g;
  let a = deflect(S, x, y);
  let bx = x - a.x;
  let by = y - a.y;
  verts[S.vbase + i] = vec4<f32>(x, y, bx, by);
  let e = job.s * 4u;
  atomicMin(&ext[e], ordered_key(bx));
  atomicMax(&ext[e + 1u], ordered_key(bx));
  atomicMin(&ext[e + 2u], ordered_key(by));
  atomicMax(&ext[e + 3u], ordered_key(by));
}

@compute @workgroup_size(1)
fn grid_finish() {
  let e = job.s * 4u;
  let bx0 = from_ordered_key(atomicLoad(&ext[e]));
  let bx1 = from_ordered_key(atomicLoad(&ext[e + 1u]));
  let by0 = from_ordered_key(atomicLoad(&ext[e + 2u]));
  let by1 = from_ordered_key(atomicLoad(&ext[e + 3u]));
  let h = f32(solvers[job.s].g);
  var cw = (bx1 - bx0) / h;
  var ch = (by1 - by0) / h;
  if (cw == 0.0) {
    cw = 1.0;
  }
  if (ch == 0.0) {
    ch = 1.0;
  }
  solvers[job.s].bx0 = bx0;
  solvers[job.s].by0 = by0;
  solvers[job.s].cw = cw;
  solvers[job.s].ch = ch;
}
