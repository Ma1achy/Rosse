// THROWAWAY SPIKE: vector pen lines on WebGPU — ribbons (A/A2/A3) vs distance-field textures (B/B3).
// Not production code. See RESULTS.md.

const ATLASES = ['whole', 'arms', 'rings', 'bars', 'env', 'arcs', 'shells', 'companions', 'trails', 'penlines', 'sstars', 'misc'];
const SIZES = [48, 220, 1100];
const INK = [0.114, 0.106, 0.098], INK_HEX = '#1d1b19', PAPER = [0xef, 0xe9, 0xdc];
const PEN = 2.4, W = PEN / 2;            // half-width in plate px, constant whatever the drawing's size
const DK = 0.6;                          // rewind warp strength
const SDF_MAXD = 0.04;                   // distances are clamped here (tile units); covers w+0.5 px down to ~42 px sizes
const TIME_TARGET = 1600;                // timing plate (an 800 plate at zoom 2)
const TIME_NS = [1, 1000, 6000];
const MAX_FRAMES = 60, MIN_FRAMES = 5, MAX_MS_PER_CASE = 4000;

const $ = s => document.querySelector(s);
const logEl = $('#log');
function log(...a) { console.log(...a); logEl.textContent += a.join(' ') + '\n'; }
const R = { adapter: {}, drawing: {}, bake: {}, memory: {}, fidelity: {}, timing: [], notes: [] };
window.__SPIKE_RESULTS = R;

/* ---------------- geometry ---------------- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function warpF(x, y, s = 1) { const r = Math.hypot(x, y); if (r < 0.015) return [x, y]; const th = Math.atan2(y, x) + s * DK * Math.log(r / 0.08); return [r * Math.cos(th), r * Math.sin(th)]; }
function polysOf(v) { return v.l.map(fl => { const p = []; for (let i = 0; i < fl.length; i += 2) p.push([fl[i], fl[i + 1]]); return p; }); }
function densify(poly, step) {
  const out = [poly[0]];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let s = 1; s <= n; s++) out.push([a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n]);
  }
  return out;
}
function segsOf(polys) { const a = []; for (const p of polys) for (let i = 1; i < p.length; i++) a.push(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]); return new Float32Array(a); }
function lengthOf(polys) { let L = 0; for (const p of polys) for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; }
const dotRadius = (r, S) => Math.min(2.2, Math.max(1.3, r * S * 0.5));   // simplification of the dots-atlas sprites

/* ---------------- CPU SDF bake: unsigned distance to centrelines, per-segment rasterised ---------------- */
function bakeSDF(segs, N, maxD) {
  const d2 = new Float32Array(N * N).fill(maxD * maxD), m = Math.ceil(maxD * N) + 1;
  for (let k = 0; k < segs.length; k += 4) {
    const ax = segs[k], ay = segs[k + 1], bx = segs[k + 2], by = segs[k + 3], dx = bx - ax, dy = by - ay, ll = dx * dx + dy * dy || 1e-12;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) + 0.5) * N) - m), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + 0.5) * N) + m);
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) + 0.5) * N) - m), j1 = Math.min(N - 1, Math.ceil((Math.max(ay, by) + 0.5) * N) + m);
    for (let j = j0; j <= j1; j++) {
      const py = (j + 0.5) / N - 0.5;
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) / N - 0.5;
        let h = ((px - ax) * dx + (py - ay) * dy) / ll; h = h < 0 ? 0 : h > 1 ? 1 : h;
        const ex = px - ax - dx * h, ey = py - ay - dy * h, e = ex * ex + ey * ey, o = j * N + i;
        if (e < d2[o]) d2[o] = e;
      }
    }
  }
  const half = new Uint16Array(N * N);
  for (let o = 0; o < N * N; o++) half[o] = toHalf(Math.sqrt(d2[o]));
  return half;
}
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function toHalf(v) {
  _f[0] = v; const x = _u[0], sign = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return sign; m = (m | 0x800000) >> (1 - e); return sign | ((m + 0x1000) >> 13); }
  if (e >= 31) return sign | 0x7c00;
  return sign | ((e << 10) + ((m + 0x1000) >> 13));
}

