// The marks of a star or an artefact (starSprites, app23.js:L398-439), one per slot (view tier).
// The jobs (src/model/stars.ts `starJobs`) say what each run of slots is; each invocation finds its
// job by binary search on the jobs' first slots and makes its mark from its own counter of the
// `stars` stream (index = the job's stream index + its place in the job, draw = a local counter),
// so a zoom that adds marks keeps the ones it had (ADR 0004). A mark the reference would have
// rejected is class CLS_NONE. Output: the stipple's `projected` and `classes` at out_base + slot,
// so the marks are compacted with the stipple's and drawn in the same layers (v21 `merge`, L456).
// A mark whose draw DRAW_KEEP is not below its job's keep (exp(-tau) of the dust in front of the
// star, ADR 0074) is class CLS_NONE too: the whole star thins evenly (v21 never dims the star).
//
// Every mark is a bitmap sprite (a dot or a knot) of alpha 1 through the hand wobble (app23.js:L171),
// except the drawn star at the core, a vector drawing (class CLS_RSTAR): its alpha is its pen
// scale and the wobble acts on each of its points (compute/vector-expand.wgsl).
//
// CPU twin: src/fallback/kernels/star-marks.ts, branch for branch.

// #import "common/instance.wgsl"
// #import "common/rng.wgsl"
// #import "common/math.wgsl"
// #import "common/noise-table.wgsl"
// #import "common/stipple-types.wgsl"
// #import "common/warp.wgsl"

// STAR_JOB_LAYOUT in src/model/stars.ts
struct StarJob {
  c: vec2<f32>,
  a: f32,
  b: f32,
  p0: f32,
  p1: f32,
  p2: f32,
  p3: f32,
  kind: u32,
  first: u32,
  n: u32,
  index: u32,
  q: u32,
  // the share of the star's marks the dust in front of it lets through, exp(-tau); 1 for none
  keep: f32,
  pad1: u32,
  pad2: u32,
}

// STAR_UNIFORM_LAYOUT
struct StarU {
  n_jobs: u32,
  n_slots: u32,
  key: u32,
  n_dot_pool: u32,
  pen_dot: f32,
  wobble: f32,
  out_base: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
  pad3: u32,
  pad4: u32,
}

// StarKind in src/model/stars.ts
const K_HEART: u32 = 0u;
const K_GLARE: u32 = 1u;
const K_SPIKE: u32 = 2u;
const K_RING: u32 = 3u;
const K_BLEED: u32 = 4u;
const K_DRAWN: u32 = 5u;
const K_TRAIL: u32 = 6u;
const K_GHOST_DISC: u32 = 7u;
const K_GHOST_RING: u32 = 8u;
const K_COSMIC: u32 = 9u;

// NoiseSalt in src/core/noise.ts
const SALT_STAR_RING: u32 = 11u;
const SALT_STAR_TRAIL: u32 = 12u;
const SALT_STAR_GHOST: u32 = 13u;

const STREAM_STARS: u32 = 9u;
const KNOT_POOL: u32 = 24u;
// the draw that decides whether the dust passes a mark: after every draw the marks make (0 to 4)
const DRAW_KEEP: u32 = 5u;

@group(0) @binding(0) var<uniform> su: StarU;
@group(0) @binding(1) var<storage, read> jobs: array<StarJob>;
@group(0) @binding(2) var<storage, read> pool: array<u32>;
@group(0) @binding(3) var<storage, read> dot_base: array<f32>;
@group(0) @binding(4) var<storage, read_write> projected: array<Instance>;
@group(0) @binding(5) var<storage, read_write> classes: array<u32>;

var<private> idx: u32;
// the keep of the job the mark being made belongs to
var<private> job_keep: f32;

fn r(d: u32) -> f32 {
  return rand_f32(su.key, STREAM_STARS, idx, d);
}

fn dot_tile(d: u32) -> u32 {
  return pool[KNOT_POOL + u32(floor(r(d) * f32(su.n_dot_pool)))];
}

fn knot_tile(d: u32) -> u32 {
  return pool[u32(floor(r(d) * f32(KNOT_POOL)))];
}

