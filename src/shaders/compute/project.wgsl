// Projection and view culls (the view tier, ADR 0010): one invocation per sample. The dust
// optical-depth cull is a pure filter on the sample's stored uniform u_tau (ADR 0004). Positions
// go through the reference's project (app23.js:L153): mirror by the winding, orbit by az about
// the galaxy's axis, tilt by incl, roll by pa, scale and centre; Sersic samples are turned by pa
// only (v21 parity, app23.js:L228). Writes the instance [x, y, tile, 1, simple(size, rot)]
// (app23.js:L171-173) and its class, CLS_NONE when culled, for compute/scan.wgsl.
//
// CPU twin: src/fallback/kernels/project.ts.

// #import "common/instance.wgsl"
// #import "common/math.wgsl"
// #import "common/stipple-types.wgsl"

// The camera: VIEW_LAYOUT in src/view/camera.ts (trigonometry evaluated on the CPU, in f32).
struct View {
  cos_i: f32,
  sin_i: f32,
  cos_az: f32,
  sin_az: f32,
  cos_pa: f32,
  sin_pa: f32,
  winding: f32,
  scale: f32,
  cx: f32,
  cy: f32,
  dust: f32,
  pad0: f32,
  n: u32,
  cap: u32,
  pad1: u32,
  pad2: u32,
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> samples: array<Sample>;
@group(0) @binding(2) var<storage, read_write> projected: array<Instance>;
@group(0) @binding(3) var<storage, read_write> classes: array<u32>;

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
    if (s.u_tau > exp(-tau)) {
      return;
    }
  }
  var X: f32;
  var Y: f32;
  if ((s.cls & FLAG_SERSIC2D) != 0u) {
    X = s.pos.x;
    Y = s.pos.y;
  } else {
    let x0 = s.pos.x * view.winding;
    X = x0 * view.cos_az - s.pos.y * view.sin_az;
    let ya = x0 * view.sin_az + s.pos.y * view.cos_az;
    Y = ya * view.cos_i - s.pos.z * view.sin_i;
  }
  let pos = vec2<f32>(
    view.cx + (X * view.cos_pa - Y * view.sin_pa) * view.scale,
    view.cy + (X * view.sin_pa + Y * view.cos_pa) * view.scale,
  );
  let c = cos_f(s.rot);
  let sn = sin_f(s.rot);
  projected[i] = Instance(pos, s.tile, 1.0, vec4<f32>(c * s.size, sn * s.size, -(sn * s.size), c * s.size));
  classes[i] = cls;
}