/* ---------------- WGSL ---------------- */
const WGSL = /* wgsl */`
const MAXD = ${SDF_MAXD};
struct U { res: vec2f, w: f32, dk: f32, ink: vec4f };
struct Inst { m: vec4f, t: vec2f, alpha: f32, scale: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> segs: array<vec4f>;
@group(0) @binding(2) var<storage, read> inst: array<Inst>;
@group(0) @binding(3) var sdf: texture_2d<f32>;
@group(0) @binding(4) var smp: sampler;
@group(0) @binding(5) var<storage, read> dots: array<vec4f>;

fn toPx(p: vec2f, I: Inst) -> vec2f { return vec2f(I.m.x * p.x + I.m.z * p.y, I.m.y * p.x + I.m.w * p.y) + I.t; }
fn toClip(p: vec2f) -> vec4f { let d = p / u.res * 2.0 - 1.0; return vec4f(d.x, -d.y, 0.0, 1.0); }
fn rewind(p: vec2f, s: f32) -> vec2f {
  let r = length(p);
  if (r < 0.015) { return p; }
  let th = atan2(p.y, p.x) + s * u.dk * log(r / 0.08);
  return r * vec2f(cos(th), sin(th));
}
const CORN = array<vec2f, 6>(vec2f(0., -1.), vec2f(0., 1.), vec2f(1., -1.), vec2f(0., 1.), vec2f(1., 1.), vec2f(1., -1.));
fn ink(a: f32) -> vec4f { return vec4f(u.ink.rgb * a, a); }

/* ---- A / A2 / A3: ribbons, vertex-pulled, expanded in plate px after the transform ---- */
struct RO { @builtin(position) pos: vec4f, @location(0) p: vec2f, @location(1) @interpolate(flat) ab: vec4f, @location(2) @interpolate(flat) alpha: f32 };
fn ribbon(pa: vec2f, pb: vec2f, vi: u32, I: Inst, along: f32, side: f32) -> RO {
  let d = pb - pa; let L = length(d);
  var t = vec2f(1.0, 0.0);
  if (L > 1e-5) { t = d / L; }
  let n = vec2f(-t.y, t.x); let c = CORN[vi % 6u];
  let p = select(pa - t * along, pb + t * along, c.x > 0.5) + n * (c.y * side);
  var o: RO; o.pos = toClip(p); o.p = p; o.ab = vec4f(pa, pb); o.alpha = I.alpha; return o;
}
@vertex fn vsA(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> RO {
  let s = segs[vi / 6u]; let I = inst[ii];
  return ribbon(toPx(s.xy, I), toPx(s.zw, I), vi, I, 0.9 * u.w, u.w);           // reference: 0.9w overlap, no caps
}
@vertex fn vsA2(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> RO {
  let s = segs[vi / 6u]; let I = inst[ii];
  return ribbon(toPx(s.xy, I), toPx(s.zw, I), vi, I, u.w + 1.0, u.w + 1.0);     // padded for the capsule
}
@vertex fn vsA3(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> RO {
  let s = segs[vi / 6u]; let I = inst[ii];
  return ribbon(toPx(rewind(s.xy, 1.0), I), toPx(rewind(s.zw, 1.0), I), vi, I, 0.9 * u.w, u.w);
}
@fragment fn fsA(i: RO) -> @location(0) vec4f { return ink(i.alpha); }
@fragment fn fsA2(i: RO) -> @location(0) vec4f {
  let pa = i.ab.xy; let ba = i.ab.zw - pa; let pq = i.p - pa;
  let h = clamp(dot(pq, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return ink(clamp(u.w + 0.5 - length(pq - ba * h), 0.0, 1.0) * i.alpha);
}

/* ---- dots (same for every method): filled circles, constant-ish px radius ---- */
struct DO { @builtin(position) pos: vec4f, @location(0) p: vec2f, @location(1) @interpolate(flat) c: vec3f, @location(2) @interpolate(flat) alpha: f32 };
fn dotV(vi: u32, ii: u32, warp: f32) -> DO {
  let d = dots[vi / 6u]; let I = inst[ii];
  var q = d.xy;
  if (warp > 0.5) { q = rewind(q, 1.0); }
  let c = toPx(q, I); let r = clamp(d.z * I.scale * 0.5, 1.3, 2.2);
  let k = CORN[vi % 6u];
  let p = c + vec2f(k.x * 2.0 - 1.0, k.y) * (r + 1.0);
  var o: DO; o.pos = toClip(p); o.p = p; o.c = vec3f(c, r); o.alpha = I.alpha; return o;
}
@vertex fn vsDot(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DO { return dotV(vi, ii, 0.0); }
@vertex fn vsDotW(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DO { return dotV(vi, ii, 1.0); }
@fragment fn fsDot(i: DO) -> @location(0) vec4f { return ink(clamp(i.c.z + 0.5 - length(i.p - i.c.xy), 0.0, 1.0) * i.alpha); }

/* ---- B: unsigned distance field, one quad per instance ---- */
struct SO { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) @interpolate(flat) scale: f32, @location(2) @interpolate(flat) alpha: f32 };
fn sdfQuad(vi: u32, ii: u32, ext: f32) -> SO {
  let I = inst[ii]; let c = CORN[vi % 6u];
  let q = vec2f(c.x * 2.0 - 1.0, c.y) * ext;
  var o: SO; o.pos = toClip(toPx(q, I)); o.q = q; o.scale = I.scale; o.alpha = I.alpha; return o;
}
@vertex fn vsB(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SO { return sdfQuad(vi, ii, 0.5); }
@vertex fn vsB3(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SO { return sdfQuad(vi, ii, 0.55); }
@fragment fn fsB(i: SO) -> @location(0) vec4f {
  let d = textureSampleLevel(sdf, smp, i.q + 0.5, 0.0).r;                       // tile units
  return ink(clamp(u.w + 0.5 - d * i.scale, 0.0, 1.0) * i.alpha * step(d, MAXD * 0.999)); // d_px = d_tile * size; beyond the clamp = no ink
}
/* B3: the SDF under the rewind warp, possible only because this warp has an analytic inverse.
   The tile-space distance is converted to plate px through the local screen->tile Jacobian along the field's gradient. */
@fragment fn fsB3(i: SO) -> @location(0) vec4f {
  let p = rewind(i.q, -1.0);                                                     // inverse warp
  let jx = dpdx(p); let jy = dpdy(p);
  let uv = p + 0.5; let h = 1.0 / f32(textureDimensions(sdf).x);
  let d = textureSampleLevel(sdf, smp, uv, 0.0).r;
  let g = vec2f(textureSampleLevel(sdf, smp, uv + vec2f(h, 0.0), 0.0).r - textureSampleLevel(sdf, smp, uv - vec2f(h, 0.0), 0.0).r,
                textureSampleLevel(sdf, smp, uv + vec2f(0.0, h), 0.0).r - textureSampleLevel(sdf, smp, uv - vec2f(0.0, h), 0.0).r);
  var n = vec2f(0.7071, 0.7071);
  if (dot(g, g) > 1e-14) { n = normalize(g); }
  let rate = max(length(vec2f(dot(jx, n), dot(jy, n))), 1e-6);                  // tile units per plate px across the line
  return ink(clamp(u.w + 0.5 - d / rate, 0.0, 1.0) * i.alpha * step(d, MAXD * 0.999));
}
`;

