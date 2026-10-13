// The merger's test stars as marks (view tier). Reference: mergerSprites (app23.js:L481–536) and
// the debris of render() (L1234–1238). One thread per star: project the star orthographically with
// the camera and the frame (`view`, `px`, L500–516), keep its plate position for the tidal map, and
// classify it on its own counter (ADR 0004), where v21 walks one sequential stream:
//
//   a drawn star (probability 0.05 starMix, ×1.6 in the tails, L520), bright in a tail one time in
//   four: a drawn star replaces the dot (class rstar, classified and counted; M7 draws it);
//   in a tail beyond 1.15 of its galaxy's truncation radius, with probability 0.012 (0.4 + knots), a
//   knot of new stars: 5 to 11 knots round it and a bright drawn star (L522–524);
//   an outer star (R0 > 0.45) with probability 0.035 (0.4 + knots), a knot (L525);
//   with probability 0.004 (0.3 + sparkle), a sparkle star (L526);
//   else a dot, `young` for an outer star, `disc` for the rest (L527).
//
// Then render()'s thinning of the debris (L1236–1238): only 16% of the dots, 60% of the knots and
// 50% of the drawn stars are kept. A star may make up to 12 marks, so the output has 12 slots a star:
// slots 0 to 10 hold the knots or the one mark, slot 11 a drawn star. The slots go to the stipple's
// compaction (compute/scan.wgsl) as one list. An elliptical galaxy's stars are never starred, knotted
// or tail-knotted (`hot`, L519). v21 builds each core's bulge dots here and never draws them
// (render() keeps only disc, young, knots, stars and rstars of this list, L1236): they are not made.
//
// CPU twin: src/fallback/kernels/merger-sprites.ts, function for function (ADR 0014).

// #import "common/instance.wgsl"
// #import "common/rng.wgsl"
// #import "common/math.wgsl"
// #import "common/tide.wgsl"

// MVIEW_LAYOUT in src/fallback/kernels/merger-sprites.ts
struct MView {
  // the cores at this moment (xyz, w = the truncation radius rmax)
  c0: vec4<f32>,
  c1: vec4<f32>,
  // each disc's (arms, pitch, lane strength, smooth halo)
  pa0: vec4<f32>,
  pa1: vec4<f32>,
  cos_i: f32,
  sin_i: f32,
  cos_az: f32,
  sin_az: f32,
  cos_pa: f32,
  sin_pa: f32,
  // plate px per galaxy unit (MS.sc), the frame centre in the view frame, the plate centre
  sc: f32,
  fcx: f32,
  fcy: f32,
  fcz: f32,
  persp: f32,
  zshrink: f32,
  vcx: f32,
  vcy: f32,
  star_mix: f32,
  knots: f32,
  sparkle: f32,
  pen_dot: f32,
  spike: f32,
  keep_dots: f32,
  keep_knots: f32,
  keep_rstars: f32,
  n: u32,
  n0: u32,
  key: u32,
  n_dot_pool: u32,
  n_knot_pool: u32,
  n_star_tiles: u32,
  // elliptical galaxies (1) have no drawn stars, tail knots or outer knots
  hot0: u32,
  hot1: u32,
  // ADR 0093: 1 keeps the galaxies' character; the cores' separation in units of their radii
  mauto: f32,
  stage: f32,
}

const STREAM_MERGER_SPRITES: u32 = 41u;
const SLOTS: u32 = 12u;
const STREAM_MERGER_INIT: u32 = 10u;
// the share of a disc's test stars that is gas (src/sim/merger.ts MERGER_GAS_FRAC, ADR 0098)
const GAS_FRAC: f32 = 0.3;
const KNOT_POOL: u32 = 24u;
const CLS_OLD: u32 = 0u;
const CLS_DISC: u32 = 1u;
const CLS_YOUNG: u32 = 2u;
const CLS_KNOT: u32 = 3u;
const CLS_STAR: u32 = 4u;
const CLS_RSTAR: u32 = 5u;
const CLS_NONE: u32 = 255u;

@group(0) @binding(0) var<uniform> mv: MView;
@group(0) @binding(1) var<storage, read> cur: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> ic: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> pool: array<u32>;
@group(0) @binding(4) var<storage, read> dot_base: array<f32>;
@group(0) @binding(6) var<storage, read_write> projected: array<Instance>;
@group(0) @binding(7) var<storage, read_write> classes: array<u32>;

fn u01(i: u32, d: u32) -> f32 {
  return rand_f32(mv.key, STREAM_MERGER_SPRITES, i, d);
}

fn gauss(i: u32, d: u32) -> f32 {
  return rand_gauss_f(mv.key, STREAM_MERGER_SPRITES, i, d);
}

