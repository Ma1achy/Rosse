// The deep field's lens (`lensField`, ADR 0097): the halos as the lens passes pack them, the damped
// Newton solve of the lens equation, and the primary image of a plate point. Shared by
// compute/sky.wgsl (the dots, and the drawings' rows) and compute/vector-expand.wgsl (a lensed
// drawing's every vertex, `WARP_LENS`, ADR 0101). The uniform is declared here, at binding 32 of
// every shader that imports this file.
// CPU twin: src/fallback/kernels/sky.ts `lensImage`.

const PLATE_HALF: f32 = 400.0;

// the deep field's lens: the halos as the lens passes pack them (three vec4 each: x y cos sin |
// q s e kk | b q_raw 0 0), at most 12
struct LensZ {
  on: u32,
  n: u32,
  pad0: u32,
  pad1: u32,
  // the source plane's strength, the shear's g, cos 2 phi, sin 2 phi
  f: f32,
  g: f32,
  c2: f32,
  s2: f32,
  // cos and sin of the position angle, pixels per lens unit
  cs: vec4<f32>,
  halos: array<vec4<f32>, 36>,
}

@group(0) @binding(32) var<uniform> lensz: LensZ;

const LENS_STEPS: u32 = 5u;
const LENS_DET_MIN: f32 = 0.15;
const LENS_STEP_MAX: f32 = 0.4;
const LENS_H: f32 = 0.01;
const LENS_CONV: f32 = 0.005;
const LENS_SEP: f32 = 0.05;

// `kz` scales the lens for the object's depth (`lens_depth_k`, ADR 0102)
fn sky_deflect(x: f32, y: f32, kz: f32) -> vec2<f32> {
  var ax = 0.0;
  var ay = 0.0;
  for (var k = 0u; k < lensz.n; k++) {
    let h0 = lensz.halos[3u * k];
    let h1 = lensz.halos[3u * k + 1u];
    let ca = h0.z;
    let sa = h0.w;
    let dx = x - h0.x;
    let dy = y - h0.y;
    let u = dx * ca + dy * sa;
    let v = -dx * sa + dy * ca;
    let q = h1.x;
    let s = h1.y;
    let e = h1.z;
    let kk = h1.w;
    let q2 = q * q;
    let ps = sqrt(q2 * (s * s + u * u) + v * v);
    let au = kk * atan(e * u / (ps + s));
    let t = clamp(e * v / (ps + q2 * s), -0.999999, 0.999999);
    let av = kk * (0.5 * log((1.0 + t) / (1.0 - t)));
    ax = ax + (au * ca - av * sa);
    ay = ay + (au * sa + av * ca);
  }
  ax = ax + lensz.g * (lensz.c2 * x + lensz.s2 * y);
  ay = ay + lensz.g * (lensz.s2 * x - lensz.c2 * y);
  return vec2<f32>(ax * lensz.f * kz, ay * lensz.f * kz);
}

// 1 - d alpha at (x, y), as (A11, A12, A21, A22), by finite differences
fn lens_jac(x: f32, y: f32, a: vec2<f32>, kz: f32) -> vec4<f32> {
  let ax = sky_deflect(x + LENS_H, y, kz);
  let ay = sky_deflect(x, y + LENS_H, kz);
  return vec4<f32>(
    1.0 - (ax.x - a.x) / LENS_H,
    -((ay.x - a.x) / LENS_H),
    -((ax.y - a.y) / LENS_H),
    1.0 - (ay.y - a.y) / LENS_H,
  );
}

fn lens_det(A: vec4<f32>) -> f32 {
  let d = A.x * A.w - A.y * A.z;
  if (abs(d) < LENS_DET_MIN) {
    if (d < 0.0) {
      return -LENS_DET_MIN;
    }
    return LENS_DET_MIN;
  }
  return d;
}

// How much of the lens an object at view depth z (the lens plane is z = 0; the camera is at
// CAM_DISTANCE; smaller z is farther behind) feels: the ratio of the lens-source to the camera-source
// distance, D_ls / D_s = -z / (CAM_DISTANCE - z), over its value for the far field (z = -SKY_RMAX), so
// the far field keeps the strength it had, a nearer source feels less, and one in front of the lens
// plane none (ADR 0102). Twin of `lensDepthK` in src/fallback/kernels/lens-sky.ts.
const LENS_FAR_Z: f32 = 240.0;
fn lens_depth_k(z: f32) -> f32 {
  if (z >= 0.0) {
    return 0.0;
  }
  let s = -z / (30.0 - z);
  let s_far = LENS_FAR_Z / (30.0 + LENS_FAR_Z);
  return min(s / s_far, 1.0);
}

