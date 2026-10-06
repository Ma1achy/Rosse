// Lens pass 3 and emission (the view tier, ADR 0008, 0010): every image of every source mark, and
// every mark the lens makes of them. Reference: `images` of lensSolver (app23.js:L623-633),
// lensMarks (L646-671), lensStar (L672-677), the quasar of lensSprites10 (L679-683) and the
// warped drawings' hook (L1190-1219). The twin is src/fallback/kernels/lens.ts, function for
// function; the buffers are described in src/render/lens.ts.
//
// One table of source marks holds every point the lens has to solve: the source galaxies' stipple
// samples (class 0-5), their drawn cores (6), the anchors of their warped drawings (7), the points
// of their curves (8) and the quasar's own position (9). Entry points, in dispatch order:
//   query_marks      one mark: its images (a barycentric test over the triangles of its bin, in
//                    triangle-id order, de-duplicated within 0.6 cells in that order, at most 8),
//                    and, for the dot classes, the fixed-point sum of min(30, |mu|) per source;
//   count_marks      one slot (mark, image): how many marks it makes, from the counter RNG;
//   quasar_images    ONE invocation: the quasar's images, their time delays and flares;
//   count_quasar     one quasar slot (image, kind, index);
//   scan_local       per 256 slots and per class, the exclusive prefix of the counts;
//   scan_blocks      one invocation per class: the blocks' running offsets and the indirect draw
//                    arguments [4, count, 0, 0];
//   emit_marks       one slot: its marks, into its class's instances at the scanned offset;
//   emit_quasar      one quasar slot: its knot, halo dot or drawn star;
//   track_curves     one curve: v21's greedy matcher over its points' images;
//   gather_branches  ONE invocation: the surviving branches laid out as the ribbons' curves;
//   vec_inst         one (warped drawing, image): its instance, as the vector expansion reads it.
// Every sum and offset is an integer, every draw a pure function of (seed, stream, mark, image),
// so nothing depends on thread scheduling (ADR 0004).

// #import "common/instance.wgsl"
// #import "common/lens-types.wgsl"
// #import "common/rng.wgsl"
// #import "common/warp.wgsl"

const MAX_IMAGES: u32 = 8u;
const LENS_STREAM: u32 = 11u;
const EMIT_INDEX: u32 = 1048576u;
const QUASAR_INDEX: u32 = 524288u;
const KAPPA_FIXED: f32 = 256.0;
const SCAN_BLOCK: u32 = 256u;
const KNOT_POOL: u32 = 24u;
const CLS_OLD_MAX: u32 = 2u;
const CLS_KNOT: u32 = 3u;
const CLS_STAR: u32 = 4u;
const CLS_RSTAR: u32 = 5u;
const CLS_CORE: u32 = 6u;
const CLS_NO_EMIT: u32 = 255u;
const QUASAR_KNOTS: u32 = 72u;
const QUASAR_HALO: u32 = 2520u;
const QUASAR_SLOTS: u32 = 2593u;
const MAX_BRANCHES: u32 = 24u;
const VECTOR_MU_LIMIT: f32 = 40.0;

// LMARK_LAYOUT in src/render/lens.ts
struct LMark {
  // the source plane, relative to its source's centre
  b: vec2<f32>,
  layer: u32,
  alpha: f32,
  m: vec4<f32>,
  cls: u32,
  src: u32,
  pad0: u32,
  pad1: u32,
}

