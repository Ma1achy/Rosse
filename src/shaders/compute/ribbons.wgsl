// Curves to ribbons, pieces and hatches (the view tier of the line-work, ADR 0010). Reference:
// buildCurves (app23.js:L802-838) and the hatching of parts (L1047-1050) with expandVector
// (L1190-1219). The model tier's buffers are described in src/model/ribbons.ts.
//
// Entry points, in dispatch order:
//   project_points  every scene point (curves, lane points, carving lines, hatch anchors) to the
//                   plate, as project (app23.js:L153);
//   measure         ONE invocation, sequential and so deterministic: per curve the arc-length
//                   prefix sum, the total, cw = clamp(PEN.line * w * h / thick, 6, 90), kpx,
//                   reps = max(1, round(tot / (1.4 * 512 * kpx))) (1 when stretched), the first
//                   slot of a re-spaced curve's pieces (a running sum) and the pieces' indirect
//                   draw count;
//   expand          one textured ribbon segment (two triangles): normals from the neighbouring
//                   points, half width cw * taper / 2, u = (L / tot) * reps, through the wobble;
//   place_pieces    one re-spaced piece: its curve by binary search on the slots, its arc
//                   position (rep * 512 + x) * tot / (reps * 512), its segment by binary search
//                   on L, offset (y - 32) * kpx * taper across, size * kpx * taper, along the
//                   tangent;
//   hatch_caps      one segment of a hatch's pen line, as a capsule of half width
//                   PEN.line / 2 * 0.38 plate px (ADR 0006);
//   hatch_dots      one dot of a hatch's drawing, as a dots sprite;
//   hatch_blobs     one blob of a hatch's drawing, as a knots sprite.
// Directions are unit vectors turned by stored (cos, sin): no atan2, so both engines agree.
//
// CPU twin: src/fallback/kernels/ribbons.ts, function for function (ADR 0014).

// #import "common/camera.wgsl"
// #import "common/instance.wgsl"
// #import "common/warp.wgsl"

// RIB_LAYOUT in src/model/ribbons.ts
struct Rib {
  n_points: u32,
  n_curves: u32,
  n_segs: u32,
  piece_cap: u32,
  n_hatch: u32,
  n_caps: u32,
  n_hdots: u32,
  n_hblobs: u32,
  // PEN.line, plate px
  pen_line: f32,
  // the hand wobble's amplitude (0: off)
  wobble: f32,
  zoom: f32,
  // the edge-on stroke's alpha for this inclination
  edge_alpha: f32,
  // a stroke row's size in sheet pixels
  sheet_w: f32,
  sheet_h: f32,
  n_dot_pool: u32,
  pad0: u32,
}

// CURVE_LAYOUT
struct Curve {
  first: u32,
  n: u32,
  // the stroke: a layer of the strokes array
  layer: u32,
  flags: u32,
  w: f32,
  a: f32,
  thick: f32,
  seg_first: u32,
  piece_first: u32,
  piece_n: u32,
  cap_reps: u32,
  slot_first: u32,
}

// CURVE_STATE_LAYOUT
struct CurveState {
  tot: f32,
  cw: f32,
  kpx: f32,
  reps: u32,
  // the first slot of the curve's pieces
  base: u32,
  alpha: f32,
  pad0: u32,
  pad1: u32,
}

// RIBBON_SEG_LAYOUT: the four corners (end j: +n, -n; end j+1: +n, -n), plate units
struct RibbonSeg {
  a: vec4<f32>,
  b: vec4<f32>,
  u: vec2<f32>,
  layer: u32,
  alpha: f32,
}

// HATCH_LAYOUT
struct Hatch {
  a: u32,
  b: u32,
  tile: u32,
  cap_first: u32,
  dot_first: u32,
  blob_first: u32,
  off_n: f32,
  off_y: f32,
  off_f: f32,
  len: f32,
  cos_d: f32,
  sin_d: f32,
}

// CAPSULE_LAYOUT, plate units
struct Capsule {
  a: vec2<f32>,
  b: vec2<f32>,
  w: f32,
  alpha: f32,
  pad0: f32,
  pad1: f32,
}

