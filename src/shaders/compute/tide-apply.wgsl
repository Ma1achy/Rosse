// A merging galaxy carried by the tides (ADR 0009). In v21 the screen map `SM` of a merging galaxy is
// `post` after the hand wobble's (app23.js:L1248): every bitmap mark's centre goes through `inst`
// (L171), every ribbon vertex through `buildCurves` (L831), and a ribbon segment is torn where the
// tides stretch it (L832–834). These passes apply `post` (common/tide.wgsl `tide_post`) in place to
// the galaxy's own outputs, after the single-galaxy kernels have made them, so those kernels
// stay as they are:
//
//   warp_instances  a list of sprite instances (the stipple's, the pieces', the hatching's dots and
//                   knots, the cores): the centre only, a mark keeps its shape. The count is `n`, or
//                   word `args_index + 1` of `args` (a compaction's indirect draw arguments);
//   warp_ribbons    textured ribbon segments: the four corners, and the segment is torn (its alpha
//                   made 0) when the stretch along the stroke or across it exceeds 1.8 (the
//                   lengths taken with the reference's + 1), or the warped length along it exceeds
//                   SEAMMAX = 30;
//   warp_caps       the hatching's capsules: the two ends, torn as expandVector tears a warped
//                   segment (L1207–1208): longer than 22 px, or stretched more than 1.8 (+ 0.8).
//
// v21 order: the tide first, then the hand wobble; here the wobble came first (a merger's galaxies
// are built with `distort` 0 in the presets, so the difference is not drawn).
//
// CPU twin: src/fallback/kernels/tide.ts, function for function (ADR 0014).

// #import "common/instance.wgsl"
// #import "common/tide.wgsl"

// TJOB_LAYOUT in src/fallback/kernels/tide.ts
struct TJob {
  g: u32,
  n: u32,
  use_args: u32,
  args_index: u32,
  // R2 = 2 * 4.2 * s0, plate px
  r2: f32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

// RIBBON_SEG_LAYOUT: the four corners (end j: +n, -n; end j+1: +n, -n), plate units
struct RibbonSeg {
  a: vec4<f32>,
  b: vec4<f32>,
  u: vec2<f32>,
  layer: u32,
  alpha: f32,
}

// CAPSULE_LAYOUT
struct Capsule {
  a: vec2<f32>,
  b: vec2<f32>,
  w: f32,
  alpha: f32,
  pad0: f32,
  pad1: f32,
}

const SEAMMAX: f32 = 30.0;
const TEAR: f32 = 1.8;

@group(0) @binding(1) var<uniform> job: TJob;
@group(0) @binding(2) var<storage, read_write> insts: array<Instance>;
@group(0) @binding(3) var<storage, read_write> segs: array<RibbonSeg>;
@group(0) @binding(4) var<storage, read_write> caps: array<Capsule>;
@group(0) @binding(5) var<storage, read> args: array<u32>;

fn dist(a: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = b - a;
  return sqrt(d.x * d.x + d.y * d.y);
}

@compute @workgroup_size(64)
fn warp_instances(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  var n = job.n;
  if (job.use_args != 0u) {
    n = min(n, args[job.args_index + 1u]);
  }
  if (i >= n) {
    return;
  }
  let s = insts[i];
  insts[i] = Instance(tide_post(job.g, s.pos, job.r2), s.layer, s.alpha, s.m);
}

@compute @workgroup_size(64)
fn warp_ribbons(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= job.n) {
    return;
  }
  let s = segs[i];
  let c0 = s.a.xy;
  let c1 = s.a.zw;
  let c2 = s.b.xy;
  let c3 = s.b.zw;
  // the stroke's length and width before the tides (+ 1, L834)
  let ol = dist(c0, c2) + 1.0;
  let ow = dist(c0, c1) + 1.0;
  let w0 = tide_post(job.g, c0, job.r2);
  let w1 = tide_post(job.g, c1, job.r2);
  let w2 = tide_post(job.g, c2, job.r2);
  let w3 = tide_post(job.g, c3, job.r2);
  let ml = dist(w0, w2);
  let mw = dist(w0, w1);
  var alpha = s.alpha;
  if (ml > SEAMMAX || ml / ol > TEAR || mw / ow > TEAR) {
    alpha = 0.0;
  }
  segs[i] = RibbonSeg(vec4<f32>(w0, w1), vec4<f32>(w2, w3), s.u, s.layer, alpha);
}

@compute @workgroup_size(64)
fn warp_caps(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= job.n) {
    return;
  }
  let c = caps[i];
  let a = tide_post(job.g, c.a, job.r2);
  let b = tide_post(job.g, c.b, job.r2);
  // expandVector: a warped segment longer than 22 px is dropped, and one stretched more than 1.8
  // (the original's length + 0.8) under `post` (L1207-1208)
  let ml = dist(a, b);
  let ol = dist(c.a, c.b) + 0.8;
  var alpha = c.alpha;
  if (ml > 22.0 || ml / ol > TEAR) {
    alpha = 0.0;
  }
  caps[i] = Capsule(a, b, c.w, alpha, 0.0, 0.0);
}
