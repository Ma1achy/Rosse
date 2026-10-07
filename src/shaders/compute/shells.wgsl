// Shell galaxies (ADR 0003, 0009): a cold satellite released far out and falling almost straight into
// a big elliptical's logarithmic potential, its stars phase-wrapping into interleaved shells.
// Reference: shellSprites and shellArcs (app23.js:L711-760), one thread per star.
//
// Entry points, in dispatch order:
//   init_shell   a star's start from the counter RNG (stream 12, index = star): x = 3 + 0.5 g, y and z
//                0.02 g, a velocity -0.1 + 0.05 g along x and 0.012 g across (L716-719);
//   integrate    semi-implicit Euler in the potential (force -r / (r^2 + 0.3), a flat rotation curve),
//                dt = 0.02, steps st0 .. st1 (L722), in chunks per submit;
//   polar        each star's distance, its polar angle from the x axis, and the radial histogram of
//                its side (64 bins to 4.2, stars between 0.6 and 4.2), by integer atomics (L725-727);
//   detect       ONE invocation: per side the smoothed histogram, its peaks with a sharp outer drop
//                (> 45%) holding more than 0.4% of the stars, the three biggest, and for each the
//                85th percentile of the polar angles of the stars within 0.12 of its radius
//                (L728-739), by bisection on the angles' bits: the arcs, a few numbers;
//   dots         each star as a dots instance, from x and y only, turned by the infall axis (L741-747).
// Drops are compared as 100 drop > 45 sm and 250 sm > N, exact in f32 for the histogram's counts.
//
// CPU twin: src/fallback/kernels/shells.ts, function for function (ADR 0014).

// #import "common/instance.wgsl"
// #import "common/rng.wgsl"
// #import "common/math.wgsl"

// SSIM_LAYOUT in src/fallback/kernels/shells.ts
struct SSim {
  seed: u32,
  n: u32,
  st0: u32,
  st1: u32,
  dt: f32,
  rc2: f32,
  // cos and sin of the infall axis
  ca: f32,
  sn: f32,
  // the plate centre and the scale, plate px per unit
  cx: f32,
  cy: f32,
  scale: f32,
  // the dots' hand
  n_dot_pool: u32,
  // N * 0.004, in the reference's f64, as an exact f32 for the test sm > N * 0.004
  pad0: u32,
  pad1: u32,
  pad2: u32,
  pad3: u32,
}

const STREAM_SHELLS: u32 = 12u;
const KNOT_POOL: u32 = 24u;
const BINS: u32 = 64u;
const RMAX: f32 = 4.2;

@group(0) @binding(0) var<uniform> sim: SSim;
@group(0) @binding(1) var<storage, read_write> xs: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> vs: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> polar: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> hist: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> arcs: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> pool: array<u32>;
@group(0) @binding(7) var<storage, read> dot_base: array<f32>;
@group(0) @binding(8) var<storage, read_write> dots_out: array<Instance>;

@compute @workgroup_size(64)
fn init_shell(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.n) {
    return;
  }
  let g = vec3<f32>(
    rand_gauss_f(sim.seed, STREAM_SHELLS, i, 0u),
    rand_gauss_f(sim.seed, STREAM_SHELLS, i, 2u),
    rand_gauss_f(sim.seed, STREAM_SHELLS, i, 4u),
  );
  let h = vec3<f32>(
    rand_gauss_f(sim.seed, STREAM_SHELLS, i, 6u),
    rand_gauss_f(sim.seed, STREAM_SHELLS, i, 8u),
    rand_gauss_f(sim.seed, STREAM_SHELLS, i, 10u),
  );
  xs[i] = vec4<f32>(3.0 + g.x * 0.5, g.y * 0.02, g.z * 0.02, 0.0);
  vs[i] = vec4<f32>(-0.1 + h.x * 0.05, h.y * 0.012, h.z * 0.012, 0.0);
}

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.n) {
    return;
  }
  var x = xs[i].xyz;
  var v = vs[i].xyz;
  for (var st = sim.st0; st < sim.st1; st++) {
    let f = -1.0 / (x.x * x.x + x.y * x.y + x.z * x.z + sim.rc2);
    v = v + (f * x) * sim.dt;
    x = x + v * sim.dt;
  }
  xs[i] = vec4<f32>(x, 0.0);
  vs[i] = vec4<f32>(v, 0.0);
}

