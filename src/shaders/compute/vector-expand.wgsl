// Vector drawings to pen capsules, dot and blob sprites (ADR 0006), with an optional warp per
// instance, and the stellar streams' marks. Reference: expandVector (app23.js:L1190-1219) and the
// streams of parts (L1069-1083). The buffers are described in src/model/vectors.ts and
// src/marks/vector.ts.
//
// Entry points, in dispatch order (view tier):
//   expand_caps    one capsule slot: its instance by binary search on cap_first; unwarped, one
//                  segment of the drawing; warped, one piece of a segment densified to <= 0.012
//                  tile units (L1202), its piece by binary search on the densified prefix. Both
//                  ends through tf (warp, matrix, wobble); half width PEN.line / 2 * ps plate px.
//                  A warped segment longer than 22 px is dropped (L1207), and under the `post`
//                  hook (and a merging galaxy's tides) one stretched more than 1.8x (L1208): the
//                  slot's key says so;
//   expand_dots    one dot of a drawing: a dots sprite through tf, its drawing from the hand by
//                  the coordinate hash, VAR.dotPool[|round(997 x + 131 y)| % len], sized
//                  dotSprite(t, clamp(2 r sc 0.42 / 2.6, 0.8, 1.6) * max(0.55, ps)) (L1215);
//   expand_blobs   one blob: a knots sprite, VAR.knotPool[|round(991 cx)| % 24], with the matrix
//                  M R(theta) S(max(1.7 rx, 3/sc), max(1.7 ry, 3/sc)) (L1217);
//   stream_marks   one slot of a stream segment: kept with probability 0.55 + 0.45 streams, a dot
//                  (old ink, dotSprite(t, 0.95)) or, one time in 25, a knot ((3 + 3u) PEN.dot), at
//                  its place along the segment plus a gaussian of 1.4 px, through the wobble
//                  (L1076-1080);
//   scan_local, scan_blocks, scatter_caps, scatter_marks
//                  deterministic compaction (ADR 0004) of the capsules (one class) and of the
//                  stream marks (dots, knots), in slot order, with the indirect draw arguments.
//
// v21 parity: every vertex, dot and blob is drawn at alpha 1, whatever the row's alpha (reference
// notes 20.10). Directions are never formed with atan2: the rewind turns a point by
// (cos phi, sin phi) of phi = dk ln(r / 0.08), with cos_f and sin_f.
//
// CPU twin: src/fallback/kernels/vector.ts, function for function (ADR 0014).

// #import "common/instance.wgsl"
// #import "common/rng.wgsl"
// #import "common/tide.wgsl"
// #import "common/warp.wgsl"

// VEC_LAYOUT in src/model/vectors.ts
struct Vec {
  n_inst: u32,
  n_cap_slots: u32,
  n_dots: u32,
  n_blobs: u32,
  n_stream_segs: u32,
  n_stream_slots: u32,
  // the placement key (re-keyed with the stipple)
  key: u32,
  n_dot_pool: u32,
  // PEN.line, plate px
  pen_line: f32,
  // the hand wobble's amplitude (0: off)
  wobble: f32,
  // a stream mark is kept when its draw is at most this
  stream_keep: f32,
  // PEN.dot
  pen_dot: f32,
}