// simple(size, rot) (app23.js:L173)
fn simple(size: f32, rot: f32) -> vec4<f32> {
  let c = cos_f(rot);
  let s = sin_f(rot);
  return vec4<f32>(c * size, s * size, -(s * size), c * size);
}

fn put(slot: u32, cls: u32, pos: vec2<f32>, tile: u32, alpha: f32, m: vec4<f32>) {
  projected[slot] = Instance(pos, tile, alpha, m);
  classes[slot] = cls;
}

// mstar (L511–512): a drawn star, small, or bright (an outline). Classified and counted; its mark
// is a vector drawing (M7), so the instance carries only the place, the alpha and a size.
fn mstar(i: u32, base: u32, pos: vec2<f32>, bright: bool) {
  if (u01(i, base + 6u) >= mv.keep_rstars) {
    return;
  }
  var size = exp(log(4.6) + 0.38 * gauss(i, base + 2u)) * pen_k;
  var alpha = 0.42;
  if (bright) {
    size = (9.0 + 9.0 * exp(2.4 * log(max(u01(i, base + 1u), 1e-9)))) * pen_k;
    alpha = 0.58;
  }
  let rot = mv.spike + gauss(i, base + 4u) * 0.2;
  put(i * SLOTS + 11u, CLS_RSTAR, pos, 0u, alpha, simple(size, rot));
}

var<private> pen_k: f32 = 1.0;