// the primary image of a plate point: xy its place, and the plate-space map (column-major) that
// takes a shape at the source to its image
struct LensImg {
  pos: vec2<f32>,
  m: vec4<f32>,
}

// the source of a plate point in lens units
fn lens_beta(p: vec2<f32>) -> vec2<f32> {
  let cw = lensz.cs.x;
  let sw = lensz.cs.y;
  let sc = lensz.cs.z;
  let dx = (p.x - PLATE_HALF) / sc;
  let dy = (p.y - PLATE_HALF) / sc;
  return vec2<f32>(dx * cw + dy * sw, -dx * sw + dy * cw);
}

// damped Newton steps on theta - alpha(theta) = beta from t0 (twin of `newton`)
fn lens_newton(b: vec2<f32>, t0: vec2<f32>, kz: f32) -> vec2<f32> {
  var t = t0;
  for (var i = 0u; i < LENS_STEPS; i++) {
    let a = sky_deflect(t.x, t.y, kz);
    let A = lens_jac(t.x, t.y, a, kz);
    let r = t - a - b;
    let det = lens_det(A);
    var st = vec2<f32>(A.w * r.x - A.y * r.y, -(A.z * r.x) + A.x * r.y) / det;
    let sl = length(st);
    if (sl > LENS_STEP_MAX) {
      st = st * (LENS_STEP_MAX / sl);
    }
    t = t - st;
  }
  return t;
}

// the primary image of a plate point in lens units: theta, and beta
fn lens_solve(p: vec2<f32>, kz: f32) -> vec4<f32> {
  let b = lens_beta(p);
  let a0 = sky_deflect(b.x, b.y, kz);
  return vec4<f32>(lens_newton(b, b + a0, kz), b);
}

// the counter-image of a plate point (ADR 0103): xy its theta, z 1 when there is one (the lens
// equation holds to LENS_CONV and it is LENS_SEP away from the primary image), else 0
fn lens_counter(p: vec2<f32>, kz: f32) -> vec3<f32> {
  let b = lens_beta(p);
  let a0 = sky_deflect(b.x, b.y, kz);
  let prim = lens_newton(b, b + a0, kz);
  let t = lens_newton(b, b - a0, kz);
  let a = sky_deflect(t.x, t.y, kz);
  let res = length(t - a - b);
  let sep = length(t - prim);
  var ok = 0.0;
  if (res < LENS_CONV && sep > LENS_SEP) {
    ok = 1.0;
  }
  return vec3<f32>(t, ok);
}

fn lens_place(t: vec2<f32>) -> vec2<f32> {
  let cw = lensz.cs.x;
  let sw = lensz.cs.y;
  let sc = lensz.cs.z;
  return vec2<f32>(PLATE_HALF + sc * (t.x * cw - t.y * sw), PLATE_HALF + sc * (t.x * sw + t.y * cw));
}

// where a plate point's primary image sits (the dots)
fn lens_pos(p: vec2<f32>, kz: f32) -> vec2<f32> {
  return lens_place(lens_solve(p, kz).xy);
}

fn lens_image(p: vec2<f32>, kz: f32) -> LensImg {
  return lens_image_at(lens_solve(p, kz).xy, kz);
}

// the image at theta t: its plate place and the map A^-1
fn lens_image_at(t: vec2<f32>, kz: f32) -> LensImg {
  let cw = lensz.cs.x;
  let sw = lensz.cs.y;
  let A = lens_jac(t.x, t.y, sky_deflect(t.x, t.y, kz), kz);
  let det = lens_det(A);
  let M11 = A.w / det;
  let M12 = -A.y / det;
  let M21 = -A.z / det;
  let M22 = A.x / det;
  let S11 = cw * (M11 * cw - M12 * sw) - sw * (M21 * cw - M22 * sw);
  let S12 = cw * (M11 * sw + M12 * cw) - sw * (M21 * sw + M22 * cw);
  let S21 = sw * (M11 * cw - M12 * sw) + cw * (M21 * cw - M22 * sw);
  let S22 = sw * (M11 * sw + M12 * cw) + cw * (M21 * sw + M22 * cw);
  return LensImg(lens_place(t), vec4<f32>(S11, S21, S12, S22));
}

