/**
 * Software rasteriser for the CPU engine (ADR 0011): bitmap quads into a premultiplied
 * Float32Array ink buffer, then the composite onto the surface into RGBA8. It is the twin of
 * src/shaders/render/sprite.wgsl and composite.wgsl, step for step and in f32 (`Math.fround`):
 *
 * - the same per-instance mip level (`spriteLod`) and the same per-pixel texture coordinate (pixel
 *   centre through the inverse instance matrix);
 * - the same sampling: trilinear between the two nearest levels, bilinear within a level, texel
 *   centres at (i + 0.5) / size, clamp-to-edge (repeat along u for strokes), as a WebGPU sampler
 *   with linear min, mag and mipmap filters;
 * - the same smoothstep ink edge, premultiplied output and ONE, ONE_MINUS_SRC_ALPHA blending;
 * - no MSAA, because the GPU path uses none (ADR 0007): a pixel is covered when its centre is
 *   inside the quad.
 *
 * Pure TypeScript with no DOM, so it runs in Node, in a worker and in the page.
 */
import type { AtlasData, ImageData8 } from '../marks/atlas';
import type { Instance } from '../marks/instance';
import { compositeInk, type Plates } from '../render/plates';
import {
  blendMultiply,
  blendSoftLight,
  holeAxis,
  texelPerPx,
  type Surface,
} from '../render/surface';

const f = Math.fround;

/** Premultiplied RGBA, f32, row-major, top row first: the CPU twin of the rgba16float ink target. */
export interface InkBuffer {
  width: number;
  height: number;
  data: Float32Array;
}

export function createInkBuffer(width: number, height: number): InkBuffer {
  return { width, height, data: new Float32Array(width * height * 4) };
}

export interface SpriteParams {
  /** device pixels per plate unit */
  pxPerUnit: number;
  gain: number;
  /** ink colour; (1, 1, 1) is the key ink */
  ink?: readonly [number, number, number];
  /** the plate's offset, plate units (the slipped plates) */
  off?: readonly [number, number];
}

type M2 = [number, number, number, number];

/** The inverse of a column-major 2 × 2, in f32 (sprite.wgsl `inverse2`). */
function inverse2(a: M2): M2 {
  const det = f(f(a[0] * a[3]) - f(a[2] * a[1]));
  return [f(a[3] / det), f(-a[1] / det), f(-a[2] / det), f(a[0] / det)];
}

const len2 = (x: number, y: number) => f(Math.sqrt(f(f(x * x) + f(y * y))));

/** The mip level of an instance (sprite.wgsl `sprite_lod`). */
export function spriteLod(
  m: readonly number[],
  pxPerUnit: number,
  cell: number,
  maxLod: number,
): number {
  const k = f(f(pxPerUnit) / f(cell));
  const b = inverse2([
    f(f(m[0] ?? 0) * k),
    f(f(m[1] ?? 0) * k),
    f(f(m[2] ?? 0) * k),
    f(f(m[3] ?? 0) * k),
  ]);
  const rho = Math.max(len2(b[0], b[1]), len2(b[2], b[3]));
  const lod = f(Math.log2(rho));
  return Number.isNaN(lod) ? 0 : Math.min(Math.max(lod, 0), maxLod);
}

const mix = (a: number, b: number, t: number) => f(f(a * f(1 - t)) + f(b * t));

/** Bilinear sample of one level of one layer, coordinates in [0, 1]. */
function sampleBilinear(atlas: AtlasData, level: number, layer: number, u: number, v: number) {
  const l = atlas.levels[level];
  if (!l) return 0;
  const { width: w, height: h, data } = l;
  const base = layer * w * h;
  const tx = f(f(u * w) - 0.5);
  const ty = f(f(v * h) - 0.5);
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const wx = f(tx - x0);
  const wy = f(ty - y0);
  const cx = (x: number) => (atlas.repeatU ? ((x % w) + w) % w : Math.min(Math.max(x, 0), w - 1));
  const cy = (y: number) => Math.min(Math.max(y, 0), h - 1);
  const at = (x: number, y: number) => f((data[base + cy(y) * w + cx(x)] ?? 0) / 255);
  return mix(mix(at(x0, y0), at(x0 + 1, y0), wx), mix(at(x0, y0 + 1), at(x0 + 1, y0 + 1), wx), wy);
}

