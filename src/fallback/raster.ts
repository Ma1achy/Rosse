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
  const [lo, hi] = atlas.edge;
  const { width: W, height: H, data } = target;
  const maxLod = atlas.levels.length - 1;
  for (const s of instances) {
    const m: M2 = [f(f(s.m[0]) * px), f(f(s.m[1]) * px), f(f(s.m[2]) * px), f(f(s.m[3]) * px)];
    const cx = f(f(s.x) * px);
    const cy = f(f(s.y) * px);
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
  const key = p.surface.palette.ink.map(f);
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
