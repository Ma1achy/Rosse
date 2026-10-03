// Instanced quads for bitmap drawings (ADR 0007): one quad per instance, pulled from a storage
// buffer of Instance, drawn as a 4-vertex triangle strip. The fragment keeps the reference's ink:
// smoothstep(edge.x, edge.y, t) on the sampled ink, times alpha and gain, premultiplied
// (app23.js:L1092-1095). Blend ONE, ONE_MINUS_SRC_ALPHA into the rgba16float ink target, no MSAA.
//
// The mip level is computed per instance from its matrix, as the hardware would from screen
// derivatives (rho = the longer of d(texel)/dx and d(texel)/dy), so the CPU rasteriser
// (src/fallback/raster.ts) can use exactly the same level.

// #import "common/instance.wgsl"

struct Sprite {
  // ink colour, multiplied into the premultiplied output; (1, 1, 1, 1) is the key ink, which the
  // composite pass maps to the palette (src/render/composite.ts)
  ink: vec4<f32>,
  // ink target size, device pixels
  target_size: vec2<f32>,
  // ink edge thresholds (lo, hi)
  edge: vec2<f32>,
  // device pixels per plate unit (plate size x DPR / 800)
  px_per_unit: f32,
  gain: f32,
  // cell size in texels at level 0
  cell: f32,
  // highest mip level
  max_lod: f32,
  // first atlas layer held by the bound texture array
  layer_base: u32,
}

@group(0) @binding(0) var<uniform> sprite: Sprite;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(2) var atlas: texture_2d_array<f32>;
@group(0) @binding(3) var atlas_sampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) layer: u32,
  @location(2) @interpolate(flat) alpha: f32,
  @location(3) @interpolate(flat) lod: f32,
}

// The quad corners, as the reference's strip (-.5,-.5), (.5,-.5), (-.5,.5), (.5,.5).
fn corner(v: u32) -> vec2<f32> {
  return vec2<f32>(f32(v & 1u) - 0.5, f32(v >> 1u) - 0.5);
}

// The mip level of a quad with plate matrix m: the pixel-per-texel matrix is
// a = m * px_per_unit / cell; rho is the longer column of its inverse.
fn sprite_lod(m: vec4<f32>) -> f32 {
  let a = m * (sprite.px_per_unit / sprite.cell);
  let det = abs(a.x * a.w - a.z * a.y);
  let rho = max(length(vec2<f32>(a.w, a.y)), length(vec2<f32>(a.z, a.x))) / det;
  return clamp(log2(rho), 0.0, sprite.max_lod);
}

@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VertexOut {
  let s = instances[i];
  let c = corner(v);
  let p = (s.pos + vec2<f32>(s.m.x * c.x + s.m.z * c.y, s.m.y * c.x + s.m.w * c.y)) * sprite.px_per_unit;
  let d = p / sprite.target_size * 2.0 - 1.0;
  var out: VertexOut;
  out.position = vec4<f32>(d.x, -d.y, 0.0, 1.0);
  out.uv = c + 0.5;
  out.layer = s.layer - sprite.layer_base;
  out.alpha = s.alpha;
  out.lod = sprite_lod(s.m);
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let t = textureSampleLevel(atlas, atlas_sampler, in.uv, in.layer, in.lod).r;
  let a = smoothstep(sprite.edge.x, sprite.edge.y, t) * in.alpha * sprite.gain;
  return vec4<f32>(sprite.ink.rgb * a, a);
}