/** Trilinear sample at an explicit level of detail (textureSampleLevel with a linear sampler). */
export function sampleLevel(atlas: AtlasData, layer: number, u: number, v: number, lod: number) {
  const maxLod = atlas.levels.length - 1;
  const l = Math.min(Math.max(lod, 0), maxLod);
  const l0 = Math.floor(l);
  const t = f(l - l0);
  const a = sampleBilinear(atlas, l0, layer, u, v);
  if (t === 0 || l0 >= maxLod) return a;
  return mix(a, sampleBilinear(atlas, l0 + 1, layer, u, v), t);
}

/** WGSL smoothstep. */
export function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(Math.max(f(f(x - lo) / f(hi - lo)), 0), 1);
  return f(f(t * t) * f(3 - f(2 * t)));
}

/** Draws instances of one atlas, in order, into the ink buffer. */
export function rasteriseSprites(
  target: InkBuffer,
  atlas: AtlasData,
  instances: readonly Instance[],
  params: SpriteParams,
): void {
  const top = atlas.levels[0];
  if (!top) return;
  const px = f(params.pxPerUnit);
  const ink = params.ink ?? [1, 1, 1];
  const offX = f(params.off?.[0] ?? 0);
  const offY = f(params.off?.[1] ?? 0);
  const [lo, hi] = atlas.edge;
  const { width: W, height: H, data } = target;
  const maxLod = atlas.levels.length - 1;
  for (const s of instances) {
    const m: M2 = [f(f(s.m[0]) * px), f(f(s.m[1]) * px), f(f(s.m[2]) * px), f(f(s.m[3]) * px)];
    const cx = f(f(f(s.x) + offX) * px);
    const cy = f(f(f(s.y) + offY) * px);
    // a degenerate quad (an empty slot of a dynamic set, src/model/dynvec.ts) covers nothing
    if (f(f(m[0] * m[3]) - f(m[2] * m[1])) === 0) continue;
    const inv = inverse2(m);
    const lod = spriteLod(s.m, px, top.width, maxLod);
    // bounding box of the quad, in pixels
    const ex = Math.abs(m[0]) * 0.5 + Math.abs(m[2]) * 0.5;
    const ey = Math.abs(m[1]) * 0.5 + Math.abs(m[3]) * 0.5;
    const x0 = Math.max(0, Math.floor(cx - ex - 1));
    const x1 = Math.min(W - 1, Math.ceil(cx + ex + 1));
    const y0 = Math.max(0, Math.floor(cy - ey - 1));
    const y1 = Math.min(H - 1, Math.ceil(cy + ey + 1));
    for (let y = y0; y <= y1; y++) {
      const dy = f(y + 0.5 - cy);
      for (let x = x0; x <= x1; x++) {
        const dx = f(x + 0.5 - cx);
        const u = f(f(f(inv[0] * dx) + f(inv[2] * dy)) + 0.5);
        const v = f(f(f(inv[1] * dx) + f(inv[3] * dy)) + 0.5);
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const t = sampleLevel(atlas, s.layer, u, v, lod);
        const a = f(f(smoothstep(lo, hi, t) * f(s.alpha)) * f(params.gain));
        if (a === 0) continue;
        const o = (y * W + x) * 4;
        const k = f(1 - a);
        data[o] = f(f(ink[0] * a) + f((data[o] ?? 0) * k));
        data[o + 1] = f(f(ink[1] * a) + f((data[o + 1] ?? 0) * k));
        data[o + 2] = f(f(ink[2] * a) + f((data[o + 2] ?? 0) * k));
        data[o + 3] = f(a + f((data[o + 3] ?? 0) * k));
      }
    }
  }
}

/** Composite parameters, as the GPU's Composite uniform. */
export interface CompositeParams {
  surface: Surface;
  paper: ImageData8;
  /** device pixels per CSS pixel */
  dpr: number;
  /** plate size in CSS pixels */
  plateCss: number;
  /** the plates the ink was printed with: the coloured plates' target holds the colours (default `ink`) */
  plates?: Plates;
}

/**
 * The ink buffer over the surface, into RGBA8 (composite.wgsl `fs`, then unorm8 rounding):
 * background blend, inset shadows (the last listed first), then the ink.
 */
