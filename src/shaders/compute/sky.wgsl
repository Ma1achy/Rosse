// The deep field and the foreground stars (skyParts, app23.js:L878-912), view tier. CPU twin:
// src/fallback/kernels/sky.ts, function for function; the catalogue is src/model/sky.ts.
//
// Entry points, in dispatch order:
//   sky_cull   one background galaxy of the catalogue through the perspective camera (CAM 30):
//              dropped when nearer than 2 units to the camera or within 0.8 magnification, off the
//              plate by more than 120 zoom/84 px, or bigger than 140 px; else its plate position,
//              magnification, apparent radius and dot count np = clamp(2.2 appR, 10, 150) go to
//              `vis_in` (as an Instance: pos q, layer b, alpha k, m = (appR, np)) and its key to
//              `keys` for the compaction (compute/scan.wgsl, one class, in catalogue order);
//   sky_dots   one dot slot of a visible galaxy (slot = g * 150 + j): a point of a small 3D galaxy
//              (a bulge fraction, else a disc with half its points on two logarithmic arms and a
//              thin z) in its own plane, projected with the perspective camera, a dots sprite
//              (L891-899); numbers from the `skyDots` stream, index b * 256 + j. A slot past np is
//              a zero instance (it draws nothing);
//   rows_sky   one row of the dynamic vector set of the galaxies' drawings (row = g * 3 + a): the
//              drawing laid on the same plane at pen scale 0.42 (orient, sheared round the mass
//              when `massive`, an `arms` drawing copied na times: L901-904), for compute/vector-expand;
//   sky_fg     one foreground star: a sprite, or a zero instance when it is culled (L908-912).
//
// Weak lensing of the field (v21 LENSWL, L1273-1278) is M9's: `weak_lens` is where it acts on a
// row; it is the identity today.

// #import "common/camera.wgsl"
// #import "common/instance.wgsl"
// #import "common/vinst.wgsl"
// #import "common/rng.wgsl"
// #import "common/math.wgsl"
// #import "common/noise-table.wgsl"
// #import "common/warp.wgsl"

struct SkyU {
  n_bg: u32,
  n_fg: u32,
  key: u32,
  n_dot_pool: u32,
  // the most galaxies a view holds
  vis_cap: u32,
  massive: u32,
  wobble: f32,
  pad0: u32,
  // the rows' strides of the drawings (src/model/dynvec.ts)
  stride_c: u32,
  stride_d: u32,
  stride_b: u32,
  pad1: u32,
}

const STREAM_SKY_DOTS: u32 = 17u;
const KNOT_POOL: u32 = 24u;
const DOTS_PER_GALAXY: u32 = 150u;
const DOT_STRIDE: u32 = 256u;
const ARMS_FLAG: u32 = 0x80000000u;
const CLS_KEEP: u32 = 0u;
const CLS_DROP: u32 = 255u;
const PLATE_HALF: f32 = 400.0;
const PLATE_W: f32 = 800.0;

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<uniform> su: SkyU;
// per galaxy 3 vec4: (w, rad), (n, spin), (item bits, na, bulge, 0)
@group(0) @binding(2) var<storage, read> bg: array<vec4<f32>>;
// per foreground star 2 vec4: (w, size), (rot, tile bits, 0, 0)
@group(0) @binding(3) var<storage, read> fg: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> items: array<u32>;
@group(0) @binding(5) var<storage, read> pool: array<u32>;
@group(0) @binding(6) var<storage, read> dot_base: array<f32>;
@group(0) @binding(7) var<storage, read_write> vis_in: array<Instance>;
@group(0) @binding(8) var<storage, read_write> keys: array<u32>;
@group(0) @binding(9) var<storage, read> vis: array<Instance>;
@group(0) @binding(10) var<storage, read> vargs: array<u32>;
@group(0) @binding(11) var<storage, read_write> dots_out: array<Instance>;
@group(0) @binding(12) var<storage, read_write> fg_out: array<Instance>;
@group(0) @binding(13) var<storage, read_write> inst: array<VInst>;

