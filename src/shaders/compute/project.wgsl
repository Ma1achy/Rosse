// Projection and view culls (the view tier, ADR 0010): one invocation per sample. The dust
// optical-depth cull is a pure filter on the sample's stored uniform u_tau (ADR 0004). Positions
// go through the reference's project (app23.js:L153): mirror by the winding, orbit by az about
// the galaxy's axis, tilt by incl, roll by pa, scale and centre; Sersic samples are turned by pa
// only (v21 parity, app23.js:L228). Writes the instance [x, y, tile, 1, simple(size, rot)]
// (app23.js:L171-173) and its class, CLS_NONE when culled, for compute/scan.wgsl.
//
// The dust culls of M4 (app23.js:L264-265) are pure filters too, on uniforms of the stippleCull
// stream (draw 0: carving lines, draw 1: lanes), tested on the projected position before the hand
// wobble, with distances compared squared: a disc, bar or ring sample near a carving line
// (nearDust), a disc sample near a lane point (inLane). Then the wobble (common/warp.wgsl).
//
// CPU twin: src/fallback/kernels/project.ts.

// #import "common/camera.wgsl"
// #import "common/instance.wgsl"
// #import "common/math.wgsl"
// #import "common/stipple-types.wgsl"
// #import "common/warp.wgsl"

// CULLS_LAYOUT in src/fallback/kernels/project.ts
struct Culls {
  // the placement key
  key: u32,
  // lane points: points[lane_first .. lane_first + n_lane]
  n_lane: u32,
  lane_first: u32,
  // carving segments: carve[0 .. n_carve], each the index of its first point
  n_carve: u32,
  // squared lane radius, plate units
  lane_r2: f32,
  lane_p: f32,
  // squared carving width, plate units
  carve_w2: f32,
  carve_p: f32,
  // the wobble's amplitude, d0 (0: off)
  wobble: f32,
  // PEN.dot, for the drawn stars' size limits
  pen_dot: f32,
  // the least share of a sample the dust lets through (ADR 0080): 0 is v21's, a lane that can empty
  tau_floor: f32,
  pad2: f32,
}

const STREAM_STIPPLE_CULL: u32 = 3u;

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> samples: array<Sample>;
@group(0) @binding(2) var<storage, read_write> projected: array<Instance>;
@group(0) @binding(3) var<storage, read_write> classes: array<u32>;
@group(0) @binding(4) var<uniform> culls: Culls;
// the scene's projected points (compute/ribbons.wgsl project_points), plate units
@group(0) @binding(5) var<storage, read> points: array<vec2<f32>>;
@group(0) @binding(6) var<storage, read> carve: array<u32>;

// nearDust (app23.js:L214-220)
fn near_carve(q: vec2<f32>) -> bool {
  for (var s = 0u; s < culls.n_carve; s++) {
    let a = carve[s];
    let p0 = points[a];
    let p1 = points[a + 1u];
    let vx = p1.x - p0.x;
    let vy = p1.y - p0.y;
    var l2 = vx * vx + vy * vy;
    if (l2 == 0.0) {
      l2 = 1.0;
    }
    let t = clamp(((q.x - p0.x) * vx + (q.y - p0.y) * vy) / l2, 0.0, 1.0);
    let ex = (p0.x + t * vx) - q.x;
    let ey = (p0.y + t * vy) - q.y;
    if (ex * ex + ey * ey < culls.carve_w2) {
      return true;
    }
  }
  return false;
}

// inLane (app23.js:L196-198)
fn in_lane(q: vec2<f32>) -> bool {
  for (var k = 0u; k < culls.n_lane; k++) {
    let p = points[culls.lane_first + k];
    let dx = q.x - p.x;
    let dy = q.y - p.y;
    if (dx * dx + dy * dy < culls.lane_r2) {
      return true;
    }
  }
  return false;
}

// dustTau(p, c) (app23.js:L145-152)
fn dust_tau(p: vec3<f32>, cos_i: f32, dust: f32) -> f32 {
  if (dust <= 0.0) {
    return 0.0;
  }
  let zd = 0.06;
  let R = sqrt(p.x * p.x + p.y * p.y);
  if (R > 3.2) {
    return 0.0;
  }
  var t1 = 0.0;
  var t2 = 6.0;
  if (abs(cos_i) < 1e-3) {
    if (abs(p.z) > zd) {
      return 0.0;
    }
  } else {
    t1 = (-zd - p.z) / cos_i;
    t2 = (zd - p.z) / cos_i;
    if (t1 > t2) {
      let q = t1;
      t1 = t2;
      t2 = q;
    }
  }
  t1 = max(t1, 0.0);
  t2 = min(t2, 6.0);
  return ((dust * 9.0) * max(0.0, t2 - t1)) * exp(-R / 1.6);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= view.n) {
    return;
  }
  let s = samples[i];
  let cls = s.cls & 255u;
  projected[i] = Instance(vec2<f32>(0.0), 0u, 0.0, vec4<f32>(0.0));
  classes[i] = CLS_NONE;
  if (cls == CLS_NONE) {
    return;
  }
  if ((s.cls & FLAG_TAU) != 0u) {
    let tau = dust_tau(s.pos, view.cos_i, view.dust);
    if (s.u_tau > max(exp(-tau), culls.tau_floor)) {
      return;
    }
  }
  var q = s.pos.xy;
  if ((s.cls & FLAG_SERSIC2D) == 0u) {
    q = rot_fwd(view, s.pos).xy;
  }
  let pre = to_plate(view, q);
  if ((s.cls & FLAG_CARVE) != 0u && culls.n_carve > 0u) {
    if (rand_f32(culls.key, STREAM_STIPPLE_CULL, i, 0u) < culls.carve_p && near_carve(pre)) {
      return;
    }
  }
  if ((s.cls & FLAG_LANE) != 0u && culls.n_lane > 0u) {
    if (rand_f32(culls.key, STREAM_STIPPLE_CULL, i, 1u) < culls.lane_p && in_lane(pre)) {
      return;
    }
  }
  if (cls == CLS_RSTAR) {
    // a drawn star (M7): the hand wobble acts on each point of the drawing (vector-expand), not on
    // its centre (a vector mark, app23.js:L171); the size grows with the zoom, ZL (app23.js:L183)
    let pd = culls.pen_dot;
    let zl = pow(view.scale / 84.0, 0.45);
    let sz = max(3.2 * pd, min((20.0 * pd) * zl, s.size * zl));
    var ps = min(max(0.3 + 0.03 * sz, 0.36), 0.5);
    if ((s.cls & FLAG_BRIGHT) != 0u) {
      ps = 0.58;
    }
    let cs = cos_f(s.rot);
    let sn = sin_f(s.rot);
    projected[i] = Instance(pre, s.tile, ps, vec4<f32>(cs * sz, sn * sz, -(sn * sz), cs * sz));
    classes[i] = cls;
    return;
  }
  let pos = sm_warp(pre, culls.wobble);
  let c = cos_f(s.rot);
  let sn = sin_f(s.rot);
  projected[i] = Instance(pos, s.tile, 1.0, vec4<f32>(c * s.size, sn * s.size, -(sn * s.size), c * s.size));
  classes[i] = cls;
}