// VINST_LAYOUT: one placed drawing
struct VInst {
  // tile -> plate px, column-major
  m: vec4<f32>,
  t: vec2<f32>,
  // pen scale
  ps: f32,
  // sqrt |det m|, the dots' and blobs' scale
  sc: f32,
  // warp parameters: rewind (dk, flip, 0, 0); post (cx, cy, 0, 0); tide (galaxy, R2, 0, 0);
  // tide on the screen (mWarp) (galaxy, flip, 0, 0)
  w: vec4<f32>,
  // post: the affine S, column-major
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

// STREAM_SEG_LAYOUT
struct StreamSeg {
  p0: vec2<f32>,
  p1: vec2<f32>,
  slot_first: u32,
  n: u32,
  index: u32,
  pad0: u32,
}

// CAPSULE_LAYOUT (src/model/ribbons.ts), plate units
struct Capsule {
  a: vec2<f32>,
  b: vec2<f32>,
  w: f32,
  alpha: f32,
  pad0: f32,
  pad1: f32,
}

// JOB_LAYOUT
struct Job {
  n: u32,
  blocks: u32,
  cap: u32,
  mode: u32,
}

const WARP_NONE: u32 = 0u;
const WARP_REWIND: u32 = 1u;
const WARP_POST: u32 = 2u;
const WARP_TIDE: u32 = 3u;
const WARP_TIDE_SCREEN: u32 = 4u;
const KNOT_POOL: u32 = 24u;
const DRAWING_WORDS: u32 = 8u;
const DROP: u32 = 0xffffffffu;
const STREAM_PART_MARKS: u32 = 16u;
const SCAN_BLOCK: u32 = 256u;
const MODE_CAPS: u32 = 0u;

@group(0) @binding(0) var<uniform> vu: Vec;
@group(0) @binding(1) var<storage, read> inst: array<VInst>;
@group(0) @binding(2) var<storage, read> table: array<u32>;
@group(0) @binding(3) var<storage, read> segs: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> dens: array<u32>;
@group(0) @binding(5) var<storage, read> vdots: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> vblobs: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> pool: array<u32>;
@group(0) @binding(8) var<storage, read> dot_base: array<f32>;
@group(0) @binding(9) var<storage, read_write> caps_raw: array<Capsule>;
@group(0) @binding(10) var<storage, read_write> keys: array<u32>;
@group(0) @binding(11) var<storage, read_write> dots_out: array<Instance>;
@group(0) @binding(12) var<storage, read_write> blobs_out: array<Instance>;
@group(0) @binding(13) var<storage, read> sseg: array<StreamSeg>;
@group(0) @binding(14) var<storage, read_write> marks_raw: array<Instance>;
@group(0) @binding(15) var<uniform> job: Job;
@group(0) @binding(16) var<storage, read_write> rank: array<u32>;
@group(0) @binding(17) var<storage, read_write> block_totals: array<u32>;
@group(0) @binding(18) var<storage, read_write> block_offsets: array<u32>;
@group(0) @binding(19) var<storage, read_write> args: array<u32>;
@group(0) @binding(20) var<storage, read_write> caps: array<Capsule>;
@group(0) @binding(21) var<storage, read_write> marks: array<Instance>;

// The last instance whose first slot (field 0: capsule, 1: dot, 2: blob) is at or before i.
fn inst_of(i: u32, field: u32) -> u32 {
  var lo = 0u;
  var hi = vu.n_inst;
  while (hi - lo > 1u) {
    let mid = (lo + hi) >> 1u;
    var first = inst[mid].cap_first;
    if (field == 1u) {
      first = inst[mid].dot_first;
    } else if (field == 2u) {
      first = inst[mid].blob_first;
    }
    if (first <= i) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// The spiral rewind (rewindFn, app23.js:L844): mirrored first when the drawing winds Z-wise; the
// angle grows by dk ln(r / 0.08), nothing within 0.015 of the centre.
fn rewind(p: vec2<f32>, dk: f32, flip: bool) -> vec2<f32> {
  var x = p.x;
  if (flip) {
    x = -x;
  }
  let y = p.y;
  let rr = sqrt(x * x + y * y);
  if (rr < 0.015) {
    return vec2<f32>(x, y);
  }
  let phi = dk * log(rr / 0.08);
  let c = cos_f(phi);
  let s = sin_f(phi);
  return vec2<f32>(x * c - y * s, x * s + y * c);
}

// The matrix: tile -> plate, before the wobble.
fn place(I: VInst, p: vec2<f32>) -> vec2<f32> {
  return vec2<f32>((I.t.x + I.m.x * p.x) + I.m.z * p.y, (I.t.y + I.m.y * p.x) + I.m.w * p.y);
}

// The post hook: c + S (q - c).
fn post(I: VInst, q: vec2<f32>) -> vec2<f32> {
  let dx = q.x - I.w.x;
  let dy = q.y - I.w.y;
  return vec2<f32>((I.w.x + I.w2.x * dx) + I.w2.z * dy, (I.w.y + I.w2.y * dx) + I.w2.w * dy);
}

// expandVector's tf (app23.js:L1194-1198): the warp, the matrix, the wobble.
fn tf(I: VInst, p: vec2<f32>) -> vec2<f32> {
  if (I.warp == WARP_REWIND) {
    return sm_warp(place(I, rewind(p, I.w.x, I.w.y != 0.0)), vu.wobble);
  }
  if (I.warp == WARP_POST) {
    return sm_warp(post(I, place(I, p)), vu.wobble);
  }
  if (I.warp == WARP_TIDE) {
    // a merging galaxy's mark carried by its tides (L1195): the grid, after the matrix
    return sm_warp(tide_post(u32(I.w.x), place(I, p), I.w.y), vu.wobble);
  }
  if (I.warp == WARP_TIDE_SCREEN) {
    // mWarp's whole drawing (L1196): the tidal map itself, on the raw drawing coordinates
    var q = p;
    if (I.w.y != 0.0) {
      q.x = -q.x;
    }
    return sm_warp(tide_nn(u32(I.w.x), q.x, q.y), vu.wobble);
  }
  return sm_warp(place(I, p), vu.wobble);
}

// The last segment of the drawing whose densified first piece is at or before k (k global).
fn seg_of_piece(first: u32, n: u32, k: u32) -> u32 {
  var lo = first;
  var hi = first + n;
  while (hi - lo > 1u) {
    let mid = (lo + hi) >> 1u;
    if (dens[mid] <= k) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

@compute @workgroup_size(64)
fn expand_caps(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= vu.n_cap_slots) {
    return;
  }
  let I = inst[inst_of(i, 0u)];
  let k = i - I.cap_first;
  let o = I.drawing * DRAWING_WORDS;
  var a: vec2<f32>;
  var b: vec2<f32>;
  var ra: vec2<f32>;
  var rb: vec2<f32>;
  if (I.warp == WARP_NONE) {
    let g = segs[table[o] + k];
    ra = g.xy;
    rb = g.zw;
  } else {
    // a piece of a segment cut into n (app23.js:L1202)
    let piece = table[o + 6u] + k;
    let s = seg_of_piece(table[o], table[o + 1u], piece);
    let g = segs[s];
    let n = f32(dens[s + 1u] - dens[s]);
    let m = f32(piece - dens[s]);
    let d = g.zw - g.xy;
    ra = g.xy + d * (m / n);
    rb = g.xy + d * ((m + 1.0) / n);
  }
  a = tf(I, ra);
  b = tf(I, rb);
  var key = 0u;
  if (I.warp != WARP_NONE) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let ml = sqrt(dx * dx + dy * dy);
    if (ml > 22.0) {
      key = DROP;
    }
    if (I.warp == WARP_POST || I.warp == WARP_TIDE) {
      let ex = rb.x - ra.x;
      let ey = rb.y - ra.y;
      let ox = I.m.x * ex + I.m.z * ey;
      let oy = I.m.y * ex + I.m.w * ey;
      let ol = sqrt(ox * ox + oy * oy) + 0.8;
      if (ml / ol > 1.8) {
        key = DROP;
      }
    }
  }
  caps_raw[i] = Capsule(a, b, (vu.pen_line / 2.0) * I.ps, 1.0, 0.0, 0.0);
  keys[i] = key;
}

@compute @workgroup_size(64)
fn expand_dots(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= vu.n_dots) {
    return;
  }
  let I = inst[inst_of(i, 1u)];
  let d = vdots[table[I.drawing * DRAWING_WORDS + 2u] + i - I.dot_first];
  let p = tf(I, d.xy);
  let t = pool[KNOT_POOL + u32(d.w) % max(1u, vu.n_dot_pool)];
  let k0 = clamp((((2.0 * d.z) * I.sc) * 0.42) / 2.6, 0.8, 1.6);
  let k = k0 * max(0.55, I.ps);
  let size = dot_base[t] * k;
  dots_out[i] = Instance(p, t, 1.0, vec4<f32>(size, 0.0, 0.0, size));
}

@compute @workgroup_size(64)
fn expand_blobs(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= vu.n_blobs) {
    return;
  }
  let I = inst[inst_of(i, 2u)];
  let o = 2u * (table[I.drawing * DRAWING_WORDS + 4u] + i - I.blob_first);
  let b0 = vblobs[o];
  let b1 = vblobs[o + 1u];
  let p = tf(I, b0.xy);
  let t = pool[u32(b1.z) % KNOT_POOL];
  let lim = 3.0 / I.sc;
  let sx = max((2.0 * b0.z) * 0.85, lim);
  let sy = max((2.0 * b0.w) * 0.85, lim);
  let c = b1.x;
  let s = b1.y;
  let m = I.m;
  let r0 = m.x * c + m.z * s;
  let r1 = m.y * c + m.w * s;
  let r2 = m.z * c - m.x * s;
  let r3 = m.w * c - m.y * s;
  blobs_out[i] = Instance(p, t, 1.0, vec4<f32>(r0 * sx, r1 * sx, r2 * sy, r3 * sy));
}

// The last stream segment whose first slot is at or before i.
fn stream_seg_of(i: u32) -> u32 {
  var lo = 0u;
  var hi = vu.n_stream_segs;
  while (hi - lo > 1u) {
    let mid = (lo + hi) >> 1u;
    if (sseg[mid].slot_first <= i) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

@compute @workgroup_size(64)
fn stream_marks(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= vu.n_stream_slots) {
    return;
  }
  let S = sseg[stream_seg_of(i)];
  let m2 = i - S.slot_first;
  let idx = S.index + m2;
  let key = vu.key;
  if (rand_f32(key, STREAM_PART_MARKS, idx, 0u) > vu.stream_keep) {
    keys[i] = DROP;
    marks_raw[i] = Instance(vec2<f32>(0.0), 0u, 0.0, vec4<f32>(0.0));
    return;
  }
  let tt = pool[KNOT_POOL + u32(floor(rand_f32(key, STREAM_PART_MARKS, idx, 1u) * f32(vu.n_dot_pool)))];
  let gx = rand_gauss_f(key, STREAM_PART_MARKS, idx, 2u);
  let gy = rand_gauss_f(key, STREAM_PART_MARKS, idx, 4u);
  let fr = f32(m2) / f32(S.n);
  let x = (S.p0.x + (S.p1.x - S.p0.x) * fr) + gx * 1.4;
  let y = (S.p0.y + (S.p1.y - S.p0.y) * fr) + gy * 1.4;
  let p = sm_warp(vec2<f32>(x, y), vu.wobble);
  var tile = tt;
  var size = dot_base[tt] * 0.95;
  var cls = 0u;
  var rot: f32;
  if (rand_f32(key, STREAM_PART_MARKS, idx, 6u) < 0.04) {
    tile = pool[u32(floor(rand_f32(key, STREAM_PART_MARKS, idx, 7u) * f32(KNOT_POOL)))];
    size = (3.0 + 3.0 * rand_f32(key, STREAM_PART_MARKS, idx, 8u)) * vu.pen_dot;
    rot = rand_f32(key, STREAM_PART_MARKS, idx, 9u) * 6.28;
    cls = 1u;
  } else {
    rot = rand_f32(key, STREAM_PART_MARKS, idx, 7u) * 6.28;
  }
  let c = cos_f(rot);
  let s = sin_f(rot);
  marks_raw[i] = Instance(p, tile, 1.0, vec4<f32>(c * size, s * size, -(s * size), c * size));
  keys[i] = cls;
}

// ---------------------------------------------------------------------------------------------
// Compaction (ADR 0004), as compute/scan.wgsl but for one or two classes, 16 bits each

var<workgroup> tmp: array<u32, 256>;

fn one_hot(c: u32) -> u32 {
  if (c < 2u) {
    return 1u << (16u * c);
  }
  return 0u;
}

fn field16(v: u32, c: u32) -> u32 {
  return (v >> (16u * c)) & 0xffffu;
}

@compute @workgroup_size(256)
fn scan_local(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let i = wid.x * SCAN_BLOCK + lid.x;
  var c = DROP;
  if (i < job.n) {
    c = keys[i];
  }
  let one = one_hot(c);
  tmp[lid.x] = one;
  workgroupBarrier();
  for (var off = 1u; off < SCAN_BLOCK; off = off * 2u) {
    var v = tmp[lid.x];
    if (lid.x >= off) {
      v = v + tmp[lid.x - off];
    }
    workgroupBarrier();
    tmp[lid.x] = v;
    workgroupBarrier();
  }
  let inclusive = tmp[lid.x];
  if (i < job.n && c < 2u) {
    rank[i] = field16(inclusive - one, c);
  }
  if (lid.x == SCAN_BLOCK - 1u) {
    block_totals[wid.x] = inclusive;
  }
}

@compute @workgroup_size(1)
fn scan_blocks() {
  var run = array<u32, 2>(0u, 0u);
  for (var b = 0u; b < job.blocks; b++) {
    let t = block_totals[b];
    for (var c = 0u; c < 2u; c++) {
      block_offsets[b * 2u + c] = run[c];
      run[c] = run[c] + field16(t, c);
    }
  }
  if (job.mode == MODE_CAPS) {
    args[0] = 6u * run[0];
    args[1] = 1u;
    args[2] = 0u;
    args[3] = 0u;
  } else {
    for (var c = 0u; c < 2u; c++) {
      args[c * 4u] = 4u;
      args[c * 4u + 1u] = run[c];
      args[c * 4u + 2u] = 0u;
      args[c * 4u + 3u] = 0u;
    }
  }
}

@compute @workgroup_size(64)
fn scatter_caps(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= job.n) {
    return;
  }
  let c = keys[i];
  if (c != 0u) {
    return;
  }
  caps[block_offsets[(i / SCAN_BLOCK) * 2u] + rank[i]] = caps_raw[i];
}

@compute @workgroup_size(64)
fn scatter_marks(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= job.n) {
    return;
  }
  let c = keys[i];
  if (c >= 2u) {
    return;
  }
  marks[c * job.cap + block_offsets[(i / SCAN_BLOCK) * 2u + c] + rank[i]] = marks_raw[i];
}