// toView (app23.js:L859): the orbit and tilt without the mirror
fn to_view(w: vec3<f32>) -> vec3<f32> {
  let x = w.x * view.cos_az - w.y * view.sin_az;
  let y = w.x * view.sin_az + w.y * view.cos_az;
  return vec3<f32>(x, y * view.cos_i - w.z * view.sin_i, y * view.sin_i + w.z * view.cos_i);
}

fn sky_screen(v: vec3<f32>, k: f32) -> vec2<f32> {
  return to_screen(view, v.xy, k);
}

struct Cull {
  ok: bool,
  q: vec2<f32>,
  k: f32,
  app_r: f32,
  np: u32,
}

fn cull(b: u32) -> Cull {
  let g0 = bg[b * 3u];
  let v = to_view(g0.xyz);
  let depth = CAM_DISTANCE - v.z;
  var none = Cull(false, vec2<f32>(0.0), 0.0, 0.0, 0u);
  if (depth < 2.0) {
    return none;
  }
  let k = CAM_DISTANCE / depth;
  if (k > 0.8) {
    return none;
  }
  let sc = view.scale;
  let zf = sc / 84.0;
  let q = sky_screen(v, k);
  let m = 120.0 * zf;
  if (!(q.x > -m && q.x < PLATE_W + m && q.y > -m && q.y < PLATE_W + m)) {
    return none;
  }
  let app_r = (g0.w * k) * sc;
  if (app_r > 140.0) {
    return none;
  }
  let np = u32(clamp(floor(app_r * 2.2 + 0.5), 10.0, 150.0));
  return Cull(true, q, k, app_r, np);
}

@compute @workgroup_size(64)
fn sky_cull(@builtin(global_invocation_id) id: vec3<u32>) {
  let b = id.x;
  if (b >= su.n_bg) {
    return;
  }
  let c = cull(b);
  vis_in[b] = Instance(c.q, b, c.k, vec4<f32>(c.app_r, f32(c.np), 0.0, 0.0));
  keys[b] = select(CLS_DROP, CLS_KEEP, c.ok);
}

// the basis of the plane with normal n (app23.js:L861)
fn plane_basis(n: vec3<f32>, e1: ptr<function, vec3<f32>>, e2: ptr<function, vec3<f32>>) {
  var a = vec3<f32>(1.0, 0.0, 0.0);
  if (abs(n.z) < 0.9) {
    a = vec3<f32>(0.0, 0.0, 1.0);
  }
  let c = vec3<f32>(n.y * a.z - n.z * a.y, n.z * a.x - n.x * a.z, n.x * a.y - n.y * a.x);
  let l = sqrt(c.x * c.x + c.y * c.y + c.z * c.z);
  let u = vec3<f32>(c.x / l, c.y / l, c.z / l);
  *e1 = u;
  *e2 = vec3<f32>(n.y * u.z - n.z * u.y, n.z * u.x - n.x * u.z, n.x * u.y - n.y * u.x);
}

