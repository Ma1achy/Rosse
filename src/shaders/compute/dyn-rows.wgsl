// Instance rows of the dynamic vector sets (M7, src/model/dynvec.ts), written each view into the
// table compute/vector-expand.wgsl expands, at fixed strides of slots, so that no count has to
// come back to the CPU (ADR 0003).
//
//   rows_rstar  row k is the k-th compacted drawn star (class `rstar` of the stipple's output,
//               [x, y, tile, ps, m]): the drawing `first + tile` of the `sstars` sheet at its matrix
//               and pen scale (app23.js:L190); rows beyond the class's count are inactive.
//
// CPU twin: src/model/dynvec.ts `rstarRows`.

// #import "common/instance.wgsl"
// #import "common/vinst.wgsl"

struct Rows {
  // the set's capacity
  n_rows: u32,
  // the first instance of the source class in `src`, and where its count is in `src_args`
  src_base: u32,
  args_at: u32,
  // the drawing index of the sheet's first drawing
  first: u32,
  stride_c: u32,
  stride_d: u32,
  stride_b: u32,
  pad0: u32,
}

@group(0) @binding(0) var<uniform> rows: Rows;
@group(0) @binding(1) var<storage, read> src: array<Instance>;
@group(0) @binding(2) var<storage, read> src_args: array<u32>;
@group(0) @binding(3) var<storage, read_write> inst: array<VInst>;

@compute @workgroup_size(64)
fn rows_rstar(@builtin(global_invocation_id) id: vec3<u32>) {
  let k = id.x;
  if (k >= rows.n_rows) {
    return;
  }
  let count = min(src_args[rows.args_at], rows.n_rows);
  var I = VInst(
    vec4<f32>(0.0),
    vec2<f32>(0.0),
    0.0,
    0.0,
    vec4<f32>(0.0),
    vec4<f32>(0.0),
    INACTIVE,
    0u,
    k * rows.stride_c,
    k * rows.stride_d,
    k * rows.stride_b,
    0u,
    0u,
    0u,
  );
  if (k < count) {
    let s = src[rows.src_base + k];
    I.m = s.m;
    I.t = s.pos;
    I.ps = s.alpha;
    I.sc = sqrt(abs(s.m.x * s.m.w - s.m.y * s.m.z));
    I.drawing = rows.first + s.layer;
  }
  inst[k] = I;
}
