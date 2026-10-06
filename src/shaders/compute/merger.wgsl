// Merger test stars (ADR 0009): initial conditions, kick-drift-kick leapfrog and snapshots, one
// thread per star. Reference: simulateMerger (app23.js:L304-380). The two cores' track is computed
// on the CPU in f64 (src/sim/merger.ts) and read here as f32 positions per kick.
//
// Entry points, in dispatch order:
//   init_stars    the star's initial conditions from the counter RNG (stream 10, index = star):
//                 a disc on its galaxy's plane (exponential in radius, half of a spiral's stars on
//                 a log spiral, 35% of a barred galaxy's inner stars on a bar, a thin gaussian
//                 thickness) with the circular speed of the Plummer core, or for an elliptical a
//                 hot ball with 0.55 of the circular speed in random directions (L320-338). Also
//                 keeps the star's initial disc coordinates (DX, DY, R0) for the tidal map;
//   start_phase   the phase's opening: for the way in, the first snapshot; then kick(dt/2) (L358-359,
//                 L369-370);
//   integrate     steps st0 .. st1 of the phase, each a drift then a kick (a half kick for the last
//                 step of the phase), keeping a snapshot before the drift of every `every`th step
//                 (L361-366). Run in chunks of about 200 steps per submit, so a long horizon never
//                 stalls a frame;
//   finish_phase  the phase's closing snapshot, in f32 (the chosen moment, or the horizon's end);
//   blend         the state at a fractional snapshot index (snapAt, L390-397): each star's position
//                 blended between two snapshots, from the f16 tables (relative to the nearer core,
//                 added back to the core's position at that snapshot) or the f32 closing ones;
//   radii         the distances of every fifth star to a centre, for frameOf (L469-471).
//
// Snapshots are f16 positions relative to the nearer core: two words per star, (x, y) then
// (z, which core). Sine and cosine are cos_f and sin_f (the same on every adapter); the rest is
// built-in sqrt and log, so stars match the CPU twin to a few ULP and then drift apart in close
// passages (ADR 0004, L1).
//
// CPU twin: src/fallback/kernels/merger.ts, function for function (ADR 0014).

// #import "common/rng.wgsl"
// #import "common/math.wgsl"

// MSIM_LAYOUT in src/fallback/kernels/merger.ts
struct MSim {
  seed: u32,
  n: u32,
  // the first star of the small galaxy
  n0: u32,
  dt: f32,
  // core masses, softening squared
  m0: f32,
  m1: f32,
  a0sq: f32,
  a1sq: f32,
}

// MGAL_LAYOUT: n = spin axis, w = type (0 spiral, 1 lenticular, 2 elliptical); e1.w = rd;
// e2.w = rmax; c = the core's start position, w = mass; v = its start velocity, w = softening;
// p = (arms, log-spiral pitch, bar 0 or 1, 0)
struct MGal {
  n: vec4<f32>,
  e1: vec4<f32>,
  e2: vec4<f32>,
  c: vec4<f32>,
  v: vec4<f32>,
  p: vec4<f32>,
}

// MJOB_LAYOUT: one dispatch
struct MJob {
  st0: u32,
  st1: u32,
  // the steps in the whole phase
  steps: u32,
  // a snapshot every this many steps
  every: u32,
  // 1 for the future (no snapshot at its start: row = st / every - 1)
  flags: u32,
  // the first core entry of this phase's kick positions
  core_off: u32,
  pad0: u32,
  pad1: u32,
}

// MSEL_LAYOUT: the state to blend
struct MSel {
  kind0: u32,
  idx0: u32,
  kind1: u32,
  idx1: u32,
  a: f32,
  // the first core entry of the timeline's and the future's snapshots
  snapc1: u32,
  snapc2: u32,
  n_stars: u32,
}

const STREAM_MERGER_INIT: u32 = 10u;
const KIND_SNAP1: u32 = 0u;
const KIND_CHOSEN: u32 = 1u;
const KIND_SNAP2: u32 = 2u;
const KIND_HORIZON: u32 = 3u;
const TRIES: u32 = 40u;

