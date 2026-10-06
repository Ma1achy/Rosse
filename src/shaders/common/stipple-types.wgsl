// Stipple samples: the model tier's output (compute/stipple.wgsl), read by the view tier
// (compute/project.wgsl). Twin of SAMPLE_LAYOUT in src/fallback/kernels/stipple.ts and of
// src/model/classes.ts; tests/unit/layout.test.ts checks the layout.

struct Sample {
  // galaxy frame (galaxy units); for a Sersic sample, (x, y) on the sky before the roll
  pos: vec3<f32>,
  // class in the low byte, flags above
  cls: u32,
  // drawing (atlas layer)
  tile: u32,
  // quad size, plate units
  size: f32,
  // rotation, radians
  rot: f32,
  // the stored uniform of the dust optical-depth cull
  u_tau: f32,
}

const CLS_OLD: u32 = 0u;
const CLS_DISC: u32 = 1u;
const CLS_YOUNG: u32 = 2u;
const CLS_KNOT: u32 = 3u;
const CLS_STAR: u32 = 4u;
const CLS_RSTAR: u32 = 5u;
const CLS_NONE: u32 = 255u;
const CLASS_COUNT: u32 = 6u;

const FLAG_SERSIC2D: u32 = 256u;
const FLAG_TAU: u32 = 512u;
