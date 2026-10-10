// The tidal map of a merger (ADR 0009). Reference: `tidal(g, flip)` of mergerSprites
// (app23.js:L538-551) and its use in render() (L1241-1248, L1262).
//
// A map from a galaxy's initial disc coordinates (-0.5 .. 0.5 tile units, doubled to -1 .. 1) to the
// plate: the stars of galaxy g are binned by their initial coordinates in a 21 x 21 grid, a query
// searches rings of cells round its cell until it has found four stars or four rings are done, keeps
// the 4 nearest by (distance, index) and returns the inverse-distance-weighted (1 / (d + 0.02)) mean
// of their CURRENT plate positions. With nothing found it returns the plate's centre.
//
// The data is one buffer of words, `tide: array<u32>` (floats bitcast), at binding 31 of every shader
// that imports this file (read_write, so that the builders and the readers share one declaration).
// Its layout is TIDE_* in src/fallback/kernels/tide.ts:
//   header   [0] n stars  [1] first word of the star table  [2] of the bin offsets  [3] of the bin ids
//            [4] of the grids  [5] plate centre x  [6] plate centre y  [7] n0, the first star of galaxy 1
//            [8] of the depth scales (one word per star: the mark scale of its depth, 1 without persp)
//   stars    4 words each: plate x, plate y (this view), initial DX, DY
//   offsets  2 galaxies x 441 cells + 1: the first slot of each cell's stars in `ids`
//   ids      star indices, cell by cell, in index order within a cell
//   grids    2 galaxies x 49 x 49 vertices x 3 words (plate x, y, depth scale, ADR 0088): the map sampled once
//
// CPU twin: src/fallback/kernels/tide.ts.

@group(0) @binding(31) var<storage, read_write> tide: array<u32>;

const T_CELLS: u32 = 21u;
const T_CELL_COUNT: u32 = 441u;
const T_GN: u32 = 48u;
const T_GV: u32 = 49u;
const T_VW: u32 = 3u;

fn tide_f(i: u32) -> f32 {
  return bitcast<f32>(tide[i]);
}

// The bin of an initial coordinate pair, as v21's key floor((d + 1) / 2 * 20).
fn tide_cell(dx: f32, dy: f32) -> u32 {
  let cx = u32(clamp(floor((dx + 1.0) / 2.0 * 20.0), 0.0, 20.0));
  let cy = u32(clamp(floor((dy + 1.0) / 2.0 * 20.0), 0.0, 20.0));
  return cy * T_CELLS + cx;
}

// tidal(g, false)(x, y) (L538-551), the 4 nearest by (distance, index). (x, y) are in tile units.
fn tide_nn(g: u32, x: f32, y: f32) -> vec3<f32> {
  let star_off = tide[1];
  let off_off = tide[2];
  let ids_off = tide[3];
  let nx = clamp(x * 2.0, -1.0, 1.0);
  let ny = clamp(y * 2.0, -1.0, 1.0);
  let gx = i32(floor((nx + 1.0) / 2.0 * 20.0));
  let gy = i32(floor((ny + 1.0) / 2.0 * 20.0));
  var bd = array<f32, 4>(3.0e38, 3.0e38, 3.0e38, 3.0e38);
  var bi = array<u32, 4>(0xffffffffu, 0xffffffffu, 0xffffffffu, 0xffffffffu);
  var found = 0u;
  for (var ring = 0; ring < 4; ring++) {
    if (found >= 4u) {
      break;
    }
    for (var dx = -ring; dx <= ring; dx++) {
      for (var dy = -ring; dy <= ring; dy++) {
        if (max(abs(dx), abs(dy)) != ring) {
          continue;
        }
        let cx = gx + dx;
        let cy = gy + dy;
        if (cx < 0 || cx > 20 || cy < 0 || cy > 20) {
          continue;
        }
        let cell = g * T_CELL_COUNT + u32(cy) * T_CELLS + u32(cx);
        let lo = tide[off_off + cell];
        let hi = tide[off_off + cell + 1u];
        for (var k = lo; k < hi; k++) {
          let idx = tide[ids_off + k];
          let sx = star_off + idx * 4u;
          let ex = tide_f(sx + 2u) - nx;
          let ey = tide_f(sx + 3u) - ny;
          var d = sqrt(ex * ex + ey * ey);
          var j = idx;
          found++;
          // keep the four smallest (d, index), in order
          for (var s = 0u; s < 4u; s++) {
            if (d < bd[s] || (d == bd[s] && j < bi[s])) {
              let td = bd[s];
              let tj = bi[s];
              bd[s] = d;
              bi[s] = j;
              d = td;
              j = tj;
            }
          }
        }
      }
    }
  }
  if (found == 0u) {
    return vec3<f32>(tide_f(5u), tide_f(6u), 1.0);
  }
  var wx = 0.0;
  var wy = 0.0;
  var wk = 0.0;
  var ws = 0.0;
  for (var s = 0u; s < min(found, 4u); s++) {
    let w = 1.0 / (bd[s] + 0.02);
    let sx = star_off + bi[s] * 4u;
    wx += tide_f(sx) * w;
    wy += tide_f(sx + 1u) * w;
    wk += tide_f(tide[8] + bi[s]) * w;
    ws += w;
  }
  return vec3<f32>(wx / ws, wy / ws, wk / ws);
}

// The 49 x 49 grid of galaxy g sampled once, interpolated bilinearly (tfn, app23.js:L1244-1245).
// v21 clamps to 48 - 1e-6; in f32 that is 48, so the largest f32 below 48 stands in for it.
// (u, v) = (plate offset from the centre) / R2: -0.5 .. 0.5 across the grid.
fn tide_grid(g: u32, u: f32, v: f32) -> vec3<f32> {
  let base = tide[4] + g * (T_GV * T_GV * T_VW);
  let fx = clamp((u + 0.5) * f32(T_GN), 0.0, 47.999996);
  let fy = clamp((v + 0.5) * f32(T_GN), 0.0, 47.999996);
  let ix = u32(floor(fx));
  let iy = u32(floor(fy));
  let ax = fx - floor(fx);
  let ay = fy - floor(fy);
  let o = base + (iy * T_GV + ix) * T_VW;
  let o3 = o + T_GV * T_VW;
  let x = (tide_f(o) * (1.0 - ax) + tide_f(o + T_VW) * ax) * (1.0 - ay) + (tide_f(o3) * (1.0 - ax) + tide_f(o3 + T_VW) * ax) * ay;
  let y = (tide_f(o + 1u) * (1.0 - ax) + tide_f(o + T_VW + 1u) * ax) * (1.0 - ay) + (tide_f(o3 + 1u) * (1.0 - ax) + tide_f(o3 + T_VW + 1u) * ax) * ay;
  let k = (tide_f(o + 2u) * (1.0 - ax) + tide_f(o + T_VW + 2u) * ax) * (1.0 - ay) + (tide_f(o3 + 2u) * (1.0 - ax) + tide_f(o3 + T_VW + 2u) * ax) * ay;
  return vec3<f32>(x, y, k);
}

// The galaxy's `post` (L1248): the grid at a plate point, R2 = 2 * 4.2 * s0 plate px across. The
// third component is the mark scale of the depth there.
fn tide_post(g: u32, p: vec2<f32>, r2: f32) -> vec3<f32> {
  return tide_grid(g, (p.x - tide_f(5u)) / r2, (p.y - tide_f(6u)) / r2);
}
