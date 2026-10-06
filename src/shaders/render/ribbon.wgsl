// Ribbons (ADR 0007): textured stroke ribbons (buildCurves' tiled path, app23.js:L822-838) and
// pen-line capsules (the dust hatching, ADR 0006), pulled from the buffers compute/ribbons.wgsl
// writes, into the rgba16float ink target, premultiplied, ONE / ONE_MINUS_SRC_ALPHA, no MSAA.
//
// As in render/sprite.wgsl, everything the CPU rasteriser (src/fallback/raster.ts) has to match is
// computed per pixel from the pixel centre, not left to the hardware:
// - each segment is drawn as a rectangle along the segment, padded by one device pixel, so every
//   pixel centre of the real shape gets exactly one fragment;
// - a textured segment is the reference's two triangles (+n_j, -n_j, +n_j+1) and
//   (-n_j, -n_j+1, +n_j+1): the fragment finds the triangle holding its centre with edge functions
//   (the first triangle wins on the shared diagonal), interpolates (u, v) barycentrically, and takes
//   the mip level from that triangle's texel-per-pixel Jacobian (the longer of its columns);
// - a capsule's coverage is analytic: clamp(w + 0.5 - distance to the segment, 0, 1).
// The ink edge is the reference's: smoothstep(0.12, 0.55) of the sampled ink, times the alpha.

struct RibbonDraw {
  ink: vec4<f32>,
  target_size: vec2<f32>,
  edge: vec2<f32>,
  px_per_unit: f32,
  gain: f32,
  // a stroke row in texels at level 0 (512 x 64)
  cell: vec2<f32>,
  max_lod: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
}

// RIBBON_SEG_LAYOUT (src/model/ribbons.ts)
struct RibbonSeg {
  a: vec4<f32>,
  b: vec4<f32>,
  u: vec2<f32>,
  layer: u32,
  alpha: f32,
}

// CAPSULE_LAYOUT
struct Capsule {
  a: vec2<f32>,
  b: vec2<f32>,
  w: f32,
  alpha: f32,
  pad0: f32,
  pad1: f32,
}

@group(0) @binding(0) var<uniform> draw: RibbonDraw;
@group(0) @binding(1) var<storage, read> segs: array<RibbonSeg>;
@group(0) @binding(2) var strokes: texture_2d_array<f32>;
@group(0) @binding(3) var strokes_sampler: sampler;
@group(0) @binding(4) var<storage, read> caps: array<Capsule>;

// The v21 ribbon edge: v from 0.02 (+n side) to 0.98 (-n side) of the row.
const V0: f32 = 0.02;
const V1: f32 = 0.98;

// Corner k (0..5) of the rectangle along axis t from p0 to p1, half-height h, padded by pad.
fn rect_corner(k: u32, o: vec2<f32>, t: vec2<f32>, lo: vec2<f32>, hi: vec2<f32>) -> vec2<f32> {
  // two triangles: (0, 1, 2), (2, 1, 3) of the corners (lo.x, lo.y), (hi.x, lo.y), (lo.x, hi.y), (hi.x, hi.y)
  var idx = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u);
  let c = idx[k];
  let s = select(lo.x, hi.x, (c & 1u) == 1u);
  let r = select(lo.y, hi.y, (c & 2u) == 2u);
  let n = vec2<f32>(-t.y, t.x);
  return o + t * s + n * r;
}

fn clip_of(p: vec2<f32>) -> vec4<f32> {
  let d = p / draw.target_size * 2.0 - 1.0;
  return vec4<f32>(d.x, -d.y, 0.0, 1.0);
}

struct RibbonOut {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) p01: vec4<f32>,
  @location(1) @interpolate(flat) p23: vec4<f32>,
  @location(2) @interpolate(flat) u: vec2<f32>,
  @location(3) @interpolate(flat) layer: u32,
  @location(4) @interpolate(flat) alpha: f32,
}

@vertex
fn vs_ribbon(@builtin(vertex_index) v: u32) -> RibbonOut {
  let s = segs[v / 6u];
  let k = draw.px_per_unit;
  let p0 = s.a.xy * k;
  let p1 = s.a.zw * k;
  let p2 = s.b.xy * k;
  let p3 = s.b.zw * k;
  let m0 = (p0 + p1) * 0.5;
  let m1 = (p2 + p3) * 0.5;
  let d = m1 - m0;
  let dl = length(d);
  var t = vec2<f32>(1.0, 0.0);
  if (dl > 0.0) {
    t = d / dl;
  }
  let n = vec2<f32>(-t.y, t.x);
  var lo = vec2<f32>(1e30);
  var hi = vec2<f32>(-1e30);
  for (var i = 0u; i < 4u; i++) {
    var p = p0;
    if (i == 1u) {
      p = p1;
    } else if (i == 2u) {
      p = p2;
    } else if (i == 3u) {
      p = p3;
    }
    let q = vec2<f32>(dot(p - m0, t), dot(p - m0, n));
    lo = min(lo, q);
    hi = max(hi, q);
  }
  var out: RibbonOut;
  out.position = clip_of(rect_corner(v % 6u, m0, t, lo - 1.5, hi + 1.5));
  out.p01 = vec4<f32>(p0, p1);
  out.p23 = vec4<f32>(p2, p3);
  out.u = s.u;
  out.layer = s.layer;
  out.alpha = s.alpha;
  return out;
}