@compute @workgroup_size(64)
fn sprites(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= mv.n) {
    return;
  }
  let o = i * SLOTS;
  for (var s = 0u; s < SLOTS; s++) {
    classes[o + s] = CLS_NONE;
  }
  // view(x, y, z) (L500), then px (L516)
  let raw = cur[i].xyz;
  var second = false;
  if (i >= mv.n0) {
    second = true;
  }
  var core = mv.c0;
  var pa = mv.pa0;
  var hot = mv.hot0 != 0u;
  var g = 0u;
  if (second) {
    g = 1u;
    core = mv.c1;
    pa = mv.pa1;
    hot = mv.hot1 != 0u;
  }
  let mauto = mv.mauto != 0.0;
  let rn = ic[i].z;
  let p3 = raw;
  let xr = p3.x * mv.cos_az - p3.y * mv.sin_az;
  let yr = p3.x * mv.sin_az + p3.y * mv.cos_az;
  let yy = yr * mv.cos_i - p3.z * mv.sin_i;
  let vx = xr * mv.cos_pa - yy * mv.sin_pa;
  let vy = xr * mv.sin_pa + yy * mv.cos_pa;
  let p = vec2<f32>(mv.vcx + (vx - mv.fcx) * mv.sc, mv.vcy + (vy - mv.fcy) * mv.sc);
  // the tidal map's table of plate positions
  tide[tide[1] + i * 4u] = bitcast<u32>(p.x);
  tide[tide[1] + i * 4u + 1u] = bitcast<u32>(p.y);

  let d = raw - core.xyz;
  let dcore = sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
  let in_tail = !hot && dcore > 1.15 * core.w;
  let outer = ic[i].z > 0.45;
  let roll = u01(i, 0u);
  let lane = pa.z;
  var smooth_halo = false;
  if (mauto && pa.w != 0.0) {
    smooth_halo = true;
  }
  var pen = mv.pen_dot;
  var dk_out = 1.0;
  if (mv.persp != 0.0) {
    let vz = yr * mv.sin_i + p3.z * mv.cos_i;
    let dk = 1.0 / max(1.0 - (vz - mv.fcz) * mv.persp, 0.3);
    pen = (mv.pen_dot * dk) * mv.zshrink;
    dk_out = dk * mv.zshrink;
  }
  tide[tide[8] + i] = bitcast<u32>(dk_out);
  pen_k = pen;

  if (mauto && lane > 0.0) {
    // dust lanes on the trailing edge of each arm, carried along with the stars that make them
    let R = rn * core.w;
    if (R > 0.12 && pa.x > 0.0) {
      let th0 = atan2(ic[i].y, ic[i].x);
      let base = log(max(R, 0.1) / 0.1) / pa.y;
      var near = 9.0;
      for (var k = 0u; k < u32(pa.x); k++) {
        let ph = (base + 6.283185307179586 * f32(k) / pa.x) - 0.22;
        near = min(near, abs(wrap_pi(th0 - ph)));
      }
      if (near < 0.09 && u01(i, 190u) < lane * 0.85) {
        return;
      }
    }
    // a dusty bridge between the two galaxies, while they are still apart
    let o3 = mv.c1.xyz - mv.c0.xyz;
    let L2 = dot(o3, o3);
    if (L2 > 1e-6) {
      let q = raw - mv.c0.xyz;
      let t = dot(q, o3) / L2;
      if (t > 0.12 && t < 0.88) {
        let e = q - t * o3;
        let d2 = dot(e, e);
        if (d2 < 0.01 * L2 && u01(i, 191u) < 0.6 * (lane * smoothstep(0.2, 0.7, mv.stage))) {
          return;
        }
      }
    }
  }

  // a drawn star in place of the dot
  var p_star = 0.05 * mv.star_mix;
  if (in_tail) {
    p_star = p_star * 1.6;
  }
  if (!hot && mv.star_mix > 0.01 && u01(i, 1u) < p_star) {
    mstar(i, 3u, p, in_tail && u01(i, 2u) < 0.25);
    return;
  }
  // a knot of new stars in a tidal tail
  var tail_k = 1.0;
  if (mauto) {
    tail_k = 2.0;
  }
  if (in_tail && roll < (0.012 * tail_k) * (0.4 + mv.knots)) {
    // a tidal dwarf: a tight, brighter clump of new stars
    let dwarf = mauto && u01(i, 11u) < 0.2;
    var nk = 5u + u32(floor(u01(i, 10u) * 7.0));
    var spread = 5.0;
    var grow = 1.0;
    if (dwarf) {
      nk = 11u;
      spread = 2.2;
      grow = 1.3;
    }
    for (var j = 0u; j < nk; j++) {
      let b = 20u + j * 8u;
      if (u01(i, 172u + j) < mv.keep_knots) {
        let kp = vec2<f32>(p.x + gauss(i, b) * spread * pen, p.y + gauss(i, b + 2u) * spread * pen);
        let t = pool[u32(floor(u01(i, b + 4u) * f32(mv.n_knot_pool)))];
        put(o + j, CLS_KNOT, kp, t, 1.0, simple(((3.0 + 4.0 * u01(i, b + 5u)) * grow) * pen, u01(i, b + 6u) * 6.28));
      }
    }
    mstar(i, 130u, p, true);
    return;
  }
  // star formation where the discs press on each other
  var oc = mv.c1;
  if (second) {
    oc = mv.c0;
  }
  let od = raw - oc.xyz;
  let comp = mauto && !hot && sqrt(dot(od, od)) < 0.9 * oc.w;
  // the gas the merger has driven into a nucleus lights up: a nuclear starburst, fiercest when the
  // discs have overlapped (ADR 0098)
  if (mauto && !hot && pa.w == 0.0 && rand_f32(mv.key, STREAM_MERGER_INIT, i, 220u) < GAS_FRAC) {
    let dn = min(dcore / core.w, sqrt(dot(od, od)) / oc.w);
    let burst = 1.0 - smoothstep(0.3, 1.2, mv.stage);
    let gp = 0.55 * (1.0 - smoothstep(0.12, 0.8, dn)) * (0.25 + 0.75 * burst);
    if (u01(i, 215u) < gp) {
      if (u01(i, 171u) < mv.keep_knots) {
        let t = pool[u32(floor(u01(i, 216u) * f32(mv.n_knot_pool)))];
        put(o, CLS_KNOT, p, t, 1.0, simple((3.0 + 4.0 * u01(i, 217u)) * pen, u01(i, 218u) * 6.28));
      }
      return;
    }
  }
  let knot_p = 0.035 * (0.4 + mv.knots);
  if (!hot && ((outer && roll < knot_p) || (comp && roll < knot_p * 1.6))) {
    if (u01(i, 171u) < mv.keep_knots) {
      let t = pool[u32(floor(u01(i, 140u) * f32(mv.n_knot_pool)))];
      put(o, CLS_KNOT, p, t, 1.0, simple((4.0 + 5.0 * u01(i, 141u)) * pen, u01(i, 142u) * 6.28));
    }
    return;
  }
  if (roll > 1.0 - 0.004 * (0.3 + mv.sparkle)) {
    let tile = u32(floor(u01(i, 150u) * f32(mv.n_star_tiles)));
    put(o, CLS_STAR, p, tile, 1.0, simple(10.0 + 10.0 * u01(i, 151u), u01(i, 152u) * 6.28));
    return;
  }
  // a dot, thinned to 16% (L1236)
  var keep_d = mv.keep_dots;
  if (smooth_halo) {
    keep_d = mv.keep_dots * 1.5;
  }
  if (u01(i, 170u) < keep_d) {
    let t = pool[KNOT_POOL + u32(floor(u01(i, 160u) * f32(mv.n_dot_pool)))];
    var cls = CLS_DISC;
    if (outer) {
      cls = CLS_YOUNG;
    }
    var sz = dot_base[t];
    if (smooth_halo) {
      sz = sz * (0.55 + 0.45 * smoothstep(0.0, 0.35, rn));
    }
    put(o, cls, p, t, 1.0, simple(sz, u01(i, 161u) * 6.28));
  }
}
