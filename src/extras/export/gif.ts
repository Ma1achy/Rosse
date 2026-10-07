/**
 * The animated GIF export (milestone M12): v21's encoder (`gifEncode`, app23.js:L1673) and its two
 * palettes, pure and DOM-free, so a worker (./gif-worker.ts) and Node tests run the same code.
 *
 * The frames are the engine's ink target, premultiplied RGBA8, drawn at the GIF's size (the engine
 * renders at that size directly; v21 scales its 800 px canvas down). `quantiseFrame` puts each over
 * the plate's flat surface colour, as v21 does with `fillRect` and `drawImage` (the paper's grain
 * is not in a GIF), and maps it to a palette index:
 *
 * - **ramp** (the key ink, `plates: 'ink'`): ink on paper, or cream chalk on the board, is one
 *   colour run from the surface to the ink, so the 256 palette entries are that line and the
 *   index is the pixel's position on it, which is the ink's alpha, to 8 bits (the key ink is
 *   drawn white and coloured by the composite, so the colour channels carry nothing more);
 * - **cube** (colour plates, slipped plates): 6 × 7 × 6 levels of red, green and blue, and the
 *   surface colour as entry 252.
 *
 * The timeline's frames are `t = k / n · end` for k = 0 … n − 1 (v21 L1722), so the last frame is
 * one step short of the end and the GIF loops cleanly; the delay is `round(12 / speed · end / 2 /
 * n · 100)` centiseconds, at least 2 (L1737). Merger and quasar-flare sources are wired by the
 * page (src/extras/export/README in docs/milestones/m12): they supply the frames' ink.
 */

import { SURFACES, type SurfaceName } from '../../render/surface';

export type Rgb = readonly [number, number, number];

/**
 * The engine's own surface and key-ink colours, as 8-bit RGB: Paper #e6dece (230, 222, 206) with
 * ink (29, 27, 25), Chalkboard #262b28 (38, 43, 40) with chalk (236, 228, 210). v21 reads the
 * surface from the page's CSS; these are the engine's.
 */
export function gifColours(surface: SurfaceName): { paper: Rgb; ink: Rgb } {
  const to8 = (c: readonly number[]): Rgb => [
    Math.round((c[0] ?? 0) * 255),
    Math.round((c[1] ?? 0) * 255),
    Math.round((c[2] ?? 0) * 255),
  ];
  const s = SURFACES[surface];
  return { paper: to8(s.field), ink: to8(s.palette.ink) };
}

/** The time of frame k of an n-frame timeline ending at `end` (v21's `k / nF * end`). */
export function frameTime(k: number, n: number, end: number): number {
  return (k / n) * end;
}

/** The frame delay in centiseconds, as v21 (`TL_BASE` 12 s for t from 0 to 2 at speed 1). */
export function gifDelayCs(speed: number, end: number, n: number): number {
  return Math.max(2, Math.round((((12 / speed) * end) / 2 / n) * 100));
}

/** The 256 shades from the surface to the ink (v21's `ramp`). */
export function rampPalette(paper: Rgb, ink: Rgb): Rgb[] {
  const pal: Rgb[] = [];
  for (let i = 0; i < 256; i++) {
    const f = i / 255;
    pal.push([
      Math.round(paper[0] + (ink[0] - paper[0]) * f),
      Math.round(paper[1] + (ink[1] - paper[1]) * f),
      Math.round(paper[2] + (ink[2] - paper[2]) * f),
    ]);
  }
  return pal;
}

/** 6 × 7 × 6 colours and the surface (v21's colour cube); entries after it are black. */
export function cubePalette(paper: Rgb): Rgb[] {
  const pal: Rgb[] = [];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 7; g++)
      for (let b = 0; b < 6; b++)
        pal.push([Math.round(r * 51), Math.round(g * 42.5), Math.round(b * 51)]);
  pal.push(paper);
  return pal;
}

/** The colour cube's entry for the plate's own surface colour. */
export const SURFACE_INDEX = 252;

export type GifMode = 'ramp' | 'cube';

export interface GifSpec {
  width: number;
  height: number;
  /** the plate's surface colour (paper, or the chalkboard) */
  paper: Rgb;
  /** the key ink's colour (for the ramp) */
  ink: Rgb;
  mode: GifMode;
  /** centiseconds per frame */
  delayCs: number;
}

/** One frame's palette indices from the ink (premultiplied RGBA8 on transparent). */
export function quantiseFrame(
  rgba: Uint8ClampedArray | Uint8Array,
  spec: Pick<GifSpec, 'width' | 'height' | 'paper' | 'ink' | 'mode'>,
): Uint8Array {
  const n = spec.width * spec.height;
  if (rgba.length < n * 4) throw new Error('the frame is smaller than its size says');
  const px = new Uint8Array(n);
  if (spec.mode === 'ramp') {
    // the key ink is drawn white and coloured by the composite (ADR 0007), so only its alpha is the
    // ink: ink over the surface is a point on the surface-to-ink line, at the alpha. v21 reads
    // the same number back from the colours of its canvas (a projection onto that line).
    for (let q = 0; q < n; q++) px[q] = rgba[q * 4 + 3] as number;
    return px;
  }
  const { paper } = spec;
  for (let q = 0, o = 0; q < n; q++, o += 4) {
    const a8 = rgba[o + 3] as number;
    // an empty pixel is the surface itself: entry 252, which the cube cannot reach
    if (a8 === 0) {
      px[q] = SURFACE_INDEX;
      continue;
    }
    // premultiplied colours over the surface, to 8 bits as a canvas composes them
    const a = a8 / 255;
    const r = Math.round((rgba[o] as number) + paper[0] * (1 - a));
    const g = Math.round((rgba[o + 1] as number) + paper[1] * (1 - a));
    const b = Math.round((rgba[o + 2] as number) + paper[2] * (1 - a));
    px[q] =
      r === paper[0] && g === paper[1] && b === paper[2]
        ? SURFACE_INDEX
        : Math.min(5, Math.round(r / 51)) * 42 +
          Math.min(6, Math.round(g / 42.5)) * 6 +
          Math.min(5, Math.round(b / 51));
  }
  return px;
}

