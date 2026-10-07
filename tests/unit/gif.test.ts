import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { CpuRenderer } from '../../src/fallback';
import { CpuStipple } from '../../src/fallback/stipple';
import {
  cubePalette,
  encodeGif,
  frameTime,
  gifDelayCs,
  gifEncode,
  quantiseFrame,
  rampPalette,
  type GifSpec,
  type Rgb,
} from '../../src/extras/export/gif';
import { cpuInkFrame } from '../../src/extras/export/gif-frames';
import { frameTimes, recordGif } from '../../src/extras/export/record';
import { buildScene } from '../../src/model/scene';
import { PALETTES } from '../../src/render/palette';
import { cameraOf } from '../../src/view/camera';
import { loadAtlases, loadVectors, metaOf } from '../golden/compare/engine-cpu';
import { decodeGif } from './support/gif-decode';

const ROOT = join(import.meta.dirname, '../..');
const PAPER: Rgb = [226, 217, 198];
const INK: Rgb = [29, 27, 25];
const CHALK_PAPER: Rgb = [38, 40, 36];
const CHALK_INK: Rgb = [236, 228, 210];

describe("v21's frame timing", () => {
  it('spaces the frames from 0 to just short of the end, so the GIF loops', () => {
    expect(frameTimes(4, 2)).toEqual([0, 0.5, 1, 1.5]);
    expect(frameTime(59, 60, 2)).toBeCloseTo(1.9667, 4);
  });
  it('gives the delay in centiseconds, at least 2', () => {
    // 12 s for t from 0 to 2 at 1x: 60 frames over end 2 is 0.2 s each
    expect(gifDelayCs(1, 2, 60)).toBe(20);
    expect(gifDelayCs(4, 2, 60)).toBe(5);
    expect(gifDelayCs(4, 0.2, 200)).toBe(2);
  });
});

describe('the palettes', () => {
  it('runs the ramp from the surface to the ink', () => {
    const pal = rampPalette(PAPER, INK);
    expect(pal).toHaveLength(256);
    expect(pal[0]).toEqual(PAPER);
    expect(pal[255]).toEqual(INK);
    expect(pal[128]).toEqual([
      Math.round(PAPER[0] + (INK[0] - PAPER[0]) * (128 / 255)),
      Math.round(PAPER[1] + (INK[1] - PAPER[1]) * (128 / 255)),
      Math.round(PAPER[2] + (INK[2] - PAPER[2]) * (128 / 255)),
    ]);
  });
  it('is the colour cube plus the surface', () => {
    const pal = cubePalette(PAPER);
    expect(pal).toHaveLength(253);
    expect(pal[0]).toEqual([0, 0, 0]);
    expect(pal[251]).toEqual([255, 255, 255]);
    expect(pal[252]).toEqual(PAPER);
  });
  it('maps ink on the surface to its alpha, on the paper and on the chalkboard', () => {
    for (const [paper, ink] of [
      [PAPER, INK],
      [CHALK_PAPER, CHALK_INK],
    ] as [Rgb, Rgb][]) {
      const px = new Uint8ClampedArray(4 * 5);
      const alphas = [0, 64, 128, 200, 255];
      alphas.forEach((a, i) => {
        // premultiplied ink: its colour times alpha
        px[i * 4] = Math.round((ink[0] * a) / 255);
        px[i * 4 + 1] = Math.round((ink[1] * a) / 255);
        px[i * 4 + 2] = Math.round((ink[2] * a) / 255);
        px[i * 4 + 3] = a;
      });
      const q = quantiseFrame(px, { width: 5, height: 1, paper, ink, mode: 'ramp' });
      alphas.forEach((a, i) => {
        expect(q[i], `alpha ${String(a)}`).toBe(a);
      });
      // an empty plate is the surface, exactly
      expect(q[0]).toBe(0);
      expect(q[4]).toBe(255);
    }
  });
  it('maps the colour modes through the cube', () => {
    const px = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 255]);
    const q = quantiseFrame(px, {
      width: 2,
      height: 1,
      paper: [255, 255, 255],
      ink: INK,
      mode: 'cube',
    });
    expect(q[0]).toBe(5 * 42 + 6 * 6 + 5); // empty over a white surface: white
    expect(q[1]).toBe(5 * 42); // opaque red
  });
});

