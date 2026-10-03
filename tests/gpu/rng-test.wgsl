// GPU half of the shared RNG vectors (tests/gpu/rng.ts): for each key, pcg4d and the u32,
// uniform and Gaussian draws of src/shaders/common/rng.wgsl.

// #import "common/rng.wgsl"

@group(0) @binding(0) var<storage, read> keys: array<vec4<u32>>;
// per key: pcg4d(key), then (rand_u32, bits of rand_f32, bits of rand_gauss, 0)
@group(0) @binding(1) var<storage, read_write> results: array<vec4<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= arrayLength(&keys)) {
    return;
  }
  let k = keys[i];
  results[2u * i] = pcg4d(k);
  results[2u * i + 1u] = vec4<u32>(
    rand_u32(k.x, k.y, k.z, k.w),
    bitcast<u32>(rand_f32(k.x, k.y, k.z, k.w)),
    bitcast<u32>(rand_gauss(k.x, k.y, k.z, k.w)),
    0u,
  );
}
