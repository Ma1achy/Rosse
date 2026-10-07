// A placed vector drawing (VINST_LAYOUT in src/model/vectors.ts, 96 bytes), read by
// compute/vector-expand.wgsl and written by compute/dyn-rows.wgsl for the dynamic sets of M7
// (src/model/dynvec.ts: the drawn stars, the deep field's drawings).

struct VInst {
  // tile -> plate px, column-major
  m: vec4<f32>,
  t: vec2<f32>,
  // pen scale
  ps: f32,
  // sqrt |det m|, the dots' and blobs' scale
  sc: f32,
  // warp parameters: rewind (dk, flip, 0, 0); post (cx, cy, 0, 0); tide (galaxy, R2, 0, 0);
  // tide on the screen (mWarp) (galaxy, flip, 0, 0)
  w: vec4<f32>,
  // post: the affine S, column-major
  w2: vec4<f32>,
  drawing: u32,
  warp: u32,
  cap_first: u32,
  dot_first: u32,
  blob_first: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

// the drawing of an inactive row of a dynamic set, and the guard of the expansion: a slot beyond a
// drawing's own segments, dots or blobs expands to nothing
const INACTIVE: u32 = 0xffffffffu;
