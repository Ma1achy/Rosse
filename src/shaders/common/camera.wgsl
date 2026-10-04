// The camera of the view tier: the View uniform and the one rotation every stage uses, the
// twin of src/view/camera.ts (VIEW_LAYOUT, rotFwd, toScreen, perspective). The trigonometry is
// evaluated once on the CPU and rounded to f32 (viewDesc), so both engines start from the same
// numbers. Galaxy frame: x, y in the disc, z up its axis. View frame: x right, y down the plate,
// z towards the viewer.

struct View {
  cos_i: f32,
  sin_i: f32,
  cos_az: f32,
  sin_az: f32,
  cos_pa: f32,
  sin_pa: f32,
  winding: f32,
  // plate units per galaxy unit: 84 * zoom (app23.js:L1227)
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

// the deep field's camera distance on the view axis (app23.js:L857)
const CAM_DISTANCE: f32 = 30.0;

// rotFwd (app23.js:L440): mirror x by the winding, orbit by az about the galaxy's axis, tilt by
// incl about x.
fn rot_fwd(v: View, p: vec3<f32>) -> vec3<f32> {
  let x0 = p.x * v.winding;
  let x = x0 * v.cos_az - p.y * v.sin_az;
  let ya = x0 * v.sin_az + p.y * v.cos_az;
  return vec3<f32>(x, ya * v.cos_i - p.z * v.sin_i, ya * v.sin_i + p.z * v.cos_i);
}

// The orthographic galaxy (project, app23.js:L153): view-frame x, y -> plate, rolled by pa.
fn to_plate(v: View, q: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    v.cx + (q.x * v.cos_pa - q.y * v.sin_pa) * v.scale,
    v.cy + (q.x * v.sin_pa + q.y * v.cos_pa) * v.scale,
  );
}

// toScreen (app23.js:L860) with a perspective factor k.
fn to_screen(v: View, q: vec2<f32>, k: f32) -> vec2<f32> {
  let f = v.scale * k;
  return vec2<f32>(
    v.cx + (q.x * v.cos_pa - q.y * v.sin_pa) * f,
    v.cy + (q.x * v.sin_pa + q.y * v.cos_pa) * f,
  );
}

// The deep field's perspective factor for a view-frame depth (app23.js:L884).
fn perspective_k(depth: f32) -> f32 {
  return CAM_DISTANCE / (CAM_DISTANCE - depth);
}
