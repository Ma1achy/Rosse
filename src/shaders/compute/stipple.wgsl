// Model sampling (the model tier, ADR 0010): one invocation per candidate sample of the bulge,
// halo, bar, ring and disc (or a smooth galaxy's Sersic profile), each with its own bounded
// rejection loop on its own random draws (Stream.stipple, index = sample, draw = local counter),
// classified as a dot (old, disc or young population), a knot, a sparkle star or a drawn star.
// Nothing here depends on the camera: the dust optical depth is culled in compute/project.wgsl
// from the uniform stored in u_tau, so orbiting never re-rolls the stipple (ADR 0004).
//
// Reference: generate (app23.js:L221-273). CPU twin: src/fallback/kernels/stipple.ts, which has
// the same structure, line for line; a change here is a change there (ADR 0014).

// #import "common/rng.wgsl"
// #import "common/math.wgsl"
// #import "common/noise-table.wgsl"
// #import "common/stipple-types.wgsl"

// The galaxy description: GALAXY_LAYOUT in src/model/galaxy.ts.
struct Galaxy {
  seed: u32,
  n: u32,
  arms: u32,
  n_var_arms: u32,
  n_spurs: u32,
  n_dust: u32,
  n_dot_pool: u32,
  n_knot_pool: u32,
  n_star_tiles: u32,
  flags: u32,
  key: u32,
  n_groups: u32,
  c_bulge: f32,
  c_halo: f32,
  c_bar: f32,
  c_ring: f32,
  tot: f32,
  bulge_a: f32,
  bulge_flat: f32,
  bar_len: f32,
  ring_r: f32,
  thick: f32,
  pitch: f32,
  arm_strength: f32,
  arm_width: f32,
  flocc: f32,
  arm_r0: f32,
  arm_inner: f32,
  patchy: f32,
  irr: f32,
  sersic_n: f32,
  sersic_b: f32,
  re: f32,
  dust: f32,
  star_mix: f32,
  knots: f32,
  sparkle: f32,
  pen_dot: f32,
  lop: f32,
  lop_a: f32,
  warp: f32,
  warp_a: f32,
  rmax: f32,
  n_extra: u32,
}

// A ring-knot cluster or a clump (GROUP_LAYOUT in src/model/galaxy.ts, src/model/clumps.ts).
struct Group {
  c: vec3<f32>,
  s: f32,
  // its first extra sample
  first: u32,
  // marks, then drawn stars
  count: u32,
  rstars: u32,
  // kind in the low byte (0 ring knots, 1 clump), the group's index within its kind above
  tag: u32,
}

// Layout of `shape` (SHAPE in src/model/galaxy.ts)
const SHAPE_ARMS: u32 = 0u;
const SHAPE_SPURS: u32 = 12u;
const SHAPE_DUST: u32 = 20u;
const KNOT_POOL: u32 = 24u;

const FLAG_ARMS_ON: u32 = 1u;
const FLAG_SERSIC: u32 = 2u;

// noise salts (NoiseSalt in src/core/noise.ts)
const SALT_FLOCC: u32 = 1u;
const SALT_PATCHY: u32 = 2u;
const SALT_IRR: u32 = 3u;
const SALT_RING: u32 = 4u;

const STREAM_STIPPLE: u32 = 2u;
const STREAM_CLUMPS: u32 = 5u;
const STREAM_RING_KNOTS: u32 = 15u;
const GROUP_STRIDE: u32 = 256u;
const DEG: f32 = 0.0174532925199433;

@group(0) @binding(0) var<uniform> galaxy: Galaxy;
@group(0) @binding(1) var<storage, read> shape: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> pool: array<u32>;
@group(0) @binding(3) var<storage, read> dot_base: array<f32>;
@group(0) @binding(4) var<storage, read_write> samples: array<Sample>;
@group(0) @binding(5) var<storage, read> groups: array<Group>;

// The draws of one sample.
var<private> rng_stream: u32 = STREAM_STIPPLE;
var<private> rng_index: u32;
var<private> rng_draw: u32;

fn next() -> f32 {
  let x = rand_f32(galaxy.key, rng_stream, rng_index, rng_draw);
  rng_draw = rng_draw + 1u;
  return x;
}