export function composite(ink: InkBuffer, p: CompositeParams, out: Uint8ClampedArray): void {
  const { width: W, height: H, data } = ink;
  const { width: pw, height: ph, data: pd } = p.paper;
  const k = texelPerPx(pw, p.dpr);
  const field = p.surface.field.map(f);
  const key = compositeInk(p.plates ?? 'ink', p.surface.palette).map(f);
  const blend = p.surface.blend === 'multiply' ? blendMultiply : blendSoftLight;
  const wrap = (i: number, n: number) => ((i % n) + n) % n;
  const tex = (x: number, y: number, c: number) => f((pd[(y * pw + x) * 4 + c] ?? 0) / 255);
  // the paper repeats along rows and columns: precompute the taps for each
  const taps = (n: number, size: number) =>
    Array.from({ length: n }, (_, i) => {
      const t = f(f(f(i + 0.5) * k) - 0.5);
      const t0 = Math.floor(t);
      const i0 = wrap(t0, size);
      return { i0, i1: wrap(i0 + 1, size), w: f(t - t0) };
    });
  const tx = taps(W, pw);
  const ty = taps(H, ph);
  // shadows, bottom first; each hole is separable, so precompute it per column and per row
  const dpr = f(p.dpr);
  const size = f(p.plateCss);
  const shadows = [...p.surface.shadows].reverse().map((sh) => {
    const sigma = f(sh.blur / 2);
    const spread = f(sh.spread);
    const axis = (n: number) =>
      Float32Array.from({ length: n }, (_, i) => holeAxis(i, dpr, size, spread, sigma));
    return { rgb: sh.rgba.slice(0, 3).map(f), alpha: f(sh.rgba[3]), hx: axis(W), hy: axis(H) };
  });
  const surf = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    const { i0: y0, i1: y1, w: wy } = ty[y] ?? { i0: 0, i1: 0, w: 0 };
    for (let x = 0; x < W; x++) {
      const { i0: x0, i1: x1, w: wx } = tx[x] ?? { i0: 0, i1: 0, w: 0 };
      for (let c = 0; c < 3; c++) {
        const cs = mix(
          mix(tex(x0, y0, c), tex(x1, y0, c), wx),
          mix(tex(x0, y1, c), tex(x1, y1, c), wx),
          wy,
        );
        surf[c] = blend(field[c] ?? 0, cs);
      }
      for (const sh of shadows) {
        const a = sh.alpha > 0 ? f(sh.alpha * f(1 - f((sh.hx[x] ?? 0) * (sh.hy[y] ?? 0)))) : 0;
        const ka = f(1 - a);
        for (let c = 0; c < 3; c++) surf[c] = f(f((surf[c] ?? 0) * ka) + f((sh.rgb[c] ?? 0) * a));
      }
      const o = (y * W + x) * 4;
      const ka = f(1 - (data[o + 3] ?? 0));
      for (let c = 0; c < 3; c++) {
        const v = f(f((surf[c] ?? 0) * ka) + f((data[o + c] ?? 0) * (key[c] ?? 0)));
        out[o + c] = Math.round(Math.min(Math.max(v, 0), 1) * 255);
      }
      out[o + 3] = 255;
    }
  }
}

const edgeFn = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  f(f(f(bx - ax) * f(cy - ay)) - f(f(by - ay) * f(cx - ax)));

/**
 * Barycentric weights of (cx, cy) in the triangle a, b, d, edges included, with its doubled
 * area; null outside (render/ribbon.wgsl `bary`).
 */
function bary(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
): [number, number, number, number] | null {
  const area = edgeFn(ax, ay, bx, by, dx, dy);
  if (area === 0) return null;
  const w0 = f(edgeFn(bx, by, dx, dy, cx, cy) / area);
  const w1 = f(edgeFn(dx, dy, ax, ay, cx, cy) / area);
  const w2 = f(edgeFn(ax, ay, bx, by, cx, cy) / area);
  if (w0 < 0 || w1 < 0 || w2 < 0) return null;
  return [w0, w1, w2, area];
}

/** The mip level of a triangle from its texel-per-pixel Jacobian (render/ribbon.wgsl `tri_lod`). */
function triLod(p: readonly number[], t: readonly number[], area: number, maxLod: number): number {
  const [ax = 0, ay = 0, bx = 0, by = 0, dx = 0, dy = 0] = p;
  const g = [f(f(by - dy) / area), f(f(dy - ay) / area), f(f(ay - by) / area)];
  const h = [f(f(dx - bx) / area), f(f(ax - dx) / area), f(f(bx - ax) / area)];
  const comb = (w: number[], k: number) =>
    f(
      f(f(f(t[k] ?? 0) * (w[0] ?? 0)) + f((t[k + 2] ?? 0) * (w[1] ?? 0))) +
        f((t[k + 4] ?? 0) * (w[2] ?? 0)),
    );
  const rho = Math.max(len2(comb(g, 0), comb(g, 1)), len2(comb(h, 0), comb(h, 1)));
  const lod = f(Math.log2(rho));
  return Number.isNaN(lod) ? 0 : Math.min(Math.max(lod, 0), maxLod);
}

