// The hand wobble (distort): the reference's screen map SM (app23.js:L162-168), the twin of
// smWarp in src/view/warp.ts. A point in plate units moves by d0 * (noise - 0.5) on each axis,
// d0 = distort * 26, along lattice noise at v21's scale (0.011) and offsets, with a fixed lattice
// key (the same field for every seed, as v21's). d0 = 0 is the identity.

// #import "common/noise-table.wgsl"

const WOBBLE_SCALE: f32 = 0.011;
const WOBBLE_KEY: u32 = 0u;
// NoiseSalt.wobbleX, wobbleY (src/core/noise.ts)
const SALT_WOBBLE_X: u32 = 9u;
const SALT_WOBBLE_Y: u32 = 10u;

fn sm_warp(p: vec2<f32>, d0: f32) -> vec2<f32> {
  if (!(d0 > 0.0)) {
    return p;
  }
  let xs = p.x * WOBBLE_SCALE;
  let ys = p.y * WOBBLE_SCALE;
  let nx = vnoise_t(xs + 3.1, ys + 7.7, WOBBLE_KEY, SALT_WOBBLE_X) - 0.5;
  let ny = vnoise_t(xs + 11.3, ys - 2.9, WOBBLE_KEY, SALT_WOBBLE_Y) - 0.5;
  return vec2<f32>(p.x + d0 * nx, p.y + d0 * ny);
}
