// The tidal map's data (ADR 0009, common/tide.wgsl): the bins of the stars' initial disc coordinates
// (model tier, once per merger) and the 49 x 49 grid of each galaxy (view tier, once per view).
// Reference: GRID and `tidal` (app23.js:L536-551), the grid of render() (L1242-1245).
//
// Entry points:
//   init_table   the star table's initial coordinates (DX, DY) from the stars' `ic` (model tier);
//   bin_count    one thread per cell (2 x 441): how many stars of its galaxy fall in it, by a scan of
//                the galaxy's stars: no atomics, so deterministic (ADR 0004);
//   bin_scan     ONE invocation: the exclusive prefix of the counts, the cells' first slots;
//   bin_fill     one thread per cell: the indices of its stars into `ids`, in index order;
//   grid         one thread per grid vertex (2 x 49 x 49): the 4 nearest by (distance, index) by a
//                fixed-order scan of the bins, inverse-distance weights (view tier).
//
// CPU twin: src/fallback/kernels/tide.ts, function for function (ADR 0014).

// #import "common/tide.wgsl"

// the stars' initial disc coordinates (DX, DY, R0, 0)
@group(0) @binding(1) var<storage, read> ic: array<vec4<f32>>;

@compute @workgroup_size(64)
fn init_table(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= tide[0]) {
    return;
  }
  let o = tide[1] + i * 4u;
  tide[o + 2u] = bitcast<u32>(ic[i].x);
  tide[o + 3u] = bitcast<u32>(ic[i].y);
}

// The first and last star of a cell's galaxy.
fn galaxy_range(g: u32) -> vec2<u32> {
  if (g == 0u) {
    return vec2<u32>(0u, tide[7]);
  }
  return vec2<u32>(tide[7], tide[0]);
}

@compute @workgroup_size(64)
fn bin_count(@builtin(global_invocation_id) id: vec3<u32>) {
  let c = id.x;
  if (c >= 2u * T_CELL_COUNT) {
    return;
  }
  let g = c / T_CELL_COUNT;
  let cell = c - g * T_CELL_COUNT;
  let r = galaxy_range(g);
  var n = 0u;
  for (var i = r.x; i < r.y; i++) {
    let o = tide[1] + i * 4u;
    if (tide_cell(tide_f(o + 2u), tide_f(o + 3u)) == cell) {
      n++;
    }
  }
  // counts first, in place of the offsets
  tide[tide[2] + c + 1u] = n;
}

@compute @workgroup_size(1)
fn bin_scan() {
  let off = tide[2];
  tide[off] = 0u;
  for (var c = 0u; c < 2u * T_CELL_COUNT; c++) {
    tide[off + c + 1u] = tide[off + c] + tide[off + c + 1u];
  }
}

@compute @workgroup_size(64)
fn bin_fill(@builtin(global_invocation_id) id: vec3<u32>) {
  let c = id.x;
  if (c >= 2u * T_CELL_COUNT) {
    return;
  }
  let g = c / T_CELL_COUNT;
  let cell = c - g * T_CELL_COUNT;
  let r = galaxy_range(g);
  var k = tide[tide[2] + c];
  for (var i = r.x; i < r.y; i++) {
    let o = tide[1] + i * 4u;
    if (tide_cell(tide_f(o + 2u), tide_f(o + 3u)) == cell) {
      tide[tide[3] + k] = i;
      k++;
    }
  }
}

@compute @workgroup_size(64)
fn grid(@builtin(global_invocation_id) id: vec3<u32>) {
  let v = id.x;
  if (v >= 2u * T_GV * T_GV) {
    return;
  }
  let g = v / (T_GV * T_GV);
  let w = v - g * T_GV * T_GV;
  let gy = w / T_GV;
  let gx = w - gy * T_GV;
  let p = tide_nn(g, f32(gx) / f32(T_GN) - 0.5, f32(gy) / f32(T_GN) - 0.5);
  let o = tide[4] + v * 2u;
  tide[o] = bitcast<u32>(p.x);
  tide[o + 1u] = bitcast<u32>(p.y);
}
