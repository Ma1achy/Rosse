// Final pass (ADR 0007): the ink target over the surface. The surface is the field colour with
// the paper texture blended in (overlay for Paper, soft-light for Chalkboard), reproducing the
// reference's CSS (head23.html, .plate). The ink target holds premultiplied ink in which
// (1, 1, 1) means the key ink; here it takes the palette's colour, so switching surface (and
// palette) re-runs only this pass. The twin is compositePixel in src/fallback/raster.ts.

struct Composite {
  // background colour, sRGB
  field: vec4<f32>,
  // the palette's key ink, sRGB
  ink: vec4<f32>,
  // paper texture size, texels
  paper_size: vec2<f32>,
  // paper texels per device pixel: paper width / (512 CSS px x DPR)
  texel_per_px: f32,
  // 0: overlay (Paper), 1: soft-light (Chalkboard)
  blend_mode: u32,
}

@group(0) @binding(0) var<uniform> comp: Composite;
@group(0) @binding(1) var ink_target: texture_2d<f32>;
@group(0) @binding(2) var paper: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4<f32> {
  // one triangle covering the target
  let p = vec2<f32>(f32((v << 1u) & 2u), f32(v & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn wrap(i: i32, n: i32) -> i32 {
  return ((i % n) + n) % n;
}

// Bilinear, repeating, from texel loads (so the CPU can do the same arithmetic).
fn paper_at(px: vec2<f32>) -> vec3<f32> {
  let t = px * comp.texel_per_px - 0.5;
  let t0 = floor(t);
  let w = t - t0;
  let n = vec2<i32>(comp.paper_size);
  let x0 = wrap(i32(t0.x), n.x);
  let y0 = wrap(i32(t0.y), n.y);
  let x1 = wrap(x0 + 1, n.x);
  let y1 = wrap(y0 + 1, n.y);
  let a = textureLoad(paper, vec2<i32>(x0, y0), 0).rgb;
  let b = textureLoad(paper, vec2<i32>(x1, y0), 0).rgb;
  let c = textureLoad(paper, vec2<i32>(x0, y1), 0).rgb;
  let d = textureLoad(paper, vec2<i32>(x1, y1), 0).rgb;
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn overlay1(cb: f32, cs: f32) -> f32 {
  if (cb <= 0.5) {
    return cs * (2.0 * cb);
  }
  let c2 = 2.0 * cb - 1.0;
  return (cs + c2) - cs * c2;
}

fn soft_light1(cb: f32, cs: f32) -> f32 {
  if (cs <= 0.5) {
    return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
  }
  var d: f32;
  if (cb <= 0.25) {
    d = ((16.0 * cb - 12.0) * cb + 4.0) * cb;
  } else {
    d = sqrt(cb);
  }
  return cb + (2.0 * cs - 1.0) * (d - cb);
}

fn blend(cb: vec3<f32>, cs: vec3<f32>) -> vec3<f32> {
  if (comp.blend_mode == 0u) {
    return vec3<f32>(overlay1(cb.x, cs.x), overlay1(cb.y, cs.y), overlay1(cb.z, cs.z));
  }
  return vec3<f32>(soft_light1(cb.x, cs.x), soft_light1(cb.y, cs.y), soft_light1(cb.z, cs.z));
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let surface = blend(comp.field.rgb, paper_at(pos.xy));
  let ink = textureLoad(ink_target, vec2<i32>(pos.xy), 0);
  return vec4<f32>(clamp(surface * (1.0 - ink.a) + ink.rgb * comp.ink.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