/* ---------------- main ---------------- */
async function main() {
  const all = {};
  await Promise.all(ATLASES.map(async n => { all[n] = await (await fetch(`../../assets/drawings/vector/${n}.json`)).json(); }));
  const V = all.whole.vec[0];
  const polys = polysOf(V), segs = segsOf(polys);
  const dpolys = polys.map(p => densify(p, 0.012)), dsegs = segsOf(dpolys);
  const wpolys = dpolys.map(p => p.map(q => warpF(q[0], q[1])));
  const Ltile = lengthOf(polys), LtileW = lengthOf(wpolys);
  const dotsArr = new Float32Array(V.d.flatMap(d => [d[0], d[1], d[2], 0]));
  R.drawing = { src: all.whole.src[0], type: all.whole.type[0], polylines: polys.length, segments: segs.length / 4, dots: V.d.length, blobs: V.b.length,
    densifiedSegments: dsegs.length / 4, centrelineLengthTile: +Ltile.toFixed(4), warpedCentrelineLengthTile: +LtileW.toFixed(4) };
  log('drawing', JSON.stringify(R.drawing));

  // library totals
  const lib = { drawings: 0, segments: 0, points: 0, dots: 0, blobs: 0, perAtlas: {} };
  for (const n of ATLASES) {
    let s = 0, p = 0, d = 0, b = 0;
    for (const v of all[n].vec) { for (const l of v.l) { p += l.length / 2; s += l.length / 2 - 1; } d += v.d.length; b += (v.b || []).length; }
    lib.perAtlas[n] = { drawings: all[n].vec.length, segments: s, dots: d };
    lib.drawings += all[n].vec.length; lib.segments += s; lib.points += p; lib.dots += d; lib.blobs += b;
  }

  if (!navigator.gpu) throw new Error('navigator.gpu missing (serve over http://localhost, use a WebGPU browser)');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  const ai = adapter.info || {};
  const hasTS = adapter.features.has('timestamp-query');
  R.adapter = { vendor: ai.vendor, architecture: ai.architecture, device: ai.device, description: ai.description, timestampQuery: hasTS,
    float32Filterable: adapter.features.has('float32-filterable'), userAgent: navigator.userAgent };
  log('adapter', JSON.stringify(R.adapter));
  const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
  device.addEventListener('uncapturederror', e => { log('GPU ERROR', e.error.message); R.notes.push('GPU error: ' + e.error.message); });

  const buf = (data, usage) => { const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
  const segBuf = buf(segs, GPUBufferUsage.STORAGE), dsegBuf = buf(dsegs, GPUBufferUsage.STORAGE), dotBuf = buf(dotsArr, GPUBufferUsage.STORAGE);
  const ubuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const setU = (res) => device.queue.writeBuffer(ubuf, 0, new Float32Array([res, res, W, DK, INK[0], INK[1], INK[2], 1]));

  // SDF bakes
  const sdf = {};
  for (const N of [512, 2048]) {
    const t0 = performance.now(); const half = bakeSDF(segs, N, SDF_MAXD); const ms = performance.now() - t0;
    const tex = device.createTexture({ size: [N, N], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: tex }, half, { bytesPerRow: N * 2 }, [N, N]);
    sdf[N] = tex; R.bake[N] = { ms: +ms.toFixed(1), bytes: N * N * 2 };
    log(`baked SDF ${N}² in ${ms.toFixed(0)} ms`);
  }
  const smp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

  const module = device.createShaderModule({ code: WGSL });
  const ci = await module.getCompilationInfo(); for (const m of ci.messages) log('WGSL', m.type, m.lineNum, m.message);
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const blendMax = { color: { operation: 'max', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'max', srcFactor: 'one', dstFactor: 'one' } };
  const pipes = {};
  const pipe = (vs, fs, samples, bl = 'over') => {
    const k = vs + fs + samples + bl;
    return pipes[k] ||= device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: vs },
      fragment: { module, entryPoint: fs, targets: [{ format: 'rgba8unorm', blend: bl === 'max' ? blendMax : blend }] }, primitive: { topology: 'triangle-list' }, multisample: { count: samples } });
  };

  // methods: lines pipeline + bindings, plus the dot pass
  const M = {
    A:     { label: 'A ribbons (0.9w overlap, 4× MSAA)', vs: 'vsA', fs: 'fsA', msaa: 4, kind: 'rib', seg: segBuf, nSeg: segs.length / 4 },
    A2:    { label: 'A2 ribbons + capsule SDF (no MSAA)', vs: 'vsA2', fs: 'fsA2', msaa: 1, kind: 'rib', seg: segBuf, nSeg: segs.length / 4 },
    A2m:   { label: 'A2m capsule ribbons, max blend (ink layer)', vs: 'vsA2', fs: 'fsA2', msaa: 1, kind: 'rib', seg: segBuf, nSeg: segs.length / 4, blend: 'max' },
    B512:  { label: 'B SDF 512² r16float', vs: 'vsB', fs: 'fsB', msaa: 1, kind: 'sdf', tex: sdf[512] },
    B2048: { label: 'B SDF 2048² r16float', vs: 'vsB', fs: 'fsB', msaa: 1, kind: 'sdf', tex: sdf[2048] },
    A3:    { label: 'A3 ribbons + rewind warp (4× MSAA)', vs: 'vsA3', fs: 'fsA', msaa: 4, kind: 'rib', seg: dsegBuf, nSeg: dsegs.length / 4, warp: true },
    B3:    { label: 'B3 SDF 2048² + inverse rewind warp', vs: 'vsB3', fs: 'fsB3', msaa: 1, kind: 'sdf', tex: sdf[2048], warp: true },
  };
  const bgCache = new Map();
  function bindGroup(p, entries, key) {
    if (bgCache.has(key)) return bgCache.get(key);
    const g = device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: entries.map(([binding, resource]) => ({ binding, resource })) });
    bgCache.set(key, g); return g;
  }
  function encodeMethod(pass, mk, instBuf, n, withDots) {
    const m = M[mk], p = pipe(m.vs, m.fs, m.msaa, m.blend);
    pass.setPipeline(p);
    if (m.kind === 'rib') {
      pass.setBindGroup(0, bindGroup(p, [[0, { buffer: ubuf }], [1, { buffer: m.seg }], [2, { buffer: instBuf }]], mk + instBuf.label));
      pass.draw(m.nSeg * 6, n);
    } else {
      pass.setBindGroup(0, bindGroup(p, [[0, { buffer: ubuf }], [2, { buffer: instBuf }], [3, m.tex.createView()], [4, smp]], mk + instBuf.label));
      pass.draw(6, n);
    }
    if (withDots && V.d.length) {
      const dp = pipe(m.warp ? 'vsDotW' : 'vsDot', 'fsDot', m.msaa, m.blend);
      pass.setPipeline(dp);
      pass.setBindGroup(0, bindGroup(dp, [[0, { buffer: ubuf }], [2, { buffer: instBuf }], [5, { buffer: dotBuf }]], 'dot' + m.warp + m.msaa + m.blend + instBuf.label));
      pass.draw(V.d.length * 6, n);
    }
  }
  const targets = {};
  function target(C, msaa) {
    const k = C + 'x' + msaa; if (targets[k]) return targets[k];
    const tex = device.createTexture({ size: [C, C], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const ms = msaa > 1 ? device.createTexture({ size: [C, C], format: 'rgba8unorm', sampleCount: msaa, usage: GPUTextureUsage.RENDER_ATTACHMENT }) : null;
    return targets[k] = { tex, view: tex.createView(), msView: ms && ms.createView(), C };
  }
  function passDesc(t, clear, ts) {
    const d = { colorAttachments: [{ view: t.msView || t.view, resolveTarget: t.msView ? t.view : undefined, clearValue: clear, loadOp: 'clear', storeOp: t.msView ? 'discard' : 'store' }] };
    if (ts) d.timestampWrites = ts;
    return d;
  }
  function instances(list, label) {   // list of {x,y,S,rot}
    const a = new Float32Array(list.length * 8);
    list.forEach((o, i) => { const c = Math.cos(o.rot || 0) * o.S, s = Math.sin(o.rot || 0) * o.S; a.set([c, s, -s, c, o.x, o.y, 1, o.S], i * 8); });
    const b = device.createBuffer({ label, size: a.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, a); return b;
  }
  const oneBufs = {};
  async function renderAlpha(mk, S, C, withDots) {
    const t = target(C, M[mk].msaa), ib = (oneBufs[S] ||= instances([{ x: C / 2, y: C / 2, S }], `one-${S}-${C}`));
    setU(C);
    const enc = device.createCommandEncoder(), pass = enc.beginRenderPass(passDesc(t, { r: 0, g: 0, b: 0, a: 0 }));
    encodeMethod(pass, mk, ib, 1, withDots); pass.end();
    const bpr = Math.ceil(C * 4 / 256) * 256, rb = device.createBuffer({ size: bpr * C, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyTextureToBuffer({ texture: t.tex }, { buffer: rb, bytesPerRow: bpr }, [C, C]);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(rb.getMappedRange()), a = new Float32Array(C * C);
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) a[y * C + x] = src[y * bpr + x * 4 + 3] / 255;
    rb.unmap(); rb.destroy();
    return a;
  }
  function refAlpha(S, C, withDots, warp, cap = 'butt') {
    const cv = document.createElement('canvas'); cv.width = cv.height = C;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.strokeStyle = ctx.fillStyle = INK_HEX; ctx.lineWidth = PEN; ctx.lineCap = cap; ctx.lineJoin = 'round';
    const P = q => [C / 2 + q[0] * S, C / 2 + q[1] * S];
    for (const poly of (warp ? wpolys : polys)) { ctx.beginPath(); poly.forEach((q, i) => { const p = P(q); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.stroke(); }
    if (withDots) for (const d of V.d) { const p = P(warp ? warpF(d[0], d[1]) : d); ctx.beginPath(); ctx.arc(p[0], p[1], dotRadius(d[2], S), 0, Math.PI * 2); ctx.fill(); }
    const id = ctx.getImageData(0, 0, C, C).data, a = new Float32Array(C * C);
    for (let i = 0; i < C * C; i++) a[i] = id[i * 4 + 3] / 255;
    return a;
  }
  function compare(a, r, L) {
    let sa = 0, sr = 0, inter = 0, uni = 0, smin = 0, smax = 0, mad = 0, n = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = r[i]; sa += x; sr += y;
      const bx = x >= 0.5, by = y >= 0.5; if (bx && by) inter++; if (bx || by) uni++;
      smin += Math.min(x, y); smax += Math.max(x, y);
      if (x > 1 / 255 || y > 1 / 255) { mad += Math.abs(x - y); n++; }
    }
    return { meanWidthPx: +(sa / L).toFixed(3), refWidthPx: +(sr / L).toFixed(3), inkRatio: +(sa / sr).toFixed(3), iou50: +(inter / uni).toFixed(3), softIoU: +(smin / smax).toFixed(3), madInk: +(mad / n).toFixed(3) };
  }
  function toImage(a, C) {
    const id = new ImageData(C, C);
    for (let i = 0; i < C * C; i++) { const k = a[i]; for (let c = 0; c < 3; c++) id.data[i * 4 + c] = Math.round(PAPER[c] * (1 - k) + INK[c] * 255 * k); id.data[i * 4 + 3] = 255; }
    const cv = document.createElement('canvas'); cv.width = cv.height = C; cv.getContext('2d').putImageData(id, 0, 0); return cv;
  }

  /* ---------- fidelity + images per size ---------- */
  const PANELS = [['R', 'R Canvas2D reference (round joins, butt caps)'], ['A'], ['A2'], ['A2m'], ['B512'], ['B2048'], ['R3', 'R3 Canvas2D reference, rewind-warped'], ['A3'], ['B3']];
  for (const S of SIZES) {
    const C = Math.round(S * 0.9) + 10, L = Ltile * S, LW = LtileW * S;
    const imgs = {}, fid = {};
    const rL = refAlpha(S, C, false, false), rLW = refAlpha(S, C, false, true), rLr = refAlpha(S, C, false, false, 'round'), rLWr = refAlpha(S, C, false, true, 'round');
    imgs.R = toImage(refAlpha(S, C, true, false), C); imgs.R3 = toImage(refAlpha(S, C, true, true), C);
    fid.R = compare(rL, rL, L); fid.R3 = compare(rLW, rLW, LW);
    for (const mk of Object.keys(M)) {
      const lines = await renderAlpha(mk, S, C, false);
      fid[mk] = M[mk].warp ? compare(lines, rLW, LW) : compare(lines, rL, L);
      const rr = M[mk].warp ? compare(lines, rLWr, LW) : compare(lines, rLr, L);
      fid[mk].vsRoundCaps = { refWidthPx: rr.refWidthPx, inkRatio: rr.inkRatio, iou50: rr.iou50, softIoU: rr.softIoU, madInk: rr.madInk };
      imgs[mk] = toImage(await renderAlpha(mk, S, C, true), C);
    }
    R.fidelity[S] = fid;
    log(`size ${S}`, JSON.stringify(fid));
    const mag = S === 48 ? 6 : S === 220 ? 2 : 1;
    composite(`comp-${S}`, `Drawing at ${S} px (canvas ${C}², shown ×${mag})`, PANELS, imgs, fid, C, mag, null);
    if (S === 1100) composite('comp-1100-detail', 'Drawing at 1100 px: detail crop, ×3', PANELS, imgs, fid, C, 3, [Math.round(C * 0.30), Math.round(C * 0.36), 210]);
    if (S === 48) composite('comp-48-native', 'Drawing at 48 px, ×1 (as seen)', PANELS, imgs, fid, C, 1, null);
  }
  function composite(id, title, panels, imgs, fid, C, mag, crop) {
    const cols = panels.length > 8 ? 5 : 4, rows = Math.ceil(panels.length / cols), src = crop ? crop[2] : C, cell = src * mag, lab = 44, pad = 8;
    const cv = document.createElement('canvas'); cv.id = id; cv.className = 'comp';
    cv.width = cols * (cell + pad) + pad; cv.height = 30 + rows * (cell + lab + pad) + pad;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#000'; g.font = '16px sans-serif'; g.fillText(title, pad, 20);
    panels.forEach(([k, lbl], i) => {
      const x = pad + (i % cols) * (cell + pad), y = 30 + Math.floor(i / cols) * (cell + lab + pad);
      g.fillStyle = '#000'; g.font = '13px sans-serif'; g.fillText(lbl || M[k].label, x, y + 15);
      const f = fid[k]; g.font = '12px monospace'; g.fillStyle = '#444';
      g.fillText(k.startsWith('R') ? `width ${f.meanWidthPx}px (ground truth)` : `w ${f.meanWidthPx}px IoU ${f.iou50}/${f.vsRoundCaps.iou50} MAD ${f.madInk}`, x, y + 33);
      g.imageSmoothingEnabled = false;
      if (crop) g.drawImage(imgs[k], crop[0], crop[1], src, src, x, y + lab, cell, cell); else g.drawImage(imgs[k], x, y + lab, cell, cell);
    });
    const wrap = document.createElement('div'); wrap.className = 'compwrap'; wrap.appendChild(cv); $('#comps').appendChild(wrap);
  }

  /* ---------- memory ---------- */
  const segB = segs.byteLength, ptB = V.l.reduce((a, l) => a + l.length * 4, 0);
  R.memory = {
    perDrawing: { segmentsVec4f32: segB, polylinePointsF32: ptB, densifiedSegmentsVec4f32: dsegs.byteLength, dotsVec4f32: dotsArr.byteLength,
      sdf512_r16f: 512 * 512 * 2, sdf2048_r16f: 2048 * 2048 * 2, sdf512_withMips: Math.round(512 * 512 * 2 * 4 / 3), sdf2048_withMips: Math.round(2048 * 2048 * 2 * 4 / 3) },
    library: { drawings: lib.drawings, segments: lib.segments, points: lib.points, dots: lib.dots, blobs: lib.blobs,
      segmentsVec4f32: lib.segments * 16, polylinePointsF32: lib.points * 8,
      sdf512_r16f: lib.drawings * 512 * 512 * 2, sdf2048_r16f: lib.drawings * 2048 * 2048 * 2, perAtlas: lib.perAtlas },
    renderTargets: { plate1600_rgba8: TIME_TARGET ** 2 * 4, plate1600_msaa4_rgba8: TIME_TARGET ** 2 * 4 * 4 },
  };
  log('memory', JSON.stringify(R.memory));

  /* ---------- timing ---------- */
  setU(TIME_TARGET);
  const rnd = mulberry32(7);
  const one = instances([{ x: TIME_TARGET / 2, y: TIME_TARGET / 2, S: 1100 }], 'time-one');
  const field = instances(Array.from({ length: 6000 }, () => ({ x: rnd() * TIME_TARGET, y: rnd() * TIME_TARGET, S: 48, rot: rnd() * Math.PI * 2 })), 'time-field');
  let qs, qres, qread;
  if (hasTS) {
    qs = device.createQuerySet({ type: 'timestamp', count: 2 });
    qres = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    qread = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }
  for (const n of TIME_NS) {
    for (const mk of Object.keys(M)) {
      const t = target(TIME_TARGET, M[mk].msaa), ib = n === 1 ? one : field;
      const frame = async (useTS) => {
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass(passDesc(t, { r: 0.937, g: 0.914, b: 0.863, a: 1 }, useTS ? { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : null));
        encodeMethod(pass, mk, ib, n, false); pass.end();
        if (useTS) { enc.resolveQuerySet(qs, 0, 2, qres, 0); enc.copyBufferToBuffer(qres, 0, qread, 0, 16); }
        const t0 = performance.now(); device.queue.submit([enc.finish()]); await device.queue.onSubmittedWorkDone(); const dt = performance.now() - t0;
        let gpu = null;
        if (useTS) { await qread.mapAsync(GPUMapMode.READ); const q = new BigUint64Array(qread.getMappedRange()); gpu = Number(q[1] - q[0]) / 1e6; qread.unmap(); }
        return { dt, gpu };
      };
      await frame(false); await frame(false);
      const dts = [], gpus = [], start = performance.now();
      while (dts.length < MAX_FRAMES && (dts.length < MIN_FRAMES || performance.now() - start < MAX_MS_PER_CASE)) {
        const r = await frame(hasTS); dts.push(r.dt); if (r.gpu != null && r.gpu > 0) gpus.push(r.gpu);
      }
      const mean = a => a.reduce((x, y) => x + y, 0) / a.length, med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
      const row = { method: mk, n, size: n === 1 ? 1100 : 48, frames: dts.length, meanMs: +mean(dts).toFixed(2), medianMs: +med(dts).toFixed(2),
        gpuMeanMs: gpus.length ? +mean(gpus).toFixed(3) : null,
        vertices: M[mk].kind === 'rib' ? M[mk].nSeg * 6 * n : 6 * n };
      R.timing.push(row); log('timing', JSON.stringify(row));
    }
  }
  renderTables();
}

function renderTables() {
  const t = (head, rows) => `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c ?? '–'}</td>`).join('')}</tr>`).join('')}</table>`;
  let h = `<h2>Adapter</h2><pre>${JSON.stringify(R.adapter, null, 1)}</pre>`;
  h += '<h2>Timing (ms per frame, 1600² plate)</h2>' + t(['method', 'N', 'size px', 'frames', 'mean wall ms', 'median wall ms', 'GPU ms (timestamp)', 'vertices'],
    R.timing.map(r => [r.method, r.n, r.size, r.frames, r.meanMs, r.medianMs, r.gpuMeanMs, r.vertices]));
  h += '<h2>Fidelity vs Canvas2D reference (lines only; butt caps / round caps)</h2>';
  for (const S of SIZES) h += `<h3>${S} px</h3>` + t(['method', 'mean width px', 'ref width px (butt/round)', 'ink ratio', 'IoU@0.5', 'soft IoU', 'MAD (ink px)'],
    Object.entries(R.fidelity[S]).map(([k, f]) => { const r = f.vsRoundCaps; const b = (x, y) => r ? `${x} / ${y}` : x; return [k, f.meanWidthPx, b(f.refWidthPx, r && r.refWidthPx), b(f.inkRatio, r && r.inkRatio), b(f.iou50, r && r.iou50), b(f.softIoU, r && r.softIoU), b(f.madInk, r && r.madInk)]; }));
  h += `<h2>Memory</h2><pre>${JSON.stringify(R.memory, null, 1)}</pre><h2>SDF bake</h2><pre>${JSON.stringify(R.bake)}</pre>`;
  $('#tables').innerHTML = h;
}

main().then(() => { log('done'); window.__SPIKE_DONE = true; })
  .catch(e => { log('FAILED', e.stack || e); window.__SPIKE_ERROR = String(e.stack || e); window.__SPIKE_DONE = true; });