/** The v21 ribbon's v at the +n and −n edges of a stroke row (app23.js:L829). */
const V0 = f(0.02);
const V1 = f(0.98);

/**
 * Textured ribbon segments (RIBBON_SEG_WORDS each, plate units), in order, into the ink buffer:
 * the twin of render/ribbon.wgsl `vs_ribbon`/`fs_ribbon`. Each segment is the reference's two
 * triangles; a pixel belongs to the first that holds its centre, edges included.
 */
export function rasteriseRibbons(
  target: InkBuffer,
  atlas: AtlasData,
  segsF: Float32Array,
  segsU: Uint32Array,
  count: number,
  params: SpriteParams,
): void {
  const top = atlas.levels[0];
  if (!top) return;
  const px = f(params.pxPerUnit);
  const ink = params.ink ?? [1, 1, 1];
  const offX = f(params.off?.[0] ?? 0);
  const offY = f(params.off?.[1] ?? 0);
  const [lo, hi] = atlas.edge;
  const { width: W, height: H, data } = target;
  const maxLod = atlas.levels.length - 1;
  const cw = f(top.width);
  const ch = f(top.height);
  for (let s = 0; s < count; s++) {
    const o = s * 12;
    const p = Array.from({ length: 8 }, (_, k) =>
      f(f((segsF[o + k] ?? 0) + (k % 2 ? offY : offX)) * px),
    );
    const [p0x = 0, p0y = 0, p1x = 0, p1y = 0, p2x = 0, p2y = 0, p3x = 0, p3y = 0] = p;
    const u0 = segsF[o + 8] ?? 0;
    const u1 = segsF[o + 9] ?? 0;
    const layer = segsU[o + 10] ?? 0;
    const alpha = segsF[o + 11] ?? 0;
    const tA = [u0, V0, u0, V1, u1, V0];
    const tB = [u0, V1, u1, V1, u1, V0];
    const xs = [p0x, p1x, p2x, p3x];
    const ys = [p0y, p1y, p2y, p3y];
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - 2));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs) + 2));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - 2));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys) + 2));
    let lodA = -1;
    let lodB = -1;
    for (let y = y0; y <= y1; y++) {
      const cy = f(y + 0.5);
      for (let x = x0; x <= x1; x++) {
        const cx = f(x + 0.5);
        let u: number;
        let v: number;
        let lod: number;
        const wa = bary(p0x, p0y, p1x, p1y, p2x, p2y, cx, cy);
        if (wa) {
          u = f(f(f(f(tA[0] ?? 0) * wa[0]) + f((tA[2] ?? 0) * wa[1])) + f((tA[4] ?? 0) * wa[2]));
          v = f(f(f(f(tA[1] ?? 0) * wa[0]) + f((tA[3] ?? 0) * wa[1])) + f((tA[5] ?? 0) * wa[2]));
          if (lodA < 0)
            lodA = triLod(
              [p0x, p0y, p1x, p1y, p2x, p2y],
              tA.map((t, k) => f(t * (k % 2 ? ch : cw))),
              wa[3],
              maxLod,
            );
          lod = lodA;
        } else {
          const wb = bary(p1x, p1y, p3x, p3y, p2x, p2y, cx, cy);
          if (!wb) continue;
          u = f(f(f(f(tB[0] ?? 0) * wb[0]) + f((tB[2] ?? 0) * wb[1])) + f((tB[4] ?? 0) * wb[2]));
          v = f(f(f(f(tB[1] ?? 0) * wb[0]) + f((tB[3] ?? 0) * wb[1])) + f((tB[5] ?? 0) * wb[2]));
          if (lodB < 0)
            lodB = triLod(
              [p1x, p1y, p3x, p3y, p2x, p2y],
              tB.map((t, k) => f(t * (k % 2 ? ch : cw))),
              wb[3],
              maxLod,
            );
          lod = lodB;
        }
        const t = sampleLevel(atlas, layer, u, v, lod);
        // at most 1, as ribbon.wgsl (v21's RGBA8 canvas clamps the edge-on stroke past 90°)
        const a = Math.min(f(f(smoothstep(lo, hi, t) * f(alpha)) * f(params.gain)), 1);
        if (a === 0) continue;
        const oo = (y * W + x) * 4;
        const k = f(1 - a);
        data[oo] = f(f(ink[0] * a) + f((data[oo] ?? 0) * k));
        data[oo + 1] = f(f(ink[1] * a) + f((data[oo + 1] ?? 0) * k));
        data[oo + 2] = f(f(ink[2] * a) + f((data[oo + 2] ?? 0) * k));
        data[oo + 3] = f(a + f((data[oo + 3] ?? 0) * k));
      }
    }
  }
}

