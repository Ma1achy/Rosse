// Counter-based random numbers (ADR 0004), the twin of src/core/rng.ts.
//
// Every draw is a pure function of (seed, stream, index, draw): pcg4d (Jarzynski and Olano,
// "Hash Functions for GPU Rendering", JCGT 2020), 32-bit integer operations only, so every GPU
// and the CPU compute the same bits. Checked against tests/vectors/rng.json (tests/gpu/rng.ts).

fn pcg4d(key: vec4<u32>) -> vec4<u32> {
  var v = key * 1664525u + 1013904223u;
  v.x += v.y * v.w;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v.w += v.y * v.z;
  v ^= v >> vec4<u32>(16u);
  v.x += v.y * v.w;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v.w += v.y * v.z;
  return v;
}

// A random u32 for (seed, stream, index, draw): word x of pcg4d.
fn rand_u32(seed: u32, stream: u32, index: u32, draw: u32) -> u32 {
  return pcg4d(vec4<u32>(seed, stream, index, draw)).x;
}

// A u32 to a uniform f32 in [0, 1): f32(u >> 8) * 2^-24, exact.
fn u32_to_unit(u: u32) -> f32 {
  return f32(u >> 8u) * (1.0 / 16777216.0);
}

fn rand_f32(seed: u32, stream: u32, index: u32, draw: u32) -> f32 {
  return u32_to_unit(rand_u32(seed, stream, index, draw));
}

// A standard normal from draws `draw` and `draw + 1` (Box-Muller, cosine branch). Uses log, sqrt
// and cos, so it matches the CPU within a tolerance, not bit for bit. cos(2 pi u2) is computed as
// -cos(2 pi u2 - pi), so the argument stays in [-pi, pi), where WGSL bounds cos's error.
fn rand_gauss(seed: u32, stream: u32, index: u32, draw: u32) -> f32 {
  let u1 = rand_f32(seed, stream, index, draw);
  let u2 = rand_f32(seed, stream, index, draw + 1u);
  let r = sqrt(-2.0 * log(1.0 - u1));
  return r * -cos(6.2831853071795864 * u2 - 3.1415926535897932);
}