describe('the encoder', () => {
  const noise = (w: number, h: number, seed: number) => {
    const out = new Uint8Array(w * h);
    let s = seed;
    for (let i = 0; i < out.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      out[i] = s >>> 24;
    }
    return out;
  };

  it('writes a GIF that an independent decoder reads back exactly, with table resets', () => {
    // 96 × 96 of noise is 9,216 pixels of near-incompressible data: the 4,096-entry table resets
    const w = 96;
    const frames = [noise(w, w, 1), noise(w, w, 2), new Uint8Array(w * w).fill(7)];
    const pal = rampPalette(PAPER, INK);
    const gif = decodeGif(gifEncode(frames, w, w, pal, 9));
    expect(gif.width).toBe(w);
    expect(gif.height).toBe(w);
    expect(gif.loops).toBe(0);
    expect(gif.palette).toHaveLength(256);
    expect(gif.palette[255]).toEqual([...INK]);
    expect(gif.frames).toHaveLength(3);
    gif.frames.forEach((f, i) => {
      expect(f.delayCs).toBe(9);
      expect(Array.from(f.pixels)).toEqual(Array.from(frames[i] as Uint8Array));
    });
  });

  it('refuses a frame of the wrong size', () => {
    expect(() => gifEncode([new Uint8Array(3)], 2, 2, rampPalette(PAPER, INK), 5)).toThrow();
  });
});

describe('a GIF of the CPU engine: its frames are single renders at those moments', () => {
  const S = 160;
  const atlases = loadAtlases(ROOT);
  const vectors = loadVectors(ROOT);
  const meta = metaOf(atlases, vectors.penlines, vectors);
  const renderer = new CpuRenderer(
    { plateCss: S, dpr: 1 },
    { width: 1, height: 1, data: new Uint8Array(4) },
  );
  for (const a of atlases) renderer.addAtlas(a);
  /** a source the engine has today: the orbit swept through the timeline (the merger's is M8's) */
  const render = (t: number) => {
    const P = { ...presetParams('Grand design', 7, { starMix: 0, field: 0, fgstars: 0 }) };
    P.az = t * 90;
    const view = new CpuStipple(buildScene(P, meta)).view(cameraOf(P, 1));
    renderer.setLayers(view.layers);
    renderer.drawInk({ plates: 'ink', palette: PALETTES.light });
    return cpuInkFrame(renderer.ink);
  };

  for (const [name, paper, ink] of [
    ['paper', PAPER, INK],
    ['chalkboard', CHALK_PAPER, CHALK_INK],
  ] as [string, Rgb, Rgb][])
    it(`decodes with the right frame count, delay and loop, on the ${name}`, async () => {
      const n = 5;
      const end = 2;
      const bytes = await recordGif(
        { width: S, height: S, frame: (t) => Promise.resolve(render(t)) },
        { frames: n, end, speed: 1, paper, ink, mode: 'ramp' },
        (frames, spec: GifSpec) => encodeGif(frames, spec),
      );
      const gif = decodeGif(bytes);
      expect(gif.frames).toHaveLength(n);
      expect(gif.loops).toBe(0);
      expect(gif.width).toBe(S);
      const times = frameTimes(n, end);
      expect(times).toEqual([0, 0.4, 0.8, 1.2, 1.6]);
      gif.frames.forEach((f, k) => {
        expect(f.delayCs).toBe(gifDelayCs(1, end, n));
        // the frame is the single render at its moment, quantised: index for index
        const single = quantiseFrame(render(times[k] as number), {
          width: S,
          height: S,
          paper,
          ink,
          mode: 'ramp',
        });
        expect(Array.from(f.pixels), `frame ${String(k)}`).toEqual(Array.from(single));
      });
      // the frames are different moments, and they carry ink
      const a = gif.frames[0]?.pixels as Uint8Array;
      const c = gif.frames[3]?.pixels as Uint8Array;
      expect(a.filter((v) => v > 0).length).toBeGreaterThan(200);
      expect(Array.from(a)).not.toEqual(Array.from(c));
      // 255 is the ink colour, and the decoded palette shows what the pixel looks like
      expect(gif.palette[0]).toEqual([...paper]);
      expect(gif.palette[255]).toEqual([...ink]);
    }, 120_000);
});