@compute @workgroup_size(64)
fn sky_dots(@builtin(global_invocation_id) id: vec3<u32>) {
  let s = id.x;
  if (s >= su.vis_cap * DOTS_PER_GALAXY) {
    return;
  }
  dots_out[s] = Instance(vec2<f32>(0.0), 0u, 0.0, vec4<f32>(0.0));
  let g = s / DOTS_PER_GALAXY;
  let j = s % DOTS_PER_GALAXY;
  if (g >= min(vargs[1], su.vis_cap)) {
    return;
  }
  let V = vis[g];
  if (j >= u32(V.m.y)) {
    return;
  }
  let b = V.layer;
  let g0 = bg[b * 3u];
  let g1 = bg[b * 3u + 1u];
  let g2 = bg[b * 3u + 2u];
  let idx = b * DOT_STRIDE + j;
  var lx = 0.0;
  var ly = 0.0;
  var lz = 0.0;
  if (rand_f32(su.key, STREAM_SKY_DOTS, idx, 0u) < g2.z) {
    // the bulge: a Hernquist-like radius, a point of the sphere, flattened to 0.8 in z
    let sq = sqrt(min(rand_f32(su.key, STREAM_SKY_DOTS, idx, 1u), 0.97));
    let br = (0.18 * sq) / (1.0 - sq);
    let z = 2.0 * rand_f32(su.key, STREAM_SKY_DOTS, idx, 2u) - 1.0;
    let t = rand_f32(su.key, STREAM_SKY_DOTS, idx, 3u) * 6.28318;
    let q = sqrt(1.0 - z * z);
    lx = (q * cos_f(t)) * br;
    ly = (q * sin_f(t)) * br;
    lz = (z * br) * 0.8;
  } else {
    // the disc: an exponential radius; a half of the points on two logarithmic arms
    var R2 = -0.35 * log(rand_f32(su.key, STREAM_SKY_DOTS, idx, 1u) * rand_f32(su.key, STREAM_SKY_DOTS, idx, 2u) + 1e-9);
    var th = rand_f32(su.key, STREAM_SKY_DOTS, idx, 3u) * 6.28;
    if (rand_f32(su.key, STREAM_SKY_DOTS, idx, 4u) < 0.55) {
      th = ((log(R2 / 0.08 + 1.0) / 0.45) + 3.14159265358979 * floor(rand_f32(su.key, STREAM_SKY_DOTS, idx, 5u) * 2.0)) +
        rand_gauss_f(su.key, STREAM_SKY_DOTS, idx, 6u) * 0.35;
    }
    R2 = min(R2, 1.6);
    lx = R2 * cos_f(th);
    ly = R2 * sin_f(th);
    lz = rand_gauss_f(su.key, STREAM_SKY_DOTS, idx, 8u) * 0.05;
  }
  var e1 = vec3<f32>(0.0);
  var e2 = vec3<f32>(0.0);
  let n = g1.xyz;
  plane_basis(n, &e1, &e2);
  let rad = g0.w;
  let w = vec3<f32>(
    g0.x + rad * ((lx * e1.x + ly * e2.x) + lz * n.x),
    g0.y + rad * ((lx * e1.y + ly * e2.y) + lz * n.y),
    g0.z + rad * ((lx * e1.z + ly * e2.z) + lz * n.z),
  );
  let pv = to_view(w);
  let pk = CAM_DISTANCE / (CAM_DISTANCE - pv.z);
  let pq = sky_screen(pv, pk);
  let zf = view.scale / 84.0;
  let t = pool[KNOT_POOL + u32(floor(rand_f32(su.key, STREAM_SKY_DOTS, idx, 10u) * f32(su.n_dot_pool)))];
  let k = 0.62 * max(0.6, min(1.3, zf));
  let size = dot_base[t] * k;
  let rot = rand_f32(su.key, STREAM_SKY_DOTS, idx, 11u) * 6.28;
  let p = sm_warp(pq, su.wobble);
  let c = cos_f(rot);
  let sn = sin_f(rot);
  dots_out[s] = Instance(p, t, 1.0, vec4<f32>(c * size, sn * size, -(sn * size), c * size));
}

fn mul2(A: vec4<f32>, B: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(
    A.x * B.x + A.z * B.y,
    A.y * B.x + A.w * B.y,
    A.x * B.z + A.z * B.w,
    A.y * B.z + A.w * B.w,
  );
}

fn rm2(c: f32, s: f32) -> vec4<f32> {
  return vec4<f32>(c, s, -s, c);
}

// orient (app23.js:L863), the plane's tilt angle as a cosine and a sine (no atan2)
fn orient(n: vec3<f32>, size: f32, spin: f32) -> vec4<f32> {
  let nv = to_view(n);
  let cos_i = abs(nv.z);
  let rho = sqrt(nv.x * nv.x + nv.y * nv.y);
  var c0 = 1.0;
  var s0 = 0.0;
  if (rho > 0.0) {
    c0 = nv.x / rho;
    s0 = nv.y / rho;
  }
  let cphi = -(s0 * view.cos_pa + c0 * view.sin_pa);
  let sphi = c0 * view.cos_pa - s0 * view.sin_pa;
  let fl = size * max(0.12, cos_i);
  var M = mul2(rm2(cphi, sphi), vec4<f32>(size, 0.0, 0.0, fl));
  var mir = 1.0;
  if (nv.z < 0.0) {
    mir = -1.0;
  }
  M = mul2(M, vec4<f32>(mir, 0.0, 0.0, 1.0));
  return mul2(M, rm2(cos_f(spin), sin_f(spin)));
}