/** The palette a spec uses. */
export function paletteOf(spec: Pick<GifSpec, 'paper' | 'ink' | 'mode'>): Rgb[] {
  return spec.mode === 'ramp' ? rampPalette(spec.paper, spec.ink) : cubePalette(spec.paper);
}

/** v21's GIF89a encoder: global 256-colour palette, loop forever, LZW with 9-bit codes to 12. */
export function gifEncode(
  frames: readonly Uint8Array[],
  w: number,
  h: number,
  pal: readonly Rgb[],
  delayCs: number,
): Uint8Array {
  let cap = 1 << 20;
  let out = new Uint8Array(cap);
  let n = 0;
  const b = (x: number) => {
    if (n >= cap) {
      cap *= 2;
      const o2 = new Uint8Array(cap);
      o2.set(out);
      out = o2;
    }
    out[n++] = x & 255;
  };
  const w16 = (x: number) => {
    b(x);
    b(x >> 8);
  };
  const str = (t: string) => {
    for (let i = 0; i < t.length; i++) b(t.charCodeAt(i));
  };
  str('GIF89a');
  w16(w);
  w16(h);
  b(0xf7);
  b(0);
  b(0);
  for (let i = 0; i < 256; i++) {
    const c = pal[i] ?? [0, 0, 0];
    b(c[0]);
    b(c[1]);
    b(c[2]);
  }
  b(0x21);
  b(0xff);
  b(11);
  str('NETSCAPE2.0');
  b(3);
  b(1);
  w16(0);
  b(0); // loop forever
  for (const px of frames) {
    if (px.length !== w * h) throw new Error('a frame is not width × height pixels');
    b(0x21);
    b(0xf9);
    b(4);
    b(0);
    w16(delayCs);
    b(0);
    b(0);
    b(0x2c);
    w16(0);
    w16(0);
    w16(w);
    w16(h);
    b(0);
    const clear = 256;
    const eoi = 257;
    let cs = 9;
    let next = 258;
    const table = new Map<number, number>();
    let acc = 0;
    let nb = 0;
    const blk: number[] = [];
    const emit = (code: number) => {
      acc |= code << nb;
      nb += cs;
      while (nb >= 8) {
        blk.push(acc & 255);
        acc >>>= 8;
        nb -= 8;
      }
    };
    b(8);
    emit(clear);
    let cur = px[0] as number;
    for (let k = 1; k < px.length; k++) {
      const v = px[k] as number;
      const key = cur * 256 + v;
      const hit = table.get(key);
      if (hit !== undefined) {
        cur = hit;
        continue;
      }
      emit(cur);
      if (next === 4096) {
        emit(clear);
        next = 258;
        cs = 9;
        table.clear();
      } else {
        if (next >= 1 << cs) cs++;
        table.set(key, next++);
      }
      cur = v;
    }
    emit(cur);
    emit(eoi);
    if (nb > 0) blk.push(acc & 255);
    for (let j = 0; j < blk.length; j += 255) {
      const m = Math.min(255, blk.length - j);
      b(m);
      for (let t = 0; t < m; t++) b(blk[j + t] as number);
    }
    b(0);
  }
  b(0x3b);
  return out.slice(0, n);
}

/** Encodes frames already quantised to palette indices (one byte a pixel). */
export function encodeIndexed(frames: readonly Uint8Array[], spec: GifSpec): Uint8Array {
  checkSpec(spec);
  return gifEncode(frames, spec.width, spec.height, paletteOf(spec), spec.delayCs);
}

/** The size and delay a GIF can hold: 16 bits each, and at least one pixel and one frame time. */
export function checkSpec(spec: Pick<GifSpec, 'width' | 'height' | 'delayCs'>): void {
  const ok = (v: number, lo: number) => Number.isInteger(v) && v >= lo && v <= 65535;
  if (!ok(spec.width, 1) || !ok(spec.height, 1))
    throw new Error(
      `a GIF is 1 to 65535 pixels each way, not ${String(spec.width)} x ${String(spec.height)}`,
    );
  if (!ok(spec.delayCs, 0))
    throw new Error(`the delay ${String(spec.delayCs)} cs does not fit a GIF`);
}

/** Quantises and encodes frames of ink (see the file comment); the frames are all in memory. */
export function encodeGif(
  frames: readonly (Uint8ClampedArray | Uint8Array)[],
  spec: GifSpec,
): Uint8Array {
  checkSpec(spec);
  return encodeIndexed(
    frames.map((f) => quantiseFrame(f, spec)),
    spec,
  );
}
