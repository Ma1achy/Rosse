// Final pass (ADR 0007): the ink target over the surface. The surface is the field colour with
// the paper texture blended in (multiply for Paper, soft-light for Chalkboard), then the plate's
// inset box-shadows (a 1 px rim; on Chalkboard also a 60 px vignette), reproducing the
// reference's CSS (head23.html, .plate). The ink target holds premultiplied ink in which
// (1, 1, 1) means the key ink; here it takes the palette's colour, so switching surface (and
// palette) re-runs only this pass. On the coloured plates (slip, colour) the target holds the
// colours themselves, and `ink` is white (src/render/plates.ts). The twin is `composite` in src/fallback/raster.ts, with the
// helpers of src/render/surface.ts.

struct Composite {
  // background colour, sRGB
  field: vec4<f32>,
  // the palette's key ink, sRGB (white on the coloured plates)
  ink: vec4<f32>,
  // inset shadows, topmost first: colour (sRGB) and alpha; alpha 0 means none
  shadow0: vec4<f32>,
  shadow1: vec4<f32>,
  // (spread0, sigma0, spread1, sigma1), CSS px
  shadow_geom: vec4<f32>,
  // paper texture size, texels
  paper_size: vec2<f32>,
  // paper texels per device pixel: paper width / (512 CSS px x DPR)
  texel_per_px: f32,
  // 0: multiply (Paper), 1: soft-light (Chalkboard)
  blend_mode: u32,
  // plate size, CSS px
  plate_css: f32,
  // device pixels per CSS px
  dpr: f32,
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
    return cb * cs;
  }
  return vec3<f32>(soft_light1(cb.x, cs.x), soft_light1(cb.y, cs.y), soft_light1(cb.z, cs.z));
}

// erf, Abramowitz and Stegun 7.1.26 (|error| < 1.5e-7).
fn erf_approx(x: f32) -> f32 {
  let ax = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * ax);
  var p = 1.061405429;
  p = p * t - 1.453152027;
  p = p * t + 1.421413741;
  p = p * t - 0.284496736;
  p = p * t + 0.254829592;
  let y = 1.0 - p * t * exp(-(ax * ax));
  return select(y, -y, x < 0.0);
}

// How much of a device pixel the shadow's hole covers along one axis.
fn hole_axis(p: f32, spread: f32, sigma: f32) -> f32 {
  let lo = spread;
  let hi = comp.plate_css - spread;
  if (sigma <= 0.0) {
    let a = p / comp.dpr;
    let b = (p + 1.0) / comp.dpr;
    return max(0.0, min(b, hi) - max(a, lo)) / (b - a);
  }
  let x = (p + 0.5) / comp.dpr;
  let k = sigma * 1.4142135;
  return 0.5 * (erf_approx((x - lo) / k) - erf_approx((x - hi) / k));
}

fn shadow_alpha(px: vec2<f32>, alpha: f32, spread: f32, sigma: f32) -> f32 {
  if (alpha <= 0.0) {
    return 0.0;
  }
  return alpha * (1.0 - hole_axis(px.x, spread, sigma) * hole_axis(px.y, spread, sigma));
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  var surface = blend(comp.field.rgb, paper_at(pos.xy));
  // the pixel's index (its top-left corner), as the CPU loops over it
  let px = floor(pos.xy);
  let a1 = shadow_alpha(px, comp.shadow1.a, comp.shadow_geom.z, comp.shadow_geom.w);
  surface = surface * (1.0 - a1) + comp.shadow1.rgb * a1;
  let a0 = shadow_alpha(px, comp.shadow0.a, comp.shadow_geom.x, comp.shadow_geom.y);
  surface = surface * (1.0 - a0) + comp.shadow0.rgb * a0;
  let ink = textureLoad(ink_target, vec2<i32>(pos.xy), 0);
  return vec4<f32>(clamp(surface * (1.0 - ink.a) + ink.rgb * comp.ink.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