fn gauss() -> f32 {
  let g = rand_gauss_f(galaxy.key, rng_stream, rng_index, rng_draw);
  rng_draw = rng_draw + 2u;
  return g;
}

// armPhase(R, k) (app23.js:L127)
fn arm_phase(R: f32, k: u32) -> f32 {
  let r0 = galaxy.arm_r0;
  let a = (k % galaxy.n_var_arms) * 2u + SHAPE_ARMS;
  let s0 = shape[a];
  let s1 = shape[a + 1u];
  let pitch = galaxy.pitch * s0.x;
  var ph = log(max(R, r0) / r0) / tan_f(clamp(pitch, 4.0, 60.0) * DEG);
  ph = (ph + s0.z) + s1.x * sin_f(R * s1.y + s1.z);
  return ph;
}

// armProfile(R, th) (app23.js:L132-144): the arm density, with spurs and flocculence.
fn arm_profile(R: f32, th: f32) -> f32 {
  let arms = galaxy.arms;
  if (arms < 1u) {
    return 0.0;
  }
  let per = TAU / f32(arms);
  let half = per / 2.0;
  let w = galaxy.arm_width;
  let w2 = w * w;
  var fv = 0.0;
  for (var k = 0u; k < arms; k++) {
    let a = (k % galaxy.n_var_arms) * 2u + SHAPE_ARMS;
    let s0 = shape[a];
    let rmax = s0.w;
    if (R > rmax + 0.4) {
      continue;
    }
    let d = wrap_pi((th - arm_phase(R, k)) - per * f32(k));
    let x = d / half;
    var gk = exp(-(x * x) / w2) * s0.y;
    if (R > rmax) {
      gk = gk * max(0.0, 1.0 - (R - rmax) / 0.4);
    }
    if (gk > fv) {
      fv = gk;
    }
  }
  for (var i = 0u; i < galaxy.n_spurs; i++) {
    let sp = shape[SHAPE_SPURS + i];
    let sk = sp.x;
    let R0 = sp.y;
    let len = sp.z;
    let pk = sp.w;
    if (R < R0 || R > R0 + len) {
      continue;
    }
    let base = arm_phase(R0, u32(sk)) + per * sk;
    let want = base + log(R / R0) / tan_f(clamp(galaxy.pitch * pk, 10.0, 70.0) * DEG);
    let ds = wrap_pi(th - want) / half;
    let gs = (0.8 * exp(-(ds * ds) / (0.5 * w2))) * (1.0 - (R - R0) / len);
    if (gs > fv) {
      fv = gs;
    }
  }
  let flocc = galaxy.flocc;
  if (flocc > 0.0) {
    let n = vnoise_t(R * 2.2 + 11.0, (th - arm_phase(R, 0u)) * 1.6, galaxy.seed, SALT_FLOCC);
    fv = fv * ((1.0 - flocc) + flocc * max(0.0, (n - 0.35) * 2.2));
  }
  let inner = galaxy.arm_inner;
  if (R < inner) {
    fv = fv * (R / inner);
  }
  return fv;
}

// Marsaglia and Tsang's gamma sampler (gammaS, app23.js:L76), bounded at 64 tries.
fn gamma_s(k: f32) -> f32 {
  var boost = 1.0;
  var kk = k;
  if (kk < 1.0) {
    boost = pow(next(), 1.0 / kk);
    kk = kk + 1.0;
  }
  let d = kk - 1.0 / 3.0;
  let c = 1.0 / sqrt(9.0 * d);
  for (var t = 0; t < 64; t++) {
    let x = gauss();
    let b = 1.0 + c * x;
    let v = (b * b) * b;
    if (v <= 0.0) {
      continue;
    }
    let u = next();
    if (log(u) < ((0.5 * x) * x + d - d * v) + d * log(v)) {
      return (d * v) * boost;
    }
  }
  return d * boost;
}

fn put(i: u32, p: vec3<f32>, cls: u32, tile: u32, size: f32, rot: f32, u_tau: f32) {
  samples[i] = Sample(p, cls, tile, size, rot, u_tau);
}

fn dot_tile() -> u32 {
  let n = galaxy.n_dot_pool;
  return pool[KNOT_POOL + min(n - 1u, u32(floor(next() * f32(n))))];
}