// Edge function: twice the signed area of (a, b, c).
fn edge(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> f32 {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// Barycentric weights of c in (a, b, d), or w.x < 0 when outside (edges included).
fn bary(a: vec2<f32>, b: vec2<f32>, d: vec2<f32>, c: vec2<f32>) -> vec4<f32> {
  let area = edge(a, b, d);
  if (area == 0.0) {
    return vec4<f32>(-1.0);
  }
  let w0 = edge(b, d, c) / area;
  let w1 = edge(d, a, c) / area;
  let w2 = edge(a, b, c) / area;
  if (w0 < 0.0 || w1 < 0.0 || w2 < 0.0) {
    return vec4<f32>(-1.0);
  }
  return vec4<f32>(w0, w1, w2, area);
}

// The mip level of a triangle (a, b, d) with texel coordinates (ta, tb, td).
fn tri_lod(a: vec2<f32>, b: vec2<f32>, d: vec2<f32>, ta: vec2<f32>, tb: vec2<f32>, td: vec2<f32>, area: f32) -> f32 {
  // d(weight)/dx and /dy of each vertex's weight
  let gx = vec3<f32>(b.y - d.y, d.y - a.y, a.y - b.y) / area;
  let gy = vec3<f32>(d.x - b.x, a.x - d.x, b.x - a.x) / area;
  let dtx = ta * gx.x + tb * gx.y + td * gx.z;
  let dty = ta * gy.x + tb * gy.y + td * gy.z;
  let rho = max(length(dtx), length(dty));
  return clamp(log2(rho), 0.0, draw.max_lod);
}

@fragment
fn fs_ribbon(in: RibbonOut) -> @location(0) vec4<f32> {
  let c = in.position.xy;
  let p0 = in.p01.xy;
  let p1 = in.p01.zw;
  let p2 = in.p23.xy;
  let p3 = in.p23.zw;
  let t0 = vec2<f32>(in.u.x, V0);
  let t1 = vec2<f32>(in.u.x, V1);
  let t2 = vec2<f32>(in.u.y, V0);
  let t3 = vec2<f32>(in.u.y, V1);
  var uv = vec2<f32>(0.0);
  var lod = 0.0;
  let wa = bary(p0, p1, p2, c);
  if (wa.x >= 0.0) {
    uv = t0 * wa.x + t1 * wa.y + t2 * wa.z;
    lod = tri_lod(p0, p1, p2, t0 * draw.cell, t1 * draw.cell, t2 * draw.cell, wa.w);
  } else {
    let wb = bary(p1, p3, p2, c);
    if (wb.x < 0.0) {
      discard;
    }
    uv = t1 * wb.x + t3 * wb.y + t2 * wb.z;
    lod = tri_lod(p1, p3, p2, t1 * draw.cell, t3 * draw.cell, t2 * draw.cell, wb.w);
  }
  let ink = textureSampleLevel(strokes, strokes_sampler, uv, in.layer, lod).r;
  // at most 1: the edge-on stroke's alpha, lines · (incl − 72)/18, passes 1 beyond 90°, and
  // v21's RGBA8 canvas clamps it where this rgba16float target would not (review m1)
  let a = min(smoothstep(draw.edge.x, draw.edge.y, ink) * in.alpha * draw.gain, 1.0);
  return vec4<f32>(draw.ink.rgb * a, a);
}

struct CapsuleOut {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) ab: vec4<f32>,
  @location(1) @interpolate(flat) w: f32,
  @location(2) @interpolate(flat) alpha: f32,
}

@vertex
fn vs_capsule(@builtin(vertex_index) v: u32) -> CapsuleOut {
  let s = caps[v / 6u];
  let k = draw.px_per_unit;
  let a = s.a * k;
  let b = s.b * k;
  let w = s.w * k;
  let d = b - a;
  let dl = length(d);
  var t = vec2<f32>(1.0, 0.0);
  if (dl > 0.0) {
    t = d / dl;
  }
  let pad = w + 1.5;
  var out: CapsuleOut;
  out.position = clip_of(rect_corner(v % 6u, a, t, vec2<f32>(-pad, -pad), vec2<f32>(dl + pad, pad)));
  out.ab = vec4<f32>(a, b);
  out.w = w;
  out.alpha = s.alpha;
  return out;
}

// Distance from c to the segment ab.
fn seg_dist(c: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let vx = b.x - a.x;
  let vy = b.y - a.y;
  let l2 = vx * vx + vy * vy;
  var t = 0.0;
  if (l2 > 0.0) {
    t = clamp(((c.x - a.x) * vx + (c.y - a.y) * vy) / l2, 0.0, 1.0);
  }
  let ex = (a.x + t * vx) - c.x;
  let ey = (a.y + t * vy) - c.y;
  return sqrt(ex * ex + ey * ey);
}

@fragment
fn fs_capsule(in: CapsuleOut) -> @location(0) vec4<f32> {
  let cov = clamp(in.w + 0.5 - seg_dist(in.position.xy, in.ab.xy, in.ab.zw), 0.0, 1.0);
  if (cov <= 0.0) {
    discard;
  }
  let a = cov * in.alpha * draw.gain;
  return vec4<f32>(draw.ink.rgb * a, a);
}