@group(0) @binding(0) var<uniform> sim: MSim;
@group(0) @binding(1) var<uniform> gal: array<MGal, 2>;
@group(0) @binding(2) var<uniform> job: MJob;
@group(0) @binding(3) var<storage, read_write> xs: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> vs: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> ic: array<vec4<f32>>;
// the cores' positions at every kick of both phases, then at every snapshot of both tables
@group(0) @binding(6) var<storage, read> cores: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> snap: array<vec2<u32>>;
@group(0) @binding(8) var<storage, read_write> closing: array<vec4<f32>>;
@group(0) @binding(9) var<storage, read> snap1: array<vec2<u32>>;
@group(0) @binding(10) var<storage, read> snap2: array<vec2<u32>>;
@group(0) @binding(11) var<storage, read> chosen: array<vec4<f32>>;
@group(0) @binding(12) var<storage, read> horizon: array<vec4<f32>>;
@group(0) @binding(13) var<uniform> sel: MSel;
@group(0) @binding(14) var<storage, read_write> cur: array<vec4<f32>>;
@group(0) @binding(15) var<storage, read_write> radii_out: array<f32>;
@group(0) @binding(16) var<uniform> centre: vec4<f32>;

fn u01(i: u32, d: u32) -> f32 {
  return rand_f32(sim.seed, STREAM_MERGER_INIT, i, d);
}

fn gauss(i: u32, d: u32) -> f32 {
  return rand_gauss_f(sim.seed, STREAM_MERGER_INIT, i, d);
}

// The Plummer circular speed at radius R about a core of mass M and softening A.
fn circular(m: f32, r: f32, a: f32) -> f32 {
  let q = r * r + a * a;
  return sqrt(m * r * r / (q * sqrt(q)));
}

@compute @workgroup_size(64)
fn init_stars(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.n) {
    return;
  }
  var g = 0u;
  if (i >= sim.n0) {
    g = 1u;
  }
  let G = gal[g];
  let ty = u32(G.n.w);
  let rd = G.e1.w;
  let rmax = G.e2.w;
  let mass = G.c.w;
  let soft = G.v.w;
  if (ty == 2u) {
    // a hot ball of stars: random orbits, no disc (L320-325)
    let u0 = sqrt(min(u01(i, 200u), 0.97));
    let Re = min(rmax * 0.8, 0.45 * rd * u0 / (1.0 - u0) + 0.02);
    let z = 2.0 * u01(i, 201u) - 1.0;
    let t = u01(i, 202u) * 6.28318;
    let q = sqrt(1.0 - z * z);
    let dv = vec3<f32>(q * cos_f(t), q * sin_f(t), z);
    let vcE = circular(mass, Re, soft);
    let vv = vec3<f32>(gauss(i, 203u), gauss(i, 205u), gauss(i, 207u));
    xs[i] = vec4<f32>(G.c.xyz + Re * dv, 0.0);
    vs[i] = vec4<f32>(G.v.xyz + vv * vcE * 0.55, 0.0);
    ic[i] = vec4<f32>(Re * dv.x / rmax, Re * dv.y / rmax, Re / rmax, 0.0);
    return;
  }
  var R = 0.0;
  for (var t = 0u; t < TRIES; t++) {
    R = -rd * log(u01(i, 2u * t) * u01(i, 2u * t + 1u) + 1e-9);
    if (R <= rmax && R >= 0.04) {
      break;
    }
  }
  R = clamp(R, 0.04, rmax);
  var th = u01(i, 100u) * 6.28;
  // spiral structure to start with (lenticulars have none)
  if (ty == 0u && u01(i, 101u) < 0.5) {
    let k = floor(u01(i, 102u) * G.p.x);
    th = log(R / 0.1) / G.p.y + 6.283185307179586 * k / G.p.x + gauss(i, 104u) * 0.25;
  }
  // a bar
  if (G.p.z > 0.5 && R < rd * 1.6 && u01(i, 106u) < 0.35) {
    let bx = (u01(i, 107u) * 2.0 - 1.0) * rd * 1.5;
    R = max(0.04, abs(bx));
    var base = 0.0;
    if (bx < 0.0) {
      base = 3.141592653589793;
    }
    th = base + gauss(i, 108u) * 0.12;
  }
  let vc = circular(mass, R, soft);
  let c = cos_f(th);
  let sn = sin_f(th);
  var thick = 0.02;
  if (ty == 1u) {
    thick = 0.04;
  }
  let zz = gauss(i, 110u) * thick;
  xs[i] = vec4<f32>(G.c.xyz + R * (c * G.e1.xyz + sn * G.e2.xyz) + zz * G.n.xyz, 0.0);
  vs[i] = vec4<f32>(G.v.xyz + vc * (-sn * G.e1.xyz + c * G.e2.xyz), 0.0);
  ic[i] = vec4<f32>(R * c / rmax, R * sn / rmax, R / rmax, 0.0);
}