fn sample(i: u32) {
  rng_index = i;
  rng_draw = 0u;
  let rmax = galaxy.rmax;
  let flags = galaxy.flags;
  let none = vec3<f32>(0.0);

  let u = next() * galaxy.tot;
  // components: 0 bulge, 1 halo, 2 bar, 3 ring, 4 disc
  var comp = 4u;
  if (u < galaxy.c_bulge) {
    comp = 0u;
  } else if (u < galaxy.c_halo) {
    comp = 1u;
  } else if (u < galaxy.c_bar) {
    comp = 2u;
  } else if (u < galaxy.c_ring) {
    comp = 3u;
  }

  if (comp == 0u && (flags & FLAG_SERSIC) != 0u) {
    // a smooth galaxy: an exact Sersic radius, in 2D (v21 parity: app23.js:L223-233)
    let nS = galaxy.sersic_n;
    let rS = galaxy.re * pow(gamma_s(2.0 * nS) / galaxy.sersic_b, nS);
    if (rS > rmax + 0.8) {
      put(i, none, CLS_NONE, 0u, 0.0, 0.0, 0.0);
      return;
    }
    let thS = next() * 6.28;
    let xS = rS * cos_f(thS);
    let yS = (rS * sin_f(thS)) * galaxy.bulge_flat;
    let dust = galaxy.dust;
    let re = galaxy.re;
    if (dust > 0.25 && abs(yS - 0.08 * xS) < 0.09 * dust && abs(xS) < 2.2 * re + 0.4) {
      if (next() < 0.85) {
        put(i, none, CLS_NONE, 0u, 0.0, 0.0, 0.0);
        return;
      }
    }
    if (dust > 0.3 && abs(yS + 0.04) < 0.05 + 0.03 * dust && abs(xS) < 1.8 * re + 0.6) {
      if (next() < 0.85 * dust) {
        put(i, none, CLS_NONE, 0u, 0.0, 0.0, 0.0);
        return;
      }
    }
    let p2 = vec3<f32>(xS, yS, 0.0);
    if (galaxy.star_mix > 0.01 && rS < 2.2 * re) {
      if (next() < 0.09 * galaxy.star_mix) {
        put(i, p2, CLS_RSTAR | FLAG_SERSIC2D, 0u, 0.0, 0.0, 0.0);
        return;
      }
    }
    let t = dot_tile();
    let size = dot_base[t] * 0.9;
    put(i, p2, CLS_OLD | FLAG_SERSIC2D, t, size, next() * 6.28, 0.0);
    return;
  }

  var p = vec3<f32>(0.0);
  var arm = 0.0;
  if (comp == 0u) {
    let a = galaxy.bulge_a;
    let sq = sqrt(min(next(), 0.985));
    let rr = (a * sq) / (1.0 - sq);
    let cz = 2.0 * next() - 1.0;
    let ph = TAU * next();
    let sz = sqrt(1.0 - cz * cz);
    p = vec3<f32>((rr * sz) * cos_f(ph), (rr * sz) * sin_f(ph), (rr * cz) * galaxy.bulge_flat);
  } else if (comp == 1u) {
    // -1.4 ln(1 - u) rather than -1.4 ln(u): the same distribution, finite at u = 0
    let rh = -1.4 * log(1.0 - next());
    let cz = 2.0 * next() - 1.0;
    let ph = TAU * next();
    let s2 = sqrt(1.0 - cz * cz);
    if (rh > rmax + 0.5) {
      put(i, none, CLS_NONE, 0u, 0.0, 0.0, 0.0);
      return;
    }
    p = vec3<f32>((rh * s2) * cos_f(ph), (rh * s2) * sin_f(ph), (rh * cz) * 0.7);
  } else if (comp == 2u) {
    let bl = galaxy.bar_len;
    var x = next() * 2.0 - 1.0;
    x = (sign(x) * pow(abs(x), 0.8)) * bl;
    let y = (gauss() * 0.1) * bl;
    let z = gauss() * 0.04;
    p = vec3<f32>(x, y, z);
  } else if (comp == 3u) {
    // a clumpy ring: the angle accepted against noise, up to 6 tries (app23.js:L243-245)
    var th = 0.0;
    var rt = 0;
    loop {
      th = TAU * next();
      rt = rt + 1;
      if (rt >= 6) {
        break;
      }
      let nz = vnoise_t(cos_f(th) * 2.2, sin_f(th) * 2.2, galaxy.seed, SALT_RING);
      if (!(next() > 0.45 + 0.55 * nz)) {
        break;
      }
    }
    let R = galaxy.ring_r * (1.0 + gauss() * 0.035);
    let z = (gauss() * galaxy.thick) * 0.5;
    p = vec3<f32>(R * cos_f(th), R * sin_f(th), z);
  } else {
    var R2 = 0.0;
    var th2 = 0.0;
    let patchy = galaxy.patchy;
    let arms_on = (flags & FLAG_ARMS_ON) != 0u;
    let as_ = galaxy.arm_strength;
    var tries = 0;
    loop {
      if (tries >= 30) {
        break;
      }
      let u1 = next();
      let u2 = next();
      R2 = -log(u1 * u2 + 1e-9);
      th2 = TAU * next();
      tries = tries + 1;
      if (R2 > rmax) {
        continue;
      }
      if (patchy > 0.0) {
        let nz = vnoise_t((R2 * cos_f(th2)) * 1.4, (R2 * sin_f(th2)) * 1.4, galaxy.seed, SALT_PATCHY);
        if (next() > (1.0 - patchy) + (patchy * pow(nz, 2.2)) * 2.2) {
          continue;
        }
      }
      if (!arms_on) {
        break;
      }
      arm = arm_profile(R2, th2);
      if (next() < (1.0 - as_) + as_ * arm) {
        break;
      }
    }
    if (R2 > rmax) {
      put(i, none, CLS_NONE, 0u, 0.0, 0.0, 0.0);
      return;
    }
    let irr = galaxy.irr;
    if (irr > 0.0) {
      let nz = vnoise_t((R2 * cos_f(th2)) * 1.3, (R2 * sin_f(th2)) * 1.3, galaxy.seed, SALT_IRR);
      if (next() > 0.5 + 1.1 * max(0.0, nz - 0.3)) {
        put(i, none, CLS_NONE, 0u, 0.0, 0.0, 0.0);
        return;
      }
    }
    var z = -galaxy.thick * log(1.0 - next());
    if (next() < 0.5) {
      z = -z;
    }
    let warp = galaxy.warp;
    if (warp > 0.0 && R2 > 1.8) {
      let dr = R2 - 1.8;
      z = z + ((warp * dr) * dr) * sin_f(th2 - galaxy.warp_a);
    }
    let lop = galaxy.lop;
    let lop_a = galaxy.lop_a;
    p = vec3<f32>(
      R2 * cos_f(th2) + ((lop * R2) * cos_f(lop_a)) * 0.35,
      R2 * sin_f(th2) + ((lop * R2) * sin_f(lop_a)) * 0.35,
      z,
    );
    for (var d = 0u; d < galaxy.n_dust; d++) {
      let D = shape[SHAPE_DUST + d];
      let dx = p.x - D.x * cos_f(D.y);
      let dy = p.y - D.x * sin_f(D.y);
      if (sqrt(dx * dx + dy * dy) < D.z) {
        if (next() < 0.8) {
          put(i, none, CLS_NONE, 0u, 0.0, 0.0, 0.0);
          return;
        }
      }
    }
  }

  // the view culls of the dust lanes (disc) and the carving lines (disc, bar, ring)
  var flags_out = 0u;
  if (comp == 4u) {
    flags_out = FLAG_LANE | FLAG_CARVE;
  } else if (comp >= 2u) {
    flags_out = FLAG_CARVE;
  }
  var u_tau = 0.0;
  if (galaxy.dust > 0.0 && comp != 1u) {
    // the extinction cull's random number, stored for the view tier (app23.js:L262)
    u_tau = next();
    flags_out = flags_out | FLAG_TAU;
  }
  let roll = next();
  let star_mix = galaxy.star_mix;
  if (star_mix > 0.01 && comp != 1u) {
    let Rg = sqrt(p.x * p.x + p.y * p.y);
    var kc = 0.85;
    if (comp == 0u) {
      kc = 0.4;
    } else if (comp == 3u) {
      kc = 1.6;
    } else if (arm > 0.55) {
      kc = 1.35;
    }
    var outer = 1.0;
    if (Rg > 2.1) {
      outer = 0.55;
    }
    if (Rg < 2.7) {
      if (next() < ((0.34 * star_mix) * kc) * outer) {
        put(i, p, CLS_RSTAR | flags_out, 0u, 0.0, 0.0, u_tau);
        return;
      }
    }
  }
  if (comp == 4u && arm > 0.55 && roll < (galaxy.knots * 0.12) * arm) {
    let tile = pool[min(KNOT_POOL - 1u, u32(floor(next() * f32(KNOT_POOL))))];
    let size = (5.0 + 6.0 * next()) * galaxy.pen_dot;
    put(i, p, CLS_KNOT | flags_out, tile, size, next() * 6.28, u_tau);
    return;
  }
  if ((comp == 4u || comp == 3u) && roll > 1.0 - (galaxy.sparkle * 0.012) * (0.4 + arm)) {
    let n = galaxy.n_star_tiles;
    let tile = min(n - 1u, u32(floor(next() * f32(n))));
    let size = 10.0 + 13.0 * next();
    put(i, p, CLS_STAR | flags_out, tile, size, next() * 6.28, u_tau);
    return;
  }
  let t = dot_tile();
  var k = 1.0;
  if (comp == 0u) {
    k = 0.85;
  }
  let size = dot_base[t] * k;
  var cls = CLS_DISC;
  if (comp == 0u || comp == 1u) {
    cls = CLS_OLD;
  } else if (arm > 0.55) {
    cls = CLS_YOUNG;
  }
  put(i, p, cls | flags_out, t, size, next() * 6.28, u_tau);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= galaxy.n) {
    return;
  }
  sample(id.x);
}