// LSRC_LAYOUT: one source, as this view sees it
struct Src {
  bc: vec2<f32>,
  k: f32,
  dens: f32,
  solver: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

// IMG_LAYOUT: x, y, mu, the triangle, J row-major
struct Img {
  p: vec2<f32>,
  mu: f32,
  tri: u32,
  j: vec4<f32>,
}

// LENS_VIEW_LAYOUT
struct LensView {
  seed: u32,
  n_marks: u32,
  n_slots: u32,
  n_qslots: u32,
  n_src: u32,
  // blocks of the slot scan
  blocks: u32,
  n_curves: u32,
  n_vec: u32,
  // plate px per lens unit, cos and sin of the roll
  u: f32,
  ca: f32,
  sa: f32,
  pen_dot: f32,
  wobble: f32,
  spike: f32,
  // the quasar's moment, (mTime / 2) mod 1, and its mark's index
  now: f32,
  quasar_mark: u32,
  n_dot_pool: u32,
  n_star_pool: u32,
  max_pts: u32,
  max_branches: u32,
  // per class: the first instance of its range and its capacity
  cbase: array<vec4<u32>, 2>,
  ccap: array<vec4<u32>, 2>,
}

// LCURVE_LAYOUT: a source curve's resampled points are marks first_mark .. first_mark + n_pts
struct CurveIn {
  first_mark: u32,
  n_pts: u32,
  braw_first: u32,
  cell4_bits: u32,
  layer: u32,
  flags: u32,
  w: f32,
  a: f32,
  thick: f32,
  piece_first: u32,
  piece_n: u32,
  cap_reps: u32,
}

// CURVE_LAYOUT (compute/ribbons.wgsl): the ribbons' curve table, written here
struct Curve {
  first: u32,
  n: u32,
  layer: u32,
  flags: u32,
  w: f32,
  a: f32,
  thick: f32,
  seg_first: u32,
  piece_first: u32,
  piece_n: u32,
  cap_reps: u32,
  slot_first: u32,
}

// VINST_LAYOUT (compute/vector-expand.wgsl)
struct VInst {
  m: vec4<f32>,
  t: vec2<f32>,
  ps: f32,
  sc: f32,
  w: vec4<f32>,
  w2: vec4<f32>,
  drawing: u32,
  warp: u32,
  cap_first: u32,
  dot_first: u32,
  blob_first: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

@group(0) @binding(0) var<storage, read> solvers: array<Solver>;
@group(0) @binding(1) var<storage, read> verts: array<vec4<f32>>;
// the bins' offsets, then the triangle ids of every bin (ascending), of every solver
@group(0) @binding(2) var<storage, read> bins: array<u32>;
@group(0) @binding(3) var<uniform> lv: LensView;
@group(0) @binding(4) var<storage, read> marks: array<LMark>;
@group(0) @binding(5) var<storage, read> srcs: array<Src>;
@group(0) @binding(6) var<storage, read_write> imgs: array<Img>;
// per source the fixed-point magnification sum, then per mark its image count
@group(0) @binding(7) var<storage, read_write> qmeta: array<atomic<u32>>;
// per slot: count, rank, class
@group(0) @binding(8) var<storage, read_write> slots: array<vec4<u32>>;
@group(0) @binding(9) var<storage, read_write> block_totals: array<u32>;
@group(0) @binding(10) var<storage, read_write> block_offsets: array<u32>;
@group(0) @binding(11) var<storage, read_write> args: array<u32>;
@group(0) @binding(12) var<storage, read_write> out: array<Instance>;
// the quasar's images (x, y, B), and in entry 8 their number
@group(0) @binding(13) var<storage, read_write> qimgs: array<vec4<f32>>;
@group(0) @binding(14) var<storage, read> pool: array<u32>;
@group(0) @binding(15) var<storage, read> dot_base: array<f32>;
@group(0) @binding(16) var<storage, read> halos: array<vec4<f32>>;
@group(0) @binding(17) var<storage, read> star_pool: array<u32>;
@group(0) @binding(18) var<storage, read> curves_in: array<CurveIn>;
@group(0) @binding(19) var<storage, read_write> braw_pts: array<vec2<f32>>;
@group(0) @binding(20) var<storage, read_write> braw_n: array<u32>;
@group(0) @binding(21) var<storage, read_write> curves_out: array<Curve>;
@group(0) @binding(22) var<storage, read_write> pts_out: array<vec2<f32>>;
@group(0) @binding(23) var<storage, read> lvecs: array<vec2<u32>>;
@group(0) @binding(24) var<storage, read_write> vinst: array<VInst>;

// ---------------------------------------------------------------------------------------------
// Images of a source point

var<private> hit_p: array<vec2<f32>, 8>;
var<private> hit_j: array<vec4<f32>, 8>;
var<private> hit_mu: array<f32, 8>;
var<private> hit_tri: array<u32, 8>;
var<private> n_hit: u32;

fn find_images(s: u32, px: f32, py: f32) {
  n_hit = 0u;
  let S = solvers[s];
  let fx = floor((px - S.bx0) / S.cw);
  let fy = floor((py - S.by0) / S.ch);
  let h = f32(S.g);
  if (!(fx >= 0.0 && fy >= 0.0 && fx < h && fy < h)) {
    return;
  }
  let bin = S.obase + u32(fy) * S.g + u32(fx);
  let lo = bins[bin];
  let hi = bins[bin + 1u];
  let dup = S.cell * 0.6;
  for (var k = lo; k < hi && n_hit < MAX_IMAGES; k++) {
    let t = bins[S.ibase + k];
    let v = triangle_verts(t, S.g);
    let q0 = verts[S.vbase + v.x];
    let q1 = verts[S.vbase + v.y];
    let q2 = verts[S.vbase + v.z];
    let x0 = q0.z;
    let y0 = q0.w;
    let e1x = q1.z - x0;
    let e1y = q1.w - y0;
    let e2x = q2.z - x0;
    let e2y = q2.w - y0;
    let det = e1x * e2y - e2x * e1y;
    if (abs(det) < 1e-12) {
      continue;
    }
    let dx = px - x0;
    let dy = py - y0;
    let l1 = (dx * e2y - e2x * dy) / det;
    let l2 = (e1x * dy - dx * e1y) / det;
    if (l1 < -1e-6 || l2 < -1e-6 || l1 + l2 > 1.0 + 1e-6) {
      continue;
    }
    let f1x = q1.x - q0.x;
    let f1y = q1.y - q0.y;
    let f2x = q2.x - q0.x;
    let f2y = q2.y - q0.y;
    let ix = q0.x + l1 * f1x + l2 * f2x;
    let iy = q0.y + l1 * f1y + l2 * f2y;
    var is_dup = false;
    for (var m = 0u; m < n_hit; m++) {
      if (abs(hit_p[m].x - ix) < dup && abs(hit_p[m].y - iy) < dup) {
        is_dup = true;
        break;
      }
    }
    if (is_dup) {
      continue;
    }
    let j0 = (f1x * e2y - f2x * e1y) / det;
    let j1 = (f2x * e1x - f1x * e2x) / det;
    let j2 = (f1y * e2y - f2y * e1y) / det;
    let j3 = (f2y * e1x - f1y * e2x) / det;
    hit_p[n_hit] = vec2<f32>(ix, iy);
    hit_j[n_hit] = vec4<f32>(j0, j1, j2, j3);
    hit_mu[n_hit] = j0 * j3 - j1 * j2;
    hit_tri[n_hit] = t;
    n_hit = n_hit + 1u;
  }
}

fn fixed_mu(mu: f32) -> u32 {
  return u32(floor(min(30.0, abs(mu)) * KAPPA_FIXED + 0.5));
}

@compute @workgroup_size(64)
fn query_marks(@builtin(global_invocation_id) id: vec3<u32>) {
  let m = id.x;
  if (m >= lv.n_marks) {
    return;
  }
  let mk = marks[m];
  if (mk.cls == CLS_NO_EMIT) {
    // a sample its source's culls removed
    atomicStore(&qmeta[lv.n_src + m], 0u);
    return;
  }
  let S = srcs[mk.src];
  find_images(S.solver, mk.b.x + S.bc.x, mk.b.y + S.bc.y);
  var sum = 0u;
  for (var j = 0u; j < n_hit; j++) {
    imgs[m * MAX_IMAGES + j] = Img(hit_p[j], hit_mu[j], hit_tri[j], hit_j[j]);
    if (mk.cls <= CLS_OLD_MAX) {
      sum = sum + fixed_mu(hit_mu[j]);
    }
  }
  atomicStore(&qmeta[lv.n_src + m], n_hit);
  if (sum != 0u) {
    atomicAdd(&qmeta[mk.src], sum);
  }
}

// ---------------------------------------------------------------------------------------------
// Slots: counts

fn kappa_of(si: u32) -> f32 {
  let S = srcs[si];
  let tot = f32(atomicLoad(&qmeta[si])) / KAPPA_FIXED;
  return min(1.2, 0.5 * S.dens / max(1.0, tot));
}

@compute @workgroup_size(64)
fn count_marks(@builtin(global_invocation_id) id: vec3<u32>) {
  let s = id.x;
  if (s >= lv.n_slots) {
    return;
  }
  let m = s >> 3u;
  let j = s & 7u;
  let mk = marks[m];
  var n = 0u;
  if (mk.cls <= CLS_CORE && j < atomicLoad(&qmeta[lv.n_src + m])) {
    if (mk.cls == CLS_RSTAR || mk.cls == CLS_CORE) {
      n = 1u;
    } else {
      let u = rand_f32(lv.seed, LENS_STREAM, EMIT_INDEX + s, 0u);
      if (mk.cls == CLS_KNOT || mk.cls == CLS_STAR) {
        if (!(u > 0.55)) {
          n = 1u;
        }
      } else {
        let mu = min(30.0, abs(imgs[m * MAX_IMAGES + j].mu));
        n = u32(floor(kappa_of(mk.src) * mu + u));
      }
    }
  }
  var c = CLS_NO_EMIT;
  if (n != 0u) {
    c = mk.cls;
  }
  slots[s] = vec4<u32>(n, 0u, c, 0u);
}

// ---------------------------------------------------------------------------------------------
// The quasar

// psi of the main plane at (x, y), as `potentialF` of src/fallback/kernels/lens.ts
fn psi_at(x: f32, y: f32) -> f32 {
  let S = solvers[0];
  var pp = 0.0;
  for (var k = 0u; k < S.n_halo; k++) {
    let h0 = halos[S.hbase + 3u * k];
    let h1 = halos[S.hbase + 3u * k + 1u];
    let h2 = halos[S.hbase + 3u * k + 2u];
    let dx = x - h0.x;
    let dy = y - h0.y;
    let u = dx * h0.z + dy * h0.w;
    let v = -dx * h0.w + dy * h0.z;
    pp = pp + h2.x * sqrt(h2.y * u * u + v * v / h2.y + h1.y * h1.y);
  }
  return (pp + 0.5 * S.sh_g * (S.sh_c2 * (x * x - y * y) + 2.0 * S.sh_s2 * x * y)) * S.f;
}

@compute @workgroup_size(1)
fn quasar_images() {
  let m = lv.quasar_mark;
  let n = atomicLoad(&qmeta[lv.n_src + m]);
  let bc = srcs[marks[m].src].bc;
  var qx: array<f32, 8>;
  var qy: array<f32, 8>;
  var qm: array<f32, 8>;
  var tau: array<f32, 8>;
  var k = 0u;
  var t0 = 0.0;
  var t1 = 1e-6;
  for (var j = 0u; j < n; j++) {
    let im = imgs[m * MAX_IMAGES + j];
    if (abs(im.mu) > 0.08) {
      qx[k] = im.p.x;
      qy[k] = im.p.y;
      qm[k] = im.mu;
      let ex = im.p.x - bc.x;
      let ey = im.p.y - bc.y;
      let ta = 0.5 * (ex * ex + ey * ey) - psi_at(im.p.x, im.p.y);
      tau[k] = ta;
      t0 = min(t0, ta);
      t1 = max(t1, ta);
      k = k + 1u;
    }
  }
  for (var i = 0u; i < k; i++) {
    let arrive = 0.18 + 0.55 * (tau[i] - t0) / max(1e-6, t1 - t0);
    let dt = min(abs(lv.now - arrive), 1.0 - abs(lv.now - arrive));
    let flare = 1.0 + 3.2 * exp(-(dt * dt) / (2.0 * 0.05 * 0.05));
    let b = clamp((0.2 + 0.12 * log(1.0 + abs(qm[i]))) * flare, 0.15, 1.6);
    qimgs[i] = vec4<f32>(qx[i], qy[i], b, 0.0);
  }
  qimgs[8] = vec4<f32>(bitcast<f32>(k), 0.0, 0.0, 0.0);
}

fn scr(x: f32, y: f32) -> vec2<f32> {
  return vec2<f32>(400.0 + (x * lv.ca - y * lv.sa) * lv.u, 400.0 + (x * lv.sa + y * lv.ca) * lv.u);
}

struct HaloDraw {
  a2: f32,
  d2: f32,
  keep: bool,
}

fn quasar_halo(img: u32, h: u32, b: f32) -> HaloDraw {
  let idx = EMIT_INDEX + QUASAR_INDEX + img * QUASAR_SLOTS + QUASAR_KNOTS + h;
  let a2 = rand_f32(lv.seed, LENS_STREAM, idx, 0u) * 6.2832;
  let u = rand_f32(lv.seed, LENS_STREAM, idx, 1u);
  let d2 = (3.0 + 8.0 * b) * lv.pen_dot * pow(1.0 - u * 0.985, -0.62);
  return HaloDraw(a2, d2, d2 <= lv.u * 0.75 * b);
}

@compute @workgroup_size(64)
fn count_quasar(@builtin(global_invocation_id) id: vec3<u32>) {
  let q = id.x;
  if (q >= lv.n_qslots) {
    return;
  }
  let img = q / QUASAR_SLOTS;
  let k = q - img * QUASAR_SLOTS;
  var n = 0u;
  var c = CLS_NO_EMIT;
  if (img < bitcast<u32>(qimgs[8].x)) {
    let b = qimgs[img].z;
    let nk = u32(floor(8.0 + 40.0 * b + 0.5));
    let nh = u32(floor(120.0 + 1500.0 * b + 0.5));
    if (k < nk) {
      n = 1u;
      c = CLS_KNOT;
    } else if (k >= QUASAR_KNOTS && k < QUASAR_KNOTS + nh) {
      if (quasar_halo(img, k - QUASAR_KNOTS, b).keep) {
        n = 1u;
        c = 1u;
      }
    } else if (k == QUASAR_KNOTS + QUASAR_HALO && lv.n_star_pool > 0u) {
      n = 1u;
      c = CLS_RSTAR;
    }
  }
  slots[lv.n_slots + q] = vec4<u32>(n, 0u, c, 0u);
}

// ---------------------------------------------------------------------------------------------
// The scan: per class, deterministic

var<workgroup> tmp: array<u32, 256>;

fn class_base(c: u32) -> u32 {
  let v = lv.cbase[c >> 2u];
  return v[c & 3u];
}

fn class_cap(c: u32) -> u32 {
  let v = lv.ccap[c >> 2u];
  return v[c & 3u];
}

@compute @workgroup_size(256)
fn scan_local(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let cls = wid.y;
  let i = wid.x * SCAN_BLOCK + lid.x;
  var v = 0u;
  if (i < lv.n_slots + lv.n_qslots) {
    let s = slots[i];
    if (s.z == cls) {
      v = s.x;
    }
  }
  tmp[lid.x] = v;
  workgroupBarrier();
  for (var off = 1u; off < SCAN_BLOCK; off = off * 2u) {
    var a = tmp[lid.x];
    if (lid.x >= off) {
      a = a + tmp[lid.x - off];
    }
    workgroupBarrier();
    tmp[lid.x] = a;
    workgroupBarrier();
  }
  if (i < lv.n_slots + lv.n_qslots && slots[i].z == cls) {
    slots[i].y = tmp[lid.x] - v;
  }
  if (lid.x == SCAN_BLOCK - 1u) {
    block_totals[cls * lv.blocks + wid.x] = tmp[lid.x];
  }
}

@compute @workgroup_size(1)
fn scan_blocks(@builtin(workgroup_id) wid: vec3<u32>) {
  let cls = wid.x;
  var run = 0u;
  for (var b = 0u; b < lv.blocks; b++) {
    block_offsets[cls * lv.blocks + b] = run;
    run = run + block_totals[cls * lv.blocks + b];
  }
  args[cls * 4u] = 4u;
  args[cls * 4u + 1u] = min(run, class_cap(cls));
  args[cls * 4u + 2u] = 0u;
  args[cls * 4u + 3u] = 0u;
}

// ---------------------------------------------------------------------------------------------
// Emission

fn put(c: u32, at: u32, p: vec2<f32>, layer: u32, alpha: f32, m: vec4<f32>) {
  if (at < class_cap(c)) {
    out[class_base(c) + at] = Instance(p, layer, alpha, m);
  }
}

@compute @workgroup_size(64)
fn emit_marks(@builtin(global_invocation_id) id: vec3<u32>) {
  let s = id.x;
  if (s >= lv.n_slots) {
    return;
  }
  let sl = slots[s];
  let n = sl.x;
  if (n == 0u) {
    return;
  }
  let m = s >> 3u;
  let j = s & 7u;
  let mk = marks[m];
  let c = mk.cls;
  let at0 = block_offsets[c * lv.blocks + s / SCAN_BLOCK] + sl.y;
  let im = imgs[m * MAX_IMAGES + j];
  if (c <= CLS_OLD_MAX) {
    let S = srcs[mk.src];
    let sig = 1.3 * S.k;
    let idx = EMIT_INDEX + s;
    for (var i = 0u; i < n; i++) {
      let d0 = 1u + 4u * i;
      let gx = rand_gauss_f(lv.seed, LENS_STREAM, idx, d0) * sig;
      let gy = rand_gauss_f(lv.seed, LENS_STREAM, idx, d0 + 2u) * sig;
      let tx = im.p.x + im.j.x * gx + im.j.y * gy;
      let ty = im.p.y + im.j.z * gx + im.j.w * gy;
      put(c, at0 + i, scr(tx, ty), mk.layer, mk.alpha, mk.m);
    }
    return;
  }
  var sc = 1.0;
  if (c == CLS_KNOT || c == CLS_STAR) {
    // v21: scaled by mu^(1/4), clamped to 0.7-1.3
    sc = clamp(sqrt(sqrt(min(30.0, abs(im.mu)))), 0.7, 1.3);
  }
  put(c, at0, scr(im.p.x, im.p.y), mk.layer, mk.alpha, mk.m * sc);
}

@compute @workgroup_size(64)
fn emit_quasar(@builtin(global_invocation_id) id: vec3<u32>) {
  let q = id.x;
  if (q >= lv.n_qslots) {
    return;
  }
  let sl = slots[lv.n_slots + q];
  if (sl.x == 0u) {
    return;
  }
  let img = q / QUASAR_SLOTS;
  let k = q - img * QUASAR_SLOTS;
  let im = qimgs[img];
  let b = im.z;
  let c = sl.z;
  let at = block_offsets[c * lv.blocks + (lv.n_slots + q) / SCAN_BLOCK] + sl.y;
  let p0 = scr(im.x, im.y);
  let idx = EMIT_INDEX + QUASAR_INDEX + q;
  if (c == CLS_KNOT) {
    let a = rand_f32(lv.seed, LENS_STREAM, idx, 0u) * 6.2832;
    let d = pow(rand_f32(lv.seed, LENS_STREAM, idx, 1u), 1.5) * (2.0 + 7.0 * b) * lv.pen_dot;
    let tile = pool[u32(floor(rand_f32(lv.seed, LENS_STREAM, idx, 2u) * f32(KNOT_POOL)))];
    let size = (3.0 + 3.0 * rand_f32(lv.seed, LENS_STREAM, idx, 3u)) * lv.pen_dot;
    let rot = rand_f32(lv.seed, LENS_STREAM, idx, 4u) * 6.28;
    let p = sm_warp(vec2<f32>(p0.x + cos_f(a) * d, p0.y + sin_f(a) * d), lv.wobble);
    let cs = cos_f(rot);
    let sn = sin_f(rot);
    put(c, at, p, tile, 1.0, vec4<f32>(cs * size, sn * size, -(sn * size), cs * size));
    return;
  }
  if (c == CLS_RSTAR) {
    let tile = star_pool[u32(floor(rand_f32(lv.seed, LENS_STREAM, idx, 2u) * f32(lv.n_star_pool)))];
    let size = (16.0 + 38.0 * b) * lv.pen_dot;
    let cs = cos_f(lv.spike);
    let sn = sin_f(lv.spike);
    put(c, at, p0, tile, 0.7 + 0.5 * b, vec4<f32>(cs * size, sn * size, -(sn * size), cs * size));
    return;
  }
  let h = quasar_halo(img, k - QUASAR_KNOTS, b);
  let tile = pool[KNOT_POOL + u32(floor(rand_f32(lv.seed, LENS_STREAM, idx, 2u) * f32(lv.n_dot_pool)))];
  let size = dot_base[tile] * 0.85;
  let rot = rand_f32(lv.seed, LENS_STREAM, idx, 3u) * 6.28;
  let p = sm_warp(vec2<f32>(p0.x + cos_f(h.a2) * h.d2, p0.y + sin_f(h.a2) * h.d2), lv.wobble);
  let cs = cos_f(rot);
  let sn = sin_f(rot);
  put(c, at, p, tile, 1.0, vec4<f32>(cs * size, sn * size, -(sn * size), cs * size));
}

// ---------------------------------------------------------------------------------------------
// Curves

@compute @workgroup_size(1)
fn track_curves(@builtin(workgroup_id) wid: vec3<u32>) {
  let c = wid.x;
  let C = curves_in[c];
  let cell4 = bitcast<f32>(C.cell4_bits);
  let base = C.braw_first;
  let np = C.n_pts;
  var live: array<u32, 8>;
  var next: array<u32, 8>;
  var n_live = 0u;
  var births = 0u;
  for (var b = 0u; b < MAX_BRANCHES; b++) {
    braw_n[c * MAX_BRANCHES + b] = 0u;
  }
  for (var p = 0u; p < np; p++) {
    let m = C.first_mark + p;
    let n = atomicLoad(&qmeta[lv.n_src + m]);
    var used = 0u;
    var n_next = 0u;
    for (var li = 0u; li < n_live; li++) {
      let bi = live[li];
      let len = braw_n[c * MAX_BRANCHES + bi];
      let last = braw_pts[base + bi * np + len - 1u];
      var best = 8u;
      var bd = cell4;
      for (var qi = 0u; qi < n; qi++) {
        if ((used & (1u << qi)) != 0u) {
          continue;
        }
        let q = imgs[m * MAX_IMAGES + qi].p;
        let dx = q.x - last.x;
        let dy = q.y - last.y;
        let d = sqrt(dx * dx + dy * dy);
        if (d < bd) {
          bd = d;
          best = qi;
        }
      }
      if (best < 8u) {
        used = used | (1u << best);
        braw_pts[base + bi * np + len] = imgs[m * MAX_IMAGES + best].p;
        braw_n[c * MAX_BRANCHES + bi] = len + 1u;
        next[n_next] = bi;
        n_next = n_next + 1u;
      }
    }
    for (var qi = 0u; qi < n; qi++) {
      if ((used & (1u << qi)) == 0u && births < MAX_BRANCHES) {
        braw_pts[base + births * np] = imgs[m * MAX_IMAGES + qi].p;
        braw_n[c * MAX_BRANCHES + births] = 1u;
        next[n_next] = births;
        n_next = n_next + 1u;
        births = births + 1u;
      }
    }
    n_live = n_next;
    for (var i = 0u; i < n_next; i++) {
      live[i] = next[i];
    }
  }
}

@compute @workgroup_size(1)
fn gather_branches() {
  var count = 0u;
  let nb = lv.max_branches;
  let pm = lv.max_pts;
  for (var c = 0u; c < lv.n_curves; c++) {
    let C = curves_in[c];
    for (var b = 0u; b < MAX_BRANCHES; b++) {
      let len = braw_n[c * MAX_BRANCHES + b];
      if (len < 3u || count >= nb) {
        continue;
      }
      let n = min(len, pm);
      for (var i = 0u; i < n; i++) {
        let q = braw_pts[C.braw_first + b * C.n_pts + i];
        pts_out[count * pm + i] = scr(q.x, q.y);
      }
      curves_out[count] = Curve(
        count * pm, n, C.layer, C.flags, C.w, C.a, C.thick, count * (pm - 1u),
        C.piece_first, C.piece_n, C.cap_reps, 0u,
      );
      count = count + 1u;
    }
  }
  for (var k = count; k < nb; k++) {
    curves_out[k] = Curve(k * pm, 0u, 0u, 0u, 1.0, 1.0, 1.0, k * (pm - 1u), 0u, 0u, 0u, 0u);
  }
}

// ---------------------------------------------------------------------------------------------
// Warped drawings

@compute @workgroup_size(64)
fn vec_inst(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= lv.n_vec * MAX_IMAGES) {
    return;
  }
  let v = i >> 3u;
  let j = i & 7u;
  let lvec = lvecs[v];
  let m = lvec.x;
  let k = bitcast<f32>(lvec.y);
  var I = vinst[i];
  I.pad0 = 1u;
  I.w2 = vec4<f32>(0.0);
  if (j < atomicLoad(&qmeta[lv.n_src + m])) {
    let im = imgs[m * MAX_IMAGES + j];
    if (abs(im.mu) <= VECTOR_MU_LIMIT) {
      // out = c' + S (q - a): the placed point's offset from the drawing's centre, through J,
      // rolled and scaled to the plate (lensMarks, L667)
      let c = scr(im.p.x, im.p.y);
      let uk = lv.u * k;
      I.w = vec4<f32>(I.t.x, I.t.y, c.x - I.t.x, c.y - I.t.y);
      I.w2 = vec4<f32>(
        uk * (lv.ca * im.j.x - lv.sa * im.j.z),
        uk * (lv.sa * im.j.x + lv.ca * im.j.z),
        uk * (lv.ca * im.j.y - lv.sa * im.j.w),
        uk * (lv.sa * im.j.y + lv.ca * im.j.w),
      );
      I.pad0 = 0u;
    }
  }
  vinst[i] = I;
}
