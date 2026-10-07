/**
 * Pen ink per unit length against v21 (ADR 0006; M4 QA, docs/milestones/m5/README.md).
 *
 * The same vector drawings, at the sizes and pen scales the parts and the hatching use, drawn two
 * ways from the same segments (plate px):
 * - the engine's: capsules of half width PEN.line/2 · ps, analytic coverage clamp(w + 0.5 − d, 0, 1),
 *   over-blended (render/ribbon.wgsl, WebGPU);
 * - v21's: its own quads (expandVector, app23.js:L1209–1212: each segment extended 0.9w at both
 *   ends, 6 vertices, alpha 1, the `solid` texture under the smoothstep edge, which is 1), drawn
 *   with WebGL2 on a canvas with `antialias: true` (4× MSAA), premultiplied, blended
 *   ONE / ONE_MINUS_SRC_ALPHA, exactly as v21's page draws them, on the same SwiftShader.
 *
 * The measure is Σα / Σ segment length (px of ink per px of centreline), and the engine's ink per
 * length against v21's, gated at every pen scale the parts and the hatching use (ps 1, 0.6, 0.42,
 * 0.38) within ±5%. The pen lines are v21's quads unioned per sample (ADR 0019): the same quads, the
 * same four samples per pixel, one coverage function per engine (`fs_pen_mask` and `fs_pen_resolve` in
 * render/ribbon.wgsl, `rasteriseCapsules` in src/fallback/raster.ts) shared by the hatching and
 * every placed drawing. Before ADR 0019 the capsules of ADR 0006 ran 9–16% heavy below one pixel of
 * pen.
 */
import { CAPSULE_WORDS } from '../../src/model/ribbons';
import { BuiltAssets } from '../../src/marks/atlas';
import type { VectorRecord } from '../../src/marks/vector';
import { GpuRenderer } from '../../src/render/frame';
import { adapterName, device, halfToFloat, readTexture, run } from './harness';

const PEN = 2.4;
const TOL = 0.05;

interface Config {
  name: string;
  sheet: string;
  tiles: number[];
  /** the drawing's size (plate px) and its flattening (the hatching's 0.28) */
  size: number;
  flat: number;
  ps: number;
  /** how many copies on a grid */
  copies: number;
}

const CONFIGS: Config[] = [
  {
    name: 'whole drawings, 554 px (a part)',
    sheet: 'whole',
    tiles: [0, 5, 17, 40],
    size: 554,
    flat: 1,
    ps: 1,
    copies: 1,
  },
  {
    name: 'drawn arms, 380 px',
    sheet: 'arms',
    tiles: [0, 6, 12, 20],
    size: 380,
    flat: 1,
    ps: 1,
    copies: 4,
  },
  {
    name: 'whole drawings, 160 px',
    sheet: 'whole',
    tiles: [0, 5, 17, 40],
    size: 160,
    flat: 1,
    ps: 1,
    copies: 9,
  },
  {
    name: 'bubbles, 30 px, ps 0.6',
    sheet: 'rings',
    tiles: [0, 3, 8, 20],
    size: 30,
    flat: 1,
    ps: 0.6,
    copies: 36,
  },
  {
    name: 'deep-field drawings, 60 px, ps 0.42',
    sheet: 'whole',
    tiles: [0, 5, 17, 40],
    size: 60,
    flat: 1,
    ps: 0.42,
    copies: 36,
  },
  {
    name: 'hatches, 15 × 4 px, ps 0.38',
    sheet: 'penlines',
    tiles: [0, 3, 7, 11, 19],
    size: 15,
    flat: 0.28,
    ps: 0.38,
    copies: 64,
  },
];

/** Segments (plate px) of one configuration: copies on a grid, turned. */
function segments(c: Config, recs: VectorRecord[]): number[] {
  const out: number[] = [];
  const n = Math.ceil(Math.sqrt(c.copies));
  const step = 800 / n;
  for (let k = 0; k < c.copies; k++) {
    const rec = recs[c.tiles[k % c.tiles.length] ?? 0];
    if (!rec) continue;
    const cx = step * ((k % n) + 0.5);
    const cy = step * (Math.floor(k / n) + 0.5);
    const t = 0.7 * k + 0.3;
    const cs = Math.cos(t);
    const sn = Math.sin(t);
    const m = [cs * c.size, sn * c.size, -sn * c.size * c.flat, cs * c.size * c.flat];
    const tf = (x: number, y: number) => [
      cx + (m[0] ?? 0) * x + (m[2] ?? 0) * y,
      cy + (m[1] ?? 0) * x + (m[3] ?? 0) * y,
    ];
    for (const fl of rec.l)
      for (let i = 2; i < fl.length; i += 2)
        out.push(...tf(fl[i - 2] ?? 0, fl[i - 1] ?? 0), ...tf(fl[i] ?? 0, fl[i + 1] ?? 0));
  }
  return out;
}