fn rot6(d: u32) -> f32 {
  return r(d) * 6.28;
}

// the last job whose first slot is at or before slot
fn job_of(slot: u32) -> u32 {
  var lo = 0u;
  var hi = su.n_jobs;
  while (hi - lo > 1u) {
    let mid = (lo + hi) >> 1u;
    if (jobs[mid].first <= slot) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// a bitmap mark at p through the hand wobble: a square of `size` turned by `rot`
fn sprite(i: u32, p: vec2<f32>, tile: u32, size: f32, rot: f32, cls: u32) -> u32 {
  let w = sm_warp(p, su.wobble);
  let c = cos_f(rot);
  let s = sin_f(rot);
  projected[i] = Instance(w, tile, 1.0, vec4<f32>(c * size, s * size, -(s * size), c * size));
  return cls;
}

fn dot_mark(i: u32, p: vec2<f32>, k: f32, cls: u32, d_tile: u32, d_rot: u32) -> u32 {
  let t = dot_tile(d_tile);
  return sprite(i, p, t, dot_base[t] * k, rot6(d_rot), cls);
}

fn make(slot: u32, i: u32) -> u32 {
  let J = jobs[job_of(slot)];
  let local = slot - J.first;
  idx = J.index + local;
  job_keep = J.keep;
  let c = J.c;
  let a = J.a;
  let b = J.b;
  let q = J.q;
  switch J.kind {
    case K_HEART: {
      // the saturated heart: knots within 0.6 core, thickest at the centre
      let ang = r(0u) * TAU;
      let d = (pow(r(1u), 1.6) * a) * 0.6;
      let size = (3.0 + 4.0 * r(3u)) * su.pen_dot;
      return sprite(
        i,
        vec2<f32>(c.x + cos_f(ang) * d, c.y + sin_f(ang) * d),
        knot_tile(2u),
        size,
        rot6(4u),
        CLS_KNOT,
      );
    }
    case K_GLARE: {
      // a power-law fall-off: d = core (1 - 0.99u)^-0.62, nothing beyond `b`
      let ang = r(0u) * TAU;
      let d = a * pow(1.0 - r(1u) * 0.99, -0.62);
      if (d > b) {
        return CLS_NONE;
      }
      var k = 0.85;
      if (d < a * 2.0) {
        k = 1.1;
      }
      var cls = CLS_DISC;
      if (d < a * 2.2) {
        cls = CLS_OLD;
      }
      return dot_mark(i, vec2<f32>(c.x + cos_f(ang) * d, c.y + sin_f(ang) * d), k, cls, 2u, 3u);
    }
    case K_SPIKE: {
      // along the spike's direction p0 from 0.6 core out to `b`, across it by a taper
      let dd = a * 0.6 + pow(r(0u), 1.7) * b;
      let w = (1.2 + 3.0 * (1.0 - dd / b)) * (r(1u) - 0.5);
      let ca = cos_f(J.p0);
      let sa = sin_f(J.p0);
      return dot_mark(
        i,
        vec2<f32>((c.x + ca * dd) - sa * w, (c.y + sa * dd) + ca * w),
        0.8 + 0.4 * (1.0 - dd / b),
        CLS_DISC,
        2u,
        3u,
      );
    }
    case K_RING: {
      // a faint ring in the glare, broken where the noise is low
      let ang = r(0u) * TAU;
      let nz = vnoise_t(cos_f(ang) * 2.0 + f32(q), sin_f(ang) * 2.0, su.key, SALT_STAR_RING);
      if (nz < 0.35) {
        return CLS_NONE;
      }
      let d = b * (1.0 + (r(1u) - 0.5) * 0.05);
      return dot_mark(i, vec2<f32>(c.x + cos_f(ang) * d, c.y + sin_f(ang) * d), 0.8, CLS_YOUNG, 2u, 3u);
    }
    case K_BLEED: {
      // the saturation bleed column: a vertical smear, narrower at its ends
      let by = (r(0u) * 2.0 - 1.0) * a;
      let bx = (r(1u) - 0.5) * (2.0 + 3.0 * (1.0 - abs(by) / a));
      return dot_mark(i, vec2<f32>(c.x + bx, c.y + by), 0.9, CLS_OLD, 2u, 3u);
    }
    case K_DRAWN: {
      // one of the star drawings at the core: a vector mark, alpha = its pen scale
      let cs = cos_f(J.p0);
      let sn = sin_f(J.p0);
      projected[i] = Instance(c, q, J.p1, vec4<f32>(cs * a, sn * a, -(sn * a), cs * a));
      return CLS_RSTAR;
    }
    case K_TRAIL: {
      // a satellite's line: `a` its half length, `b` the gap of this line, `q` its index
      let tt = (r(0u) * 2.0 - 1.0) * a;
      let flick = 0.6 + 0.4 * vnoise_t(tt * 0.04 + f32(q) * 9.0, 0.0, su.key, SALT_STAR_TRAIL);
      let w = (r(1u) - 0.5) * (2.2 + 1.5 * flick);
      if (r(2u) > flick) {
        return CLS_NONE;
      }
      let ca = cos_f(J.p0);
      let sa = sin_f(J.p0);
      let wb = w + b;
      var cls = CLS_OLD;
      if (q != 0u) {
        cls = CLS_DISC;
      }
      return dot_mark(
        i,
        vec2<f32>((c.x + ca * tt) - sa * wb, (c.y + sa * tt) + ca * wb),
        0.9 + 0.3 * flick,
        cls,
        3u,
        4u,
      );
    }
    case K_GHOST_DISC: {
      // the reflection: a ragged annulus between R0 (`a`) and R1 (`b`), two in three disc, the rest young
      let ang = r(0u) * TAU;
      let gd = a + (b - a) * sqrt(r(1u));
      let nz = vnoise_t(cos_f(ang) * 1.5 + 3.0, sin_f(ang) * 1.5, su.key, SALT_STAR_GHOST);
      if (r(2u) > 0.55 + 0.45 * nz) {
        return CLS_NONE;
      }
      var cls = CLS_DISC;
      if (local % 3u == 0u) {
        cls = CLS_YOUNG;
      }
      return dot_mark(i, vec2<f32>(c.x + cos_f(ang) * gd, c.y + sin_f(ang) * gd), 0.75, cls, 3u, 4u);
    }
    case K_GHOST_RING: {
      // the reflection's bright edge at R1
      let ang = r(0u) * TAU;
      let gd = b * (1.0 + (r(1u) - 0.5) * 0.04);
      return dot_mark(i, vec2<f32>(c.x + cos_f(ang) * gd, c.y + sin_f(ang) * gd), 0.9, CLS_OLD, 2u, 3u);
    }
    case K_COSMIC: {
      if (local < q) {
        // a sharp little hit: dots along a segment of length `a`, through its centre
        let hd = (f32(local) / b - 0.5) * a;
        return dot_mark(i, vec2<f32>(c.x + cos_f(J.p0) * hd, c.y + sin_f(J.p0) * hd), 1.05, CLS_OLD, 0u, 1u);
      }
      if (J.p1 == 0.0) {
        return CLS_NONE;
      }
      return sprite(i, c, knot_tile(1u), (3.0 + 2.0 * r(0u)) * su.pen_dot, rot6(2u), CLS_KNOT);
    }
    default: {
      return CLS_NONE;
    }
  }
}

@compute @workgroup_size(64)
fn star_marks(@builtin(global_invocation_id) id: vec3<u32>) {
  let slot = id.x;
  if (slot >= su.n_slots) {
    return;
  }
  let i = su.out_base + slot;
  projected[i] = Instance(vec2<f32>(0.0), 0u, 0.0, vec4<f32>(0.0));
  var cls = make(slot, i);
  // the dust in front of the star thins all its marks by the same share (ADR 0074)
  if (cls != CLS_NONE && !(r(DRAW_KEEP) < job_keep)) {
    cls = CLS_NONE;
  }
  classes[i] = cls;
}
