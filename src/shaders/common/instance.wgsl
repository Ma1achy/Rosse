// The instance layout shared by compute (writers) and render (readers). It is the reference's
// row [x, y, tile, alpha, m0, m1, m2, m3] (app23.js:L160, L171), with the tile as a u32 layer.
// The TypeScript twin is INSTANCE_LAYOUT in src/marks/instance.ts; tests/unit/layout.test.ts
// checks that the two agree.

struct Instance {
  // centre, in plate units (800 x 800, y down)
  pos: vec2<f32>,
  // the drawing: a layer of the atlas's texture array
  layer: u32,
  // ink alpha
  alpha: f32,
  // 2x2 affine, column-major as GLSL mat2: corner (cx, cy) maps to (m.x cx + m.z cy, m.y cx + m.w cy)
  m: vec4<f32>,
}
