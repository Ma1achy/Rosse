// Instanced quads for bitmap drawings (ADR 0007): one quad per instance, pulled from a storage
// buffer of Instance, drawn as a 4-vertex triangle strip. The fragment keeps the reference's ink:
// smoothstep(edge.x, edge.y, t) on the sampled ink, times alpha and gain, premultiplied
// (app23.js:L1092-1095). Blend ONE, ONE_MINUS_SRC_ALPHA into the rgba16float ink target, no MSAA.
//
// Three things are done so that the CPU rasteriser (src/fallback/raster.ts) can do exactly the
// same arithmetic:
// - the mip level, per instance, from its matrix, as hardware would from screen derivatives
//   (rho = the longer of d(texel)/dx and d(texel)/dy);
// - the texture coordinate, per fragment, from the pixel centre through the instance's inverse
//   matrix, rather than interpolated from the vertices, so it does not depend on how the
//   rasteriser snaps vertex positions;
// - coverage: the quad is padded by one device pixel on every side and a pixel is inked only when
//   its centre maps inside the cell (0 <= uv <= 1), so the edge rule is the CPU's, not the
//   rasteriser's.

// #import "common/instance.wgsl"

struct Sprite {
  // ink colour, multiplied into the premultiplied output; (1, 1, 1) is the key ink, which the
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
  // how many layers it holds: instances of other layers are not drawn by this draw (an atlas
  // split over several arrays is drawn once per array from the same instance buffer)
  layer_count: u32,
  // the plate's offset, plate units (the slipped plates' `uOff`, app23.js:L1093)
  off: vec2<f32>,
  // the inks of tints 1 to 15 of a dot (ADR 0091); a tint without a ramp is the ink
  tint1: vec4<f32>,
  tint2: vec4<f32>,
  tint3: vec4<f32>,
  tint4: vec4<f32>,
  tint5: vec4<f32>,
  tint6: vec4<f32>,
  tint7: vec4<f32>,
  tint8: vec4<f32>,
  tint9: vec4<f32>,
  tint10: vec4<f32>,
  tint11: vec4<f32>,
  tint12: vec4<f32>,
  tint13: vec4<f32>,
  tint14: vec4<f32>,
  tint15: vec4<f32>,
}

@group(0) @binding(0) var<uniform> sprite: Sprite;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(2) var atlas: texture_2d_array<f32>;
@group(0) @binding(3) var atlas_sampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  // the instance centre, device pixels
  @location(0) @interpolate(flat) centre: vec2<f32>,
  // device pixels to quad-local coordinates (-0.5..0.5), column-major 2x2
  @location(1) @interpolate(flat) inv: vec4<f32>,
  @location(2) @interpolate(flat) layer: u32,
  @location(3) @interpolate(flat) alpha: f32,
  @location(4) @interpolate(flat) lod: f32,
  @location(5) @interpolate(flat) tint: u32,
}

// The quad corners, as the reference's strip (-.5,-.5), (.5,-.5), (-.5,.5), (.5,.5).
fn corner(v: u32) -> vec2<f32> {
  return vec2<f32>(f32(v & 1u) - 0.5, f32(v >> 1u) - 0.5);
}

// The inverse of a column-major 2x2.
fn inverse2(a: vec4<f32>) -> vec4<f32> {
  let det = a.x * a.w - a.z * a.y;
  return vec4<f32>(a.w, -a.y, -a.z, a.x) / det;
}

// The mip level of a quad with plate matrix m: the texel-per-pixel matrix is the inverse of
// a = m * px_per_unit / cell; rho is its longer column.
fn sprite_lod(m: vec4<f32>) -> f32 {
  let b = inverse2(m * (sprite.px_per_unit / sprite.cell));
  let rho = max(length(b.xy), length(b.zw));
  return clamp(log2(rho), 0.0, sprite.max_lod);
}

@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VertexOut {
  let s = instances[i];
  var out: VertexOut;
  if (s.layer < sprite.layer_base || s.layer - sprite.layer_base >= sprite.layer_count) {
    // not in this texture array: a degenerate quad outside the clip volume
    out.position = vec4<f32>(-2.0, -2.0, 0.0, 1.0);
    return out;
  }
  let m = s.m * sprite.px_per_unit;
  // one device pixel of padding on each side, along each of the quad's axes
  let axes = vec2<f32>(length(m.xy), length(m.zw));
  let c = corner(v) * (axes + 2.0) / max(axes, vec2<f32>(1e-6));
  let centre = (s.pos + sprite.off) * sprite.px_per_unit;
  let p = centre + vec2<f32>(m.x * c.x + m.z * c.y, m.y * c.x + m.w * c.y);
  let d = p / sprite.target_size * 2.0 - 1.0;
  out.position = vec4<f32>(d.x, -d.y, 0.0, 1.0);
  out.centre = centre;
  out.inv = inverse2(m);
  out.layer = s.layer - sprite.layer_base;
  // a dot's tint rides in its alpha: alpha + 2 * tint (ADR 0091)
  let tint = u32(floor(s.alpha * 0.5));
  out.alpha = s.alpha - 2.0 * f32(tint);
  out.tint = tint;
  out.lod = sprite_lod(s.m);
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let d = in.position.xy - in.centre;
  let uv = vec2<f32>(in.inv.x * d.x + in.inv.z * d.y, in.inv.y * d.x + in.inv.w * d.y) + 0.5;
  if (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0))) {
    discard;
  }
  let t = textureSampleLevel(atlas, atlas_sampler, uv, in.layer, in.lod).r;
  let a = smoothstep(sprite.edge.x, sprite.edge.y, t) * in.alpha * sprite.gain;
  var ink = sprite.ink.rgb;
  switch in.tint {
    case 1u: { ink = sprite.tint1.rgb; }
    case 2u: { ink = sprite.tint2.rgb; }
    case 3u: { ink = sprite.tint3.rgb; }
    case 4u: { ink = sprite.tint4.rgb; }
    case 5u: { ink = sprite.tint5.rgb; }
    case 6u: { ink = sprite.tint6.rgb; }
    case 7u: { ink = sprite.tint7.rgb; }
    case 8u: { ink = sprite.tint8.rgb; }
    case 9u: { ink = sprite.tint9.rgb; }
    case 10u: { ink = sprite.tint10.rgb; }
    case 11u: { ink = sprite.tint11.rgb; }
    case 12u: { ink = sprite.tint12.rgb; }
    case 13u: { ink = sprite.tint13.rgb; }
    case 14u: { ink = sprite.tint14.rgb; }
    case 15u: { ink = sprite.tint15.rgb; }
    default: {}
  }
  return vec4<f32>(ink * a, a);
}