const FLAG_TAPER: u32 = 1u;
const FLAG_STRETCH: u32 = 2u;
const FLAG_PIECES: u32 = 4u;
const FLAG_EDGE_ALPHA: u32 = 8u;
const HATCH_PEN: f32 = 0.38;
const HATCH_FLAT: f32 = 0.28;
const KNOT_POOL: u32 = 24u;

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<uniform> rib: Rib;
@group(0) @binding(2) var<storage, read> points3: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> points: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> curves: array<Curve>;
@group(0) @binding(5) var<storage, read_write> arc: array<f32>;
@group(0) @binding(6) var<storage, read_write> state: array<CurveState>;
@group(0) @binding(7) var<storage, read> pieces_tab: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> segs: array<RibbonSeg>;
@group(0) @binding(9) var<storage, read_write> piece_out: array<Instance>;
@group(0) @binding(10) var<storage, read_write> args: array<u32>;
@group(0) @binding(11) var<storage, read> hatches: array<Hatch>;
@group(0) @binding(12) var<storage, read> pen_table: array<u32>;
@group(0) @binding(13) var<storage, read> pen_segs: array<vec4<f32>>;
@group(0) @binding(14) var<storage, read> pen_dots: array<vec4<f32>>;
@group(0) @binding(15) var<storage, read> pen_blobs: array<vec4<f32>>;
@group(0) @binding(16) var<storage, read_write> caps: array<Capsule>;
@group(0) @binding(17) var<storage, read_write> hdots: array<Instance>;
@group(0) @binding(18) var<storage, read_write> hblobs: array<Instance>;
@group(0) @binding(19) var<storage, read> pool: array<u32>;
@group(0) @binding(20) var<storage, read> dot_base: array<f32>;

@compute @workgroup_size(64)
fn project_points(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= rib.n_points) {
    return;
  }
  points[i] = to_plate(view, rot_fwd(view, points3[i].xyz).xy);
}

@compute @workgroup_size(1)
fn measure() {
  var total = 0u;
  for (var c = 0u; c < rib.n_curves; c++) {
    let cv = curves[c];
    arc[cv.first] = 0.0;
    for (var j = 1u; j < cv.n; j++) {
      let d = points[cv.first + j] - points[cv.first + j - 1u];
      arc[cv.first + j] = arc[cv.first + j - 1u] + sqrt(d.x * d.x + d.y * d.y);
    }
    var tot = 0.0;
    if (cv.n > 0u) {
      tot = arc[cv.first + cv.n - 1u];
    }
    if (tot == 0.0) {
      tot = 1.0;
    }
    let cw = clamp(((rib.pen_line * cv.w) * rib.sheet_h) / cv.thick, 6.0, 90.0);
    let kpx = cw / rib.sheet_h;
    let pat = rib.sheet_w * kpx;
    var reps = 1u;
    if ((cv.flags & FLAG_STRETCH) == 0u) {
      reps = max(1u, u32(floor(tot / (pat * 1.4) + 0.5)));
    }
    let base = total;
    if ((cv.flags & FLAG_PIECES) != 0u) {
      if (cv.n < 2u) {
        reps = 0u;
      } else {
        reps = min(reps, cv.cap_reps);
      }
      total = total + reps * cv.piece_n;
    }
    var alpha = cv.a;
    if ((cv.flags & FLAG_EDGE_ALPHA) != 0u) {
      alpha = rib.edge_alpha;
    }
    state[c] = CurveState(tot, cw, kpx, reps, base, alpha, 0u, 0u);
  }
  args[0] = 4u;
  args[1] = total;
  args[2] = 0u;
  args[3] = 0u;
}

