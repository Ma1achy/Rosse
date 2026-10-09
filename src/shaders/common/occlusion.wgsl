// The occluder depth grid (ADR 0074): the twin of src/model/occlusion.ts, constant for constant.
// One u32 per cell of OCC_GRID x OCC_GRID over the plate, the largest occ_key of the marks nearer
// the viewer that fall in it (halo included), 0 for nothing. View-space z points TOWARDS THE
// VIEWER (common/camera.wgsl), so a larger z is nearer and a larger key is nearer.

const OCC_GRID: i32 = 400;
// 400 / 800 rounded to f32 (exact)
const OCC_INV: f32 = 0.5;
const OCC_PLATE: f32 = 800.0;
const OCC_HALO: i32 = 1;
const OCC_Z_RANGE: f32 = 64.0;
const OCC_Z_SCALE: f32 = 2048.0;
const OCC_EPS: u32 = 102u;

fn occ_key(z: f32) -> u32 {
  let c = clamp(z, -OCC_Z_RANGE, OCC_Z_RANGE);
  return u32(floor((c + OCC_Z_RANGE) * OCC_Z_SCALE)) + 1u;
}

// the cell of a plate position, row-major, or -1 off the plate
fn occ_cell(p: vec2<f32>) -> i32 {
  if (!(p.x >= 0.0 && p.x < OCC_PLATE && p.y >= 0.0 && p.y < OCC_PLATE)) {
    return -1;
  }
  let cx = min(i32(floor(p.x * OCC_INV)), OCC_GRID - 1);
  let cy = min(i32(floor(p.y * OCC_INV)), OCC_GRID - 1);
  return cy * OCC_GRID + cx;
}
