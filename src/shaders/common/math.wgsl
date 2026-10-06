// Shared maths: angle wrapping, and smooth value noise on an integer lattice, the twin of
// src/core/noise.ts (replacing the reference's sin-hash vnoise, app23.js:L73-75; ADR 0004).

// #import "common/rng.wgsl"

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

// The noise stream (src/core/streams.ts: Stream.noise); the salt goes in the bits above it.
const STREAM_NOISE: u32 = 14u;

// wrapPi (app23.js:L131): an angle into [-pi, pi).
fn wrap_pi(a: f32) -> f32 {
  let b = a + PI;
  var x = b - TAU * floor(b / TAU);
  if (x >= TAU) {
    x = x - TAU;
  }
  return x - PI;
}

fn noise_corner(ix: i32, iy: i32, seed: u32, salt: u32) -> f32 {
  return u32_to_unit(pcg4d(vec4<u32>(bitcast<u32>(ix), bitcast<u32>(iy), seed, STREAM_NOISE | (salt << 8u))).x);
}

// Smooth value noise in [0, 1): smoothstep interpolation of lattice corners.
fn vnoise(x: f32, y: f32, seed: u32, salt: u32) -> f32 {
  let xi = floor(x);
  let yi = floor(y);
  let xf = x - xi;
  let yf = y - yi;
  let u = (xf * xf) * (3.0 - 2.0 * xf);
  let v = (yf * yf) * (3.0 - 2.0 * yf);
  let ix = i32(xi);
  let iy = i32(yi);
  let a = noise_corner(ix, iy, seed, salt);
  let b = noise_corner(ix + 1, iy, seed, salt);
  let c = noise_corner(ix, iy + 1, seed, salt);
  let d = noise_corner(ix + 1, iy + 1, seed, salt);
  let t1 = (b - a) * u;
  let t2 = (c - a) * v;
  let t3 = ((((a - b) - c) + d) * u) * v;
  return ((a + t1) + t2) + t3;
}

// Sine and cosine from + - * only (Cephes sinf/cosf), the twins of src/core/f32math.ts. WGSL's
// built-in sin and cos may be off by 2^-11 (absolute), up to a plate pixel at the radii the
// stipple reaches; these are about 1 ULP for |x| < 8192 and the same on every adapter.
const FOPI: f32 = 1.27323954473516;
const DP1: f32 = 0.78515625;
const DP2: f32 = 2.4187564849853515625e-4;
const DP3: f32 = 3.77489497744594108e-8;

fn sin_poly(x: f32, z: f32) -> f32 {
  return ((((-1.9515295891e-4 * z + 8.3321608736e-3) * z) + -1.6666654611e-1) * z) * x + x;
}

fn cos_poly(z: f32) -> f32 {
  return ((((2.443315711809948e-5 * z + -1.388731625493765e-3) * z) + 4.166664568298827e-2) * z) * z - 0.5 * z + 1.0;
}

// (octant, reduced argument) of |x|
fn trig_reduce(ax: f32) -> vec2<f32> {
  var j = i32(FOPI * ax);
  var y = f32(j);
  if ((j & 1) != 0) {
    j = j + 1;
    y = y + 1.0;
  }
  let r = ((ax - y * DP1) - y * DP2) - y * DP3;
  return vec2<f32>(f32(j & 7), r);
}

fn sin_f(x: f32) -> f32 {
  var sign = 1.0;
  if (x < 0.0) {
    sign = -1.0;
  }
  let jr = trig_reduce(abs(x));
  var j = i32(jr.x);
  let r = jr.y;
  if (j > 3) {
    sign = -sign;
    j = j - 4;
  }
  let z = r * r;
  var y: f32;
  if (j == 1 || j == 2) {
    y = cos_poly(z);
  } else {
    y = sin_poly(r, z);
  }
  if (sign < 0.0) {
    return -y;
  }
  return y;
}

fn cos_f(x: f32) -> f32 {
  var sign = 1.0;
  let jr = trig_reduce(abs(x));
  var j = i32(jr.x);
  let r = jr.y;
  if (j > 3) {
    j = j - 4;
    sign = -sign;
  }
  if (j > 1) {
    sign = -sign;
  }
  let z = r * r;
  var y: f32;
  if (j == 1 || j == 2) {
    y = sin_poly(r, z);
  } else {
    y = cos_poly(z);
  }
  if (sign < 0.0) {
    return -y;
  }
  return y;
}

fn tan_f(x: f32) -> f32 {
  return sin_f(x) / cos_f(x);
}

// A standard normal from draws `draw` and `draw + 1` (Box-Muller, cosine branch), as rand_gauss in
// common/rng.wgsl but with cos_f, so that it is the same on every adapter to a few ULP (the
// Sersic radius raises it to the power n). Twin: randGaussF in src/core/f32math.ts.
fn rand_gauss_f(seed: u32, stream: u32, index: u32, draw: u32) -> f32 {
  let u1 = rand_f32(seed, stream, index, draw);
  let u2 = rand_f32(seed, stream, index, draw + 1u);
  let r = sqrt(-2.0 * log(1.0 - u1));
  return r * cos_f(TAU * u2);
}