/** v21's four sample positions (the standard 4× MSAA pattern), from the pixel centre (ADR 0019). */
export const PEN_SAMPLES: readonly (readonly [number, number])[] = [
  [-0.125, -0.375],
  [0.375, -0.125],
  [-0.375, 0.125],
  [0.125, 0.375],
];

/**
 * Whether the sample (sx, sy) lies in the quad of the segment from (ax, ay), unit direction
 * (tx, ty), length l, extended by e at both ends, half-width w: render/ribbon.wgsl `pen_inside`,
 * in the same f32 steps.
 */
function penSample(
  sx: number,
  sy: number,
  ax: number,
  ay: number,
  tx: number,
  ty: number,
  l: number,
  e: number,
  w: number,
): boolean {
  const dx = f(sx - ax);
  const dy = f(sy - ay);
  const u = f(f(dx * tx) + f(dy * ty));
  const v = f(f(dy * tx) - f(dx * ty));
  return u >= -e && u <= f(l + e) && Math.abs(v) <= w;
}

/**
 * Pen lines (CAPSULE_WORDS each, plate units), one layer: the twin of render/ribbon.wgsl
 * `vs_capsule`/`fs_pen_mask`/`fs_pen_resolve` (ADR 0019). Each segment is v21's quad, extended by
 * 0.9 w at both ends; the layer's quads are unioned per sample at v21's four positions (a 4-bit
 * mask per pixel), and the covered fraction is inked over what is there.
 */
export function rasteriseCapsules(
  target: InkBuffer,
  caps: Float32Array,
  count: number,
  params: SpriteParams,
): void {
  const px = f(params.pxPerUnit);
  const ink = params.ink ?? [1, 1, 1];
  const offX = f(params.off?.[0] ?? 0);
  const offY = f(params.off?.[1] ?? 0);
  const { width: W, height: H, data } = target;
  const mask = new Uint8Array(W * H);
  const s0 = PEN_SAMPLES.map((s) => f(s[0]));
  const s1 = PEN_SAMPLES.map((s) => f(s[1]));
  for (let s = 0; s < count; s++) {
    const o = s * 8;
    const ax = f(f((caps[o] ?? 0) + offX) * px);
    const ay = f(f((caps[o + 1] ?? 0) + offY) * px);
    const bx = f(f((caps[o + 2] ?? 0) + offX) * px);
    const by = f(f((caps[o + 3] ?? 0) + offY) * px);
    const w = f((caps[o + 4] ?? 0) * px);
    const alpha = caps[o + 5] ?? 0;
    const vx = f(bx - ax);
    const vy = f(by - ay);
    const l = f(Math.sqrt(f(f(vx * vx) + f(vy * vy))));
    if (!(l > 0) || alpha <= 0) continue;
    const tx = f(vx / l);
    const ty = f(vy / l);
    const e = f(f(0.9) * w);
    const r = w + e + 2;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r));
    for (let y = y0; y <= y1; y++) {
      const cy = f(y + 0.5);
      for (let x = x0; x <= x1; x++) {
        const cx = f(x + 0.5);
        let m = 0;
        for (let k = 0; k < 4; k++)
          if (penSample(f(cx + (s0[k] ?? 0)), f(cy + (s1[k] ?? 0)), ax, ay, tx, ty, l, e, w))
            m |= 1 << k;
        if (m) mask[y * W + x] = (mask[y * W + x] ?? 0) | m;
      }
    }
  }
  const gain = f(params.gain);
  for (let i = 0; i < W * H; i++) {
    const m = mask[i] ?? 0;
    if (!m) continue;
    const n = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
    const a = f(f(n * 0.25) * gain);
    const oo = i * 4;
    const k = f(1 - a);
    data[oo] = f(f(ink[0] * a) + f((data[oo] ?? 0) * k));
    data[oo + 1] = f(f(ink[1] * a) + f((data[oo + 1] ?? 0) * k));
    data[oo + 2] = f(f(ink[2] * a) + f((data[oo + 2] ?? 0) * k));
    data[oo + 3] = f(a + f((data[oo + 3] ?? 0) * k));
  }
}