// The last curve whose first textured segment is at or before i.
fn curve_of_segment(i: u32) -> u32 {
  var lo = 0u;
  var hi = rib.n_curves;
  while (hi - lo > 1u) {
    let mid = (lo + hi) >> 1u;
    if (curves[mid].seg_first <= i) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

// The last curve whose first piece slot is at or before i.
fn curve_of_slot(i: u32) -> u32 {
  var lo = 0u;
  var hi = rib.n_curves;
  while (hi - lo > 1u) {
    let mid = (lo + hi) >> 1u;
    if (state[mid].base <= i) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

@compute @workgroup_size(64)
fn expand(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= rib.n_segs) {
    return;
  }
  let c = curve_of_segment(i);
  let cv = curves[c];
  let st = state[c];
  let taper = (cv.flags & FLAG_TAPER) != 0u;
  let j = i - cv.seg_first;
  // a curve with fewer points than its slots (the lensed branches of M9, whose length is found
  // on the GPU): the segments past its end are nothing
  if (j + 1u >= cv.n) {
    segs[i] = RibbonSeg(vec4<f32>(0.0), vec4<f32>(0.0), vec2<f32>(0.0), cv.layer, 0.0);
    return;
  }
  var corners: array<vec2<f32>, 4>;
  var us: array<f32, 2>;
  for (var k = 0u; k < 2u; k++) {
    let e = j + k;
    let a = points[cv.first + max(e, 1u) - 1u];
    let b = points[cv.first + min(cv.n - 1u, e + 1u)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    var tl = sqrt(tx * tx + ty * ty);
    if (tl == 0.0) {
      tl = 1.0;
    }
    let nx = -ty / tl;
    let ny = tx / tl;
    let fr = arc[cv.first + e] / st.tot;
    var tap = 1.0;
    if (taper) {
      tap = 1.1 - 0.45 * fr;
    }
    let w = (st.cw * tap) / 2.0;
    let p = points[cv.first + e];
    corners[2u * k] = sm_warp(vec2<f32>(p.x + nx * w, p.y + ny * w), rib.wobble);
    corners[2u * k + 1u] = sm_warp(vec2<f32>(p.x - nx * w, p.y - ny * w), rib.wobble);
    us[k] = fr * f32(st.reps);
  }
  segs[i] = RibbonSeg(
    vec4<f32>(corners[0], corners[1]),
    vec4<f32>(corners[2], corners[3]),
    vec2<f32>(us[0], us[1]),
    cv.layer,
    st.alpha,
  );
}

@compute @workgroup_size(64)
fn place_pieces(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= rib.piece_cap || i >= args[1]) {
    return;
  }
  let c = curve_of_slot(i);
  let cv = curves[c];
  let st = state[c];
  let local = i - st.base;
  let rep = local / cv.piece_n;
  let pj = local - rep * cv.piece_n;
  let pc = pieces_tab[cv.piece_first + pj];
  let along = st.tot / (f32(st.reps) * rib.sheet_w);
  let s_pos = (f32(rep) * rib.sheet_w + pc.x) * along;
  var lo = 1u;
  var hi = cv.n - 1u;
  while (lo < hi) {
    let mid = (lo + hi) >> 1u;
    if (arc[cv.first + mid] < s_pos) {
      lo = mid + 1u;
    } else {
      hi = mid;
    }
  }
  let j = lo;
  let l0 = arc[cv.first + j - 1u];
  var dl = arc[cv.first + j] - l0;
  if (dl == 0.0) {
    dl = 1.0;
  }
  let fr = (s_pos - l0) / dl;
  let a = points[cv.first + j - 1u];
  let b = points[cv.first + j];
  let tx = b.x - a.x;
  let ty = b.y - a.y;
  let x = a.x + tx * fr;
  let y = a.y + ty * fr;
  let tl0 = sqrt(tx * tx + ty * ty);
  var tl = tl0;
  if (tl0 == 0.0) {
    tl = 1.0;
  }
  let nx = -ty / tl;
  let ny = tx / tl;
  var tap = 1.0;
  if ((cv.flags & FLAG_TAPER) != 0u) {
    tap = 1.1 - (0.45 * s_pos) / st.tot;
  }
  let off = ((pc.y - rib.sheet_h / 2.0) * st.kpx) * tap;
  let p = sm_warp(vec2<f32>(x + nx * off, y + ny * off), rib.wobble);
  let size = (pc.z * st.kpx) * tap;
  var cs = 1.0;
  var sn = 0.0;
  if (tl0 != 0.0) {
    cs = tx / tl;
    sn = ty / tl;
  }
  piece_out[i] = Instance(p, u32(pc.w), st.alpha, vec4<f32>(cs * size, sn * size, -(sn * size), cs * size));
}

// A hatch laid out for the view: centre, matrix (tile to plate) and scale.
struct HatchFrame {
  c: vec2<f32>,
  m: vec4<f32>,
  sc: f32,
  tile: u32,
}

fn hatch_frame(h: u32) -> HatchFrame {
  let H = hatches[h];
  let qa = points[H.a];
  let qb = points[H.b];
  let dx = qb.x - qa.x;
  let dy = qb.y - qa.y;
  let dl = sqrt(dx * dx + dy * dy);
  var d0x = 1.0;
  var d0y = 0.0;
  if (dl != 0.0) {
    d0x = dx / dl;
    d0y = dy / dl;
  }
  let ux = d0x * H.cos_d - d0y * H.sin_d;
  let uy = d0x * H.sin_d + d0y * H.cos_d;
  let z = rib.zoom;
  let on = H.off_n * z;
  let oy = H.off_y * z;
  let off_f = H.off_f * z;
  let cx = (qa.x + (-d0y) * on) + ux * off_f;
  let cy = ((qa.y + d0x * on) + oy) + uy * off_f;
  let L = H.len * z;
  let Lf = L * HATCH_FLAT;
  let m = vec4<f32>(ux * L, uy * L, -(uy * Lf), ux * Lf);
  let det = m.x * m.w - m.y * m.z;
  return HatchFrame(vec2<f32>(cx, cy), m, sqrt(abs(det)), H.tile);
}

fn hatch_tf(F: HatchFrame, p: vec2<f32>) -> vec2<f32> {
  return sm_warp(vec2<f32>((F.c.x + F.m.x * p.x) + F.m.z * p.y, (F.c.y + F.m.y * p.x) + F.m.w * p.y), rib.wobble);
}

// The last hatch whose first item (field 0: capsule, 1: dot, 2: blob) is at or before i.
fn hatch_of(i: u32, field: u32) -> u32 {
  var lo = 0u;
  var hi = rib.n_hatch;
  while (hi - lo > 1u) {
    let mid = (lo + hi) >> 1u;
    var first = hatches[mid].cap_first;
    if (field == 1u) {
      first = hatches[mid].dot_first;
    } else if (field == 2u) {
      first = hatches[mid].blob_first;
    }
    if (first <= i) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

@compute @workgroup_size(64)
fn hatch_caps(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= rib.n_caps) {
    return;
  }
  let h = hatch_of(i, 0u);
  let F = hatch_frame(h);
  let s = pen_table[F.tile * 8u] + i - hatches[h].cap_first;
  let g = pen_segs[s];
  caps[i] = Capsule(hatch_tf(F, g.xy), hatch_tf(F, g.zw), (rib.pen_line / 2.0) * HATCH_PEN, 1.0, 0.0, 0.0);
}

@compute @workgroup_size(64)
fn hatch_dots(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= rib.n_hdots) {
    return;
  }
  let h = hatch_of(i, 1u);
  let F = hatch_frame(h);
  let d = pen_dots[pen_table[F.tile * 8u + 2u] + i - hatches[h].dot_first];
  let p = hatch_tf(F, d.xy);
  let t = pool[KNOT_POOL + u32(d.w) % max(1u, rib.n_dot_pool)];
  let k0 = clamp((((2.0 * d.z) * F.sc) * 0.42) / 2.6, 0.8, 1.6);
  let k = k0 * max(0.55, HATCH_PEN);
  let size = dot_base[t] * k;
  hdots[i] = Instance(p, t, 1.0, vec4<f32>(size, 0.0, 0.0, size));
}

@compute @workgroup_size(64)
fn hatch_blobs(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= rib.n_hblobs) {
    return;
  }
  let h = hatch_of(i, 2u);
  let F = hatch_frame(h);
  let o = 2u * (pen_table[F.tile * 8u + 4u] + i - hatches[h].blob_first);
  let b0 = pen_blobs[o];
  let b1 = pen_blobs[o + 1u];
  let p = hatch_tf(F, b0.xy);
  let t = pool[u32(b1.z) % KNOT_POOL];
  let lim = 3.0 / F.sc;
  let sx = max((2.0 * b0.z) * 0.85, lim);
  let sy = max((2.0 * b0.w) * 0.85, lim);
  let c = b1.x;
  let s = b1.y;
  let m = F.m;
  let r0 = m.x * c + m.z * s;
  let r1 = m.y * c + m.w * s;
  let r2 = m.z * c - m.x * s;
  let r3 = m.w * c - m.y * s;
  hblobs[i] = Instance(p, t, 1.0, vec4<f32>(r0 * sx, r1 * sx, r2 * sy, r3 * sy));
}