// where weak lensing of the field acts on a row (M9); the identity today
fn weak_lens(row: VInst) -> VInst {
  return row;
}

@compute @workgroup_size(64)
fn rows_sky(@builtin(global_invocation_id) id: vec3<u32>) {
  let r = id.x;
  if (r >= su.vis_cap * 3u) {
    return;
  }
  var I = VInst(
    vec4<f32>(0.0),
    vec2<f32>(0.0),
    0.0,
    0.0,
    vec4<f32>(0.0),
    vec4<f32>(0.0),
    INACTIVE,
    0u,
    r * su.stride_c,
    r * su.stride_d,
    r * su.stride_b,
    0u,
    0u,
    0u,
  );
  let g = r / 3u;
  let a = r % 3u;
  if (g < min(vargs[1], su.vis_cap)) {
    let V = vis[g];
    let b = V.layer;
    let g1 = bg[b * 3u + 1u];
    let g2 = bg[b * 3u + 2u];
    let item = items[bitcast<u32>(g2.x)];
    let arms = (item & ARMS_FLAG) != 0u;
    var rows = 1u;
    if (arms) {
      rows = u32(g2.y);
    }
    if (a < rows) {
      let n = g1.xyz;
      var M0 = orient(n, V.m.x * 2.1, g1.w);
      if (su.massive != 0u) {
        let sc = view.scale;
        let dx = V.pos.x - PLATE_HALF;
        let dy = V.pos.y - PLATE_HALF;
        let h = sqrt(dx * dx + dy * dy);
        var rf = h;
        if (h == 0.0) {
          rf = 1.0;
        }
        let gam = min(0.45, (0.35 * (1.3 * sc)) / rf);
        var cph = 0.0;
        var sph = 1.0;
        if (h != 0.0) {
          cph = -(dy / rf);
          sph = dx / rf;
        }
        var S = mul2(rm2(cph, sph), vec4<f32>(1.0 + gam, 0.0, 0.0, 1.0 - gam));
        S = mul2(S, rm2(cph, -sph));
        M0 = mul2(S, M0);
      }
      var M = M0;
      if (arms) {
        let ang = (6.28318530717959 * f32(a)) / g2.y;
        M = mul2(M0, rm2(cos_f(ang), sin_f(ang)));
      }
      I.m = M;
      I.t = V.pos;
      I.ps = 0.42;
      I.sc = sqrt(abs(M.x * M.w - M.y * M.z));
      I.drawing = item & ~ARMS_FLAG;
    }
  }
  inst[r] = weak_lens(I);
}

@compute @workgroup_size(64)
fn sky_fg(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= su.n_fg) {
    return;
  }
  fg_out[i] = Instance(vec2<f32>(0.0), 0u, 0.0, vec4<f32>(0.0));
  let f0 = fg[i * 2u];
  let f1 = fg[i * 2u + 1u];
  let v = to_view(f0.xyz);
  let depth = CAM_DISTANCE - v.z;
  if (depth < 3.0) {
    return;
  }
  let k = CAM_DISTANCE / depth;
  let q = sky_screen(v, k);
  if (!(q.x > -40.0 && q.x < PLATE_W + 40.0 && q.y > -40.0 && q.y < PLATE_W + 40.0)) {
    return;
  }
  var size = f0.w * min(2.2, k / 0.42);
  var alpha = 1.0;
  if (view.persp != 0.0) {
    // out of focus (ADR 0090): a star near the camera is larger and fainter, so the foreground
    // reads as a different depth from the galaxy
    let near = k / 0.42;
    size = f0.w * min(3.0, near);
    let t = clamp((near - 1.1) / 1.3, 0.0, 1.0);
    alpha = 1.0 - 0.45 * ((t * t) * (3.0 - 2.0 * t));
  }
  let rot = f1.x;
  let p = sm_warp(q, su.wobble);
  let c = cos_f(rot);
  let s = sin_f(rot);
  fg_out[i] = Instance(p, bitcast<u32>(f1.y), alpha, vec4<f32>(c * size, s * size, -(s * size), c * size));
}