// The test star's acceleration in the field of both cores (kick, L352-358).
fn accel(x: vec3<f32>, p0: vec3<f32>, p1: vec3<f32>) -> vec3<f32> {
  let d0 = p0 - x;
  let q0 = d0.x * d0.x + d0.y * d0.y + d0.z * d0.z + sim.a0sq;
  let i0 = sim.m0 / (q0 * sqrt(q0));
  let d1 = p1 - x;
  let q1 = d1.x * d1.x + d1.y * d1.y + d1.z * d1.z + sim.a1sq;
  let i1 = sim.m1 / (q1 * sqrt(q1));
  return d0 * i0 + d1 * i1;
}

fn core_at(k: u32, g: u32) -> vec3<f32> {
  return cores[job.core_off + k * 2u + g].xyz;
}

// A snapshot row: x relative to the nearer core, in f16, and which core.
fn write_snap(row: u32, i: u32, x: vec3<f32>, k: u32) {
  let a = core_at(k, 0u);
  let b = core_at(k, 1u);
  let da = x - a;
  let db = x - b;
  var which = 0.0;
  var rel = da;
  if (db.x * db.x + db.y * db.y + db.z * db.z < da.x * da.x + da.y * da.y + da.z * da.z) {
    which = 1.0;
    rel = db;
  }
  snap[row * sim.n + i] = vec2<u32>(pack2x16float(rel.xy), pack2x16float(vec2<f32>(rel.z, which)));
}

@compute @workgroup_size(64)
fn start_phase(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.n) {
    return;
  }
  let x = xs[i].xyz;
  if ((job.flags & 1u) == 0u) {
    write_snap(0u, i, x, 0u);
  }
  vs[i] = vec4<f32>(vs[i].xyz + accel(x, core_at(0u, 0u), core_at(0u, 1u)) * (sim.dt * 0.5), 0.0);
}

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.n) {
    return;
  }
  var x = xs[i].xyz;
  var v = vs[i].xyz;
  let dt = sim.dt;
  for (var st = job.st0; st < job.st1; st++) {
    if (st > 0u && st % job.every == 0u) {
      var row = st / job.every;
      if ((job.flags & 1u) != 0u) {
        row = row - 1u;
      }
      write_snap(row, i, x, st);
    }
    x = x + v * dt;
    var h = dt;
    if (st + 1u == job.steps) {
      h = dt * 0.5;
    }
    v = v + accel(x, core_at(st + 1u, 0u), core_at(st + 1u, 1u)) * h;
  }
  xs[i] = vec4<f32>(x, 0.0);
  vs[i] = vec4<f32>(v, 0.0);
}

@compute @workgroup_size(64)
fn finish_phase(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.n) {
    return;
  }
  closing[i] = vec4<f32>(xs[i].xyz, 0.0);
}

// A star at one snapshot of a source: an f16 row plus its core, or an f32 closing position.
fn load_state(kind: u32, idx: u32, i: u32) -> vec3<f32> {
  if (kind == KIND_CHOSEN) {
    return chosen[i].xyz;
  }
  if (kind == KIND_HORIZON) {
    return horizon[i].xyz;
  }
  var row: vec2<u32>;
  var core0 = sel.snapc1;
  if (kind == KIND_SNAP2) {
    row = snap2[idx * sel.n_stars + i];
    core0 = sel.snapc2;
  } else {
    row = snap1[idx * sel.n_stars + i];
  }
  let a = unpack2x16float(row.x);
  let b = unpack2x16float(row.y);
  let which = u32(b.y + 0.5);
  return vec3<f32>(a.x, a.y, b.x) + cores[core0 + idx * 2u + which].xyz;
}

@compute @workgroup_size(64)
fn blend(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= sim.n) {
    return;
  }
  let p0 = load_state(sel.kind0, sel.idx0, i);
  if (sel.a == 0.0) {
    cur[i] = vec4<f32>(p0, 0.0);
    return;
  }
  let p1 = load_state(sel.kind1, sel.idx1, i);
  let b1 = 1.0 - sel.a;
  cur[i] = vec4<f32>(p0 * b1 + p1 * sel.a, 0.0);
}

@compute @workgroup_size(64)
fn radii(@builtin(global_invocation_id) id: vec3<u32>) {
  let k = id.x;
  let i = k * 5u;
  if (i >= sim.n) {
    return;
  }
  let d = cur[i].xyz - centre.xyz;
  radii_out[k] = sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
}
