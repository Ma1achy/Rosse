// Value noise with an optional table of lattice corners per salt: the twin of `vnoise(…, field)`
// in src/core/noise.ts. The engine's own field is empty (every salt hashed, as common/math.wgsl's
// vnoise); the golden runner fills it with v21's corners so a comparison draws v21's pattern.
//
// noise_tab: per salt (16 of them) 8 words [x0 (i32), y0 (i32), w, h (0: hashed), offset, 0, 0, 0],
// then the tables' values as f32 bits; corner (ix, iy) = values[offset + wrap(iy - y0, h) * w +
// wrap(ix - x0, w)]. Every shader that imports this binds the buffer at binding 30.

// #import "common/math.wgsl"

@group(0) @binding(30) var<storage, read> noise_tab: array<u32>;

fn wrap_i(i: i32, n: u32) -> u32 {
  let m = i32(n);
  return u32(((i % m) + m) % m);
}

fn noise_corner_t(ix: i32, iy: i32, seed: u32, salt: u32) -> f32 {
  let h = salt * 8u;
  let w = noise_tab[h + 2u];
  if (w == 0u) {
    return noise_corner(ix, iy, seed, salt);
  }
  let x0 = bitcast<i32>(noise_tab[h]);
  let y0 = bitcast<i32>(noise_tab[h + 1u]);
  let th = noise_tab[h + 3u];
  let o = noise_tab[h + 4u];
  return bitcast<f32>(noise_tab[o + wrap_i(iy - y0, th) * w + wrap_i(ix - x0, w)]);
}

// vnoise (common/math.wgsl) with the corners of noise_corner_t, the same arithmetic.
fn vnoise_t(x: f32, y: f32, seed: u32, salt: u32) -> f32 {
  let xi = floor(x);
  let yi = floor(y);
  let xf = x - xi;
  let yf = y - yi;
  let u = (xf * xf) * (3.0 - 2.0 * xf);
  let v = (yf * yf) * (3.0 - 2.0 * yf);
  let ix = i32(xi);
  let iy = i32(yi);
  let a = noise_corner_t(ix, iy, seed, salt);
  let b = noise_corner_t(ix + 1, iy, seed, salt);
  let c = noise_corner_t(ix, iy + 1, seed, salt);
  let d = noise_corner_t(ix + 1, iy + 1, seed, salt);
  let t1 = (b - a) * u;
  let t2 = (c - a) * v;
  let t3 = ((((a - b) - c) + d) * u) * v;
  return ((a + t1) + t2) + t3;
}