// Extra sample j: a mark of a ring knot or a clump (app23.js:L282-297), written at n + j. Its
// group is the last whose first sample is at or before j (binary search); its draws are on the
// group's stream, index id * GROUP_STRIDE + local. CPU twin: sampleExtra.
fn sample_extra(j: u32) {
  let i = galaxy.n + j;
  var lo = 0u;
  var hi = galaxy.n_groups;
  while (hi - lo > 1u) {
    let mid = (lo + hi) >> 1u;
    if (groups[mid].first <= j) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  let g = groups[lo];
  let local = j - g.first;
  let ring = (g.tag & 255u) == 0u;
  rng_stream = select(STREAM_CLUMPS, STREAM_RING_KNOTS, ring);
  rng_index = (g.tag >> 8u) * GROUP_STRIDE + local;
  rng_draw = 0u;
  if (local >= g.count) {
    // a drawn star: at the ring knot's centre, or scattered over the clump (classified only)
    if (ring) {
      put(i, g.c, CLS_RSTAR, 0u, 0.0, 0.0, 0.0);
    } else {
      let ss = g.s * 1.3;
      let x = g.c.x + gauss() * ss;
      let y = g.c.y + gauss() * ss;
      put(i, vec3<f32>(x, y, 0.0), CLS_RSTAR, 0u, 0.0, 0.0, 0.0);
    }
    return;
  }
  let x = g.c.x + gauss() * g.s;
  let y = g.c.y + gauss() * g.s;
  var z = g.c.z;
  if (!ring) {
    z = g.c.z + gauss() * 0.02;
  }
  let p = vec3<f32>(x, y, z);
  if (next() < select(0.25, 0.5, ring)) {
    let tile = pool[min(KNOT_POOL - 1u, u32(floor(next() * f32(KNOT_POOL))))];
    let size = (3.0 + 4.0 * next()) * galaxy.pen_dot;
    put(i, p, CLS_KNOT, tile, size, next() * 6.28, 0.0);
    return;
  }
  let t = dot_tile();
  let k = select(0.8, 0.9, ring) + 0.5 * next();
  put(i, p, CLS_YOUNG, t, dot_base[t] * k, next() * 6.28, 0.0);
}

@compute @workgroup_size(64)
fn extra(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= galaxy.n_extra) {
    return;
  }
  sample_extra(id.x);
}