@compute @workgroup_size(64)
fn polar_hist(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.n) {
    return;
  }
  let p = xs[i].xyz;
  let rr = sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
  let across = sqrt(p.y * p.y + p.z * p.z);
  polar[i] = vec2<f32>(rr, atan2(across, abs(p.x)));
  if (rr < 0.6 || rr > RMAX || p.x == 0.0) {
    return;
  }
  let bin = u32(floor(rr / RMAX * f32(BINS)));
  if (bin >= BINS) {
    return;
  }
  var side = 0u;
  if (p.x < 0.0) {
    side = 1u;
  }
  atomicAdd(&hist[side * BINS + bin], 1u);
}

fn count_of(side: u32, b: u32) -> f32 {
  return f32(atomicLoad(&hist[side * BINS + b]));
}

@compute @workgroup_size(1)
fn detect() {
  for (var side = 0u; side < 2u; side++) {
    var sm = array<f32, 64>();
    for (var b = 1u; b < BINS - 1u; b++) {
      sm[b] = (count_of(side, b - 1u) + 2.0 * count_of(side, b) + count_of(side, b + 1u)) / 4.0;
    }
    // the three biggest drops, in order (a drop, then the earlier bin)
    var top_drop = array<f32, 3>(-1.0, -1.0, -1.0);
    var top_bin = array<u32, 3>(0u, 0u, 0u);
    for (var b = 3u; b < BINS - 2u; b++) {
      let drop = sm[b] - sm[b + 2u];
      if (sm[b] >= sm[b - 1u] && sm[b] >= sm[b + 1u] && drop * 100.0 > 45.0 * sm[b] && sm[b] * 250.0 > f32(sim.n)) {
        var d = drop;
        var k = b;
        for (var j = 0u; j < 3u; j++) {
          if (d > top_drop[j]) {
            let td = top_drop[j];
            let tk = top_bin[j];
            top_drop[j] = d;
            top_bin[j] = k;
            d = td;
            k = tk;
          }
        }
      }
    }
    var sgn = 1.0;
    if (side == 1u) {
      sgn = -1.0;
    }
    for (var j = 0u; j < 3u; j++) {
      var arc = vec4<f32>(0.0);
      if (top_drop[j] >= 0.0) {
        let R = (f32(top_bin[j]) + 0.8) / f32(BINS) * RMAX;
        // the stars at this radius on this side, and the 85th percentile of their polar angles
        var cnt = 0u;
        for (var i = 0u; i < sim.n; i++) {
          let p = xs[i].xyz;
          if (abs(polar[i].x - R) < 0.12 && p.x * sgn > 0.0) {
            cnt++;
          }
        }
        var open = 0.6;
        if (cnt > 0u) {
          let k = u32(floor(f32(cnt) * 0.85));
          var lo = 0u;
          var hi = 0x7f800000u;
          for (var it = 0u; it < 31u; it++) {
            let mid = lo + (hi - lo) / 2u;
            var c = 0u;
            for (var i = 0u; i < sim.n; i++) {
              let p = xs[i].xyz;
              if (abs(polar[i].x - R) < 0.12 && p.x * sgn > 0.0 && bitcast<u32>(polar[i].y) <= mid) {
                c++;
              }
            }
            if (c > k) {
              hi = mid;
            } else {
              lo = mid + 1u;
            }
          }
          open = bitcast<f32>(lo);
        }
        arc = vec4<f32>(R, sgn, min(1.3, max(0.35, open)), 1.0);
      }
      arcs[side * 3u + j] = arc;
    }
  }
}

@compute @workgroup_size(64)
fn dots(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.n) {
    return;
  }
  let p = xs[i].xyz;
  let t = pool[KNOT_POOL + u32(floor(rand_f32(sim.seed, STREAM_SHELLS, i, 20u) * f32(sim.n_dot_pool)))];
  let size = dot_base[t] * 0.85;
  let rot = rand_f32(sim.seed, STREAM_SHELLS, i, 21u) * 6.28;
  let c = cos_f(rot);
  let s = sin_f(rot);
  let pos = vec2<f32>(
    sim.cx + (p.x * sim.ca - p.y * sim.sn) * sim.scale,
    sim.cy + (p.x * sim.sn + p.y * sim.ca) * sim.scale,
  );
  dots_out[i] = Instance(pos, t, 1.0, vec4<f32>(c * size, s * size, -(s * size), c * size));
}