/** v21's quads (expandVector, L1209–1212) for the segments, as triangles. */
function v21Triangles(seg: number[], w: number): Float32Array {
  const v: number[] = [];
  for (let i = 0; i < seg.length; i += 4) {
    const [ax = 0, ay = 0, bx = 0, by = 0] = seg.slice(i, i + 4);
    const tx = bx - ax;
    const ty = by - ay;
    const tl = Math.hypot(tx, ty) || 1;
    const nx = (-ty / tl) * w;
    const ny = (tx / tl) * w;
    const ex = (tx / tl) * w * 0.9;
    const ey = (ty / tl) * w * 0.9;
    const q = [
      [ax - ex + nx, ay - ey + ny],
      [ax - ex - nx, ay - ey - ny],
      [bx + ex + nx, by + ey + ny],
      [bx + ex - nx, by + ey - ny],
    ];
    for (const t of [0, 1, 2, 1, 3, 2]) v.push(...(q[t] ?? [0, 0]));
  }
  return new Float32Array(v);
}

/** Σα of v21's rendering: WebGL2, 4× MSAA, premultiplied, ONE / ONE_MINUS_SRC_ALPHA. */
function v21Ink(gl: WebGL2RenderingContext, prog: WebGLProgram, tri: Float32Array): number {
  gl.viewport(0, 0, 800, 800);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, tri, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, tri.length / 2);
  const px = new Uint8Array(800 * 800 * 4);
  gl.readPixels(0, 0, 800, 800, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.deleteBuffer(buf);
  let s = 0;
  for (let i = 3; i < px.length; i += 4) s += (px[i] ?? 0) / 255;
  return s;
}

function webgl(): { gl: WebGL2RenderingContext; prog: WebGLProgram } {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 800;
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: true,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('no WebGL2');
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error('shader');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? '');
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(
    prog,
    sh(
      gl.VERTEX_SHADER,
      '#version 300 es\nlayout(location=0) in vec2 pos;void main(){vec2 d=pos/800.0*2.0-1.0;gl_Position=vec4(d.x,-d.y,0,1);}',
    ),
  );
  // v21's fragment shader with the solid texture: smoothstep(0.12, 0.55, 1) · 1 · 1 = 1
  gl.attachShader(
    prog,
    sh(
      gl.FRAGMENT_SHADER,
      '#version 300 es\nprecision mediump float;out vec4 o;void main(){float a=smoothstep(0.12,0.55,1.0);o=vec4(a,a,a,a);}',
    ),
  );
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
  return { gl, prog };
}

run("pen ink per length against v21's quads", async () => {
  const { adapter, device: dev } = await device();
  const assets = await BuiltAssets.load('/');
  const paper = await assets.paper();
  const r = new GpuRenderer(dev, { plateCss: 800, dpr: 1 }, paper);
  const { gl, prog } = webgl();
  const lines = [`adapter: ${adapterName(adapter)}`];
  let pass = true;
  const data: Record<string, unknown> = {};
  for (const c of CONFIGS) {
    const sheet = await assets.vector(c.sheet);
    const seg = segments(c, sheet.vec);
    const n = seg.length / 4;
    const w = (PEN / 2) * c.ps;
    let len = 0;
    for (let i = 0; i < seg.length; i += 4)
      len += Math.hypot((seg[i + 2] ?? 0) - (seg[i] ?? 0), (seg[i + 3] ?? 0) - (seg[i + 1] ?? 0));
    const caps = new Float32Array(Math.max(1, n) * CAPSULE_WORDS);
    for (let i = 0; i < n; i++)
      caps.set([...seg.slice(i * 4, i * 4 + 4), w, 1, 0, 0], i * CAPSULE_WORDS);
    const buf = dev.createBuffer({
      size: Math.max(256, caps.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(buf, 0, caps);
    r.setLayers([{ kind: 'gpu-capsules', buffer: buf, count: n, gain: 1 }]);
    r.drawInk();
    const half = new Uint16Array((await readTexture(dev, r.ink, 8)).buffer);
    let ours = 0;
    for (let i = 3; i < half.length; i += 4) ours += Math.min(1, halfToFloat(half[i] ?? 0));
    buf.destroy();
    const theirs = v21Ink(gl, prog, v21Triangles(seg, w));
    const ratio = ours / theirs;
    const ok = Math.abs(ratio - 1) <= TOL;
    if (!ok) pass = false;
    lines.push(
      `${ok ? 'ok  ' : 'FAIL'} ${c.name}: w ${w.toFixed(3)} px, ${String(n)} segments, ${(len / Math.max(1, n)).toFixed(2)} px each; ink per length ${(ours / len).toFixed(3)} against v21's ${(theirs / len).toFixed(3)} (2w = ${(2 * w).toFixed(3)}): ${((ratio - 1) * 100).toFixed(1)}% (±${String(TOL * 100)}%)`,
    );
    data[c.name] = { w, segments: n, length: len, ours, v21: theirs, ratio };
  }
  r.destroy();
  return { pass, lines, data };
});
