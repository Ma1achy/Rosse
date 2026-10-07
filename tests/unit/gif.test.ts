import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { CpuRenderer } from '../../src/fallback';
import { CpuMerger } from '../../src/fallback/merger';
import { CpuStipple } from '../../src/fallback/stipple';
import {
  cubePalette,
  encodeGif,
  encodeIndexed,
  gifColours,
  SURFACE_INDEX,
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
import { isTimeline, timelineSource } from '../../src/extras/export/sources';
import { buildScene } from '../../src/model/scene';
import { PALETTES } from '../../src/render/palette';
import { cameraOf } from '../../src/view/camera';
import { loadAtlases, loadVectors, metaOf } from '../golden/compare/engine-cpu';
import { decodeGif } from './support/gif-decode';

const ROOT = join(import.meta.dirname, '../..');
const { paper: PAPER, ink: INK } = gifColours('paper');
const { paper: CHALK_PAPER, ink: CHALK_INK } = gifColours('chalk');

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
  it('maps the colour modes through the cube, and an empty plate to the surface entry', () => {
    const px = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 255]);
    const q = quantiseFrame(px, {
      width: 2,
      height: 1,
      paper: [255, 255, 255],
      ink: INK,
      mode: 'cube',
    });
    expect(q[0]).toBe(SURFACE_INDEX);
    expect(q[1]).toBe(5 * 42); // opaque red
    // over the engine's real surfaces, an empty plate is the surface and nothing else
    for (const surface of ['paper', 'chalk'] as const) {
      const { paper, ink } = gifColours(surface);
      const empty = new Uint8ClampedArray(4 * 4);
      expect(
        Array.from(quantiseFrame(empty, { width: 4, height: 1, paper, ink, mode: 'cube' })),
      ).toEqual([252, 252, 252, 252]);
      // a faint ink is a cube colour, and the surface entry decodes to the surface itself
      const faint = new Uint8ClampedArray([1, 1, 1, 2]);
      expect(quantiseFrame(faint, { width: 1, height: 1, paper, ink, mode: 'cube' })[0]).not.toBe(
        252,
      );
      expect(cubePalette(paper)[SURFACE_INDEX]).toEqual(paper);
    }
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

  it('quantises and encodes in one go as it does in two', () => {
    const w = 8;
    const px = new Uint8ClampedArray(w * w * 4).map((_, i) => (i * 37) % 256);
    const spec: GifSpec = { width: w, height: w, paper: PAPER, ink: INK, mode: 'ramp', delayCs: 5 };
    expect(encodeGif([px], spec)).toEqual(encodeIndexed([quantiseFrame(px, spec)], spec));
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
        (frames, spec: GifSpec) => encodeIndexed(frames, spec),
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

describe('the merger timeline as a GIF (M8)', () => {
  const S = 160;
  const atlases = loadAtlases(ROOT);
  const vectors = loadVectors(ROOT);
  const meta = metaOf(atlases, vectors.penlines, vectors);
  const renderer = new CpuRenderer(
    { plateCss: S, dpr: 1 },
    { width: 1, height: 1, data: new Uint8Array(4) },
  );
  for (const a of atlases) renderer.addAtlas(a);
  const P0 = presetParams('Merger: the Mice', 7, { starMix: 0, field: 0, fgstars: 0 });
  /** a fresh merger at the parameters' own mTime: the single render at that moment */
  const draw = (P: Params) => {
    const view = new CpuMerger(P, meta).view(1);
    renderer.setLayers(view.layers);
    renderer.drawInk({ plates: 'ink', palette: PALETTES.light });
    return cpuInkFrame(renderer.ink);
  };
  /** the timeline as the page runs it: one simulation, `mTime` re-blended per frame (ADR 0009) */
  const sim = new CpuMerger({ ...P0 }, meta);
  const timeline = (P: Params) => {
    const view = sim.view(1, P.mTime);
    renderer.setLayers(view.layers);
    renderer.drawInk({ plates: 'ink', palette: PALETTES.light });
    return cpuInkFrame(renderer.ink);
  };

  it('is a timeline only for a merger or a lensed quasar', () => {
    expect(isTimeline(P0)).toBe(true);
    expect(isTimeline(presetParams('Grand design', 7))).toBe(false);
    expect(isTimeline({ ...P0, merger: 0, lensOn: 1, lensSource: 'quasar' })).toBe(true);
    expect(() => timelineSource(S, S, presetParams('Grand design', 7), timeline)).toThrow();
  });

  it('moves the Mice through mTime, and every frame is the single render at its moment', async () => {
    const n = 4;
    const end = 2;
    const src = timelineSource(S, S, P0, timeline);
    const bytes = await recordGif(
      src,
      { frames: n, end, speed: 1, paper: PAPER, ink: INK, mode: 'ramp' },
      (frames, spec: GifSpec) => encodeIndexed(frames, spec),
    );
    const gif = decodeGif(bytes);
    expect(gif.frames).toHaveLength(n);
    const times = frameTimes(n, end);
    const singles = times.map((t) =>
      quantiseFrame(draw({ ...P0, mTime: t }), {
        width: S,
        height: S,
        paper: PAPER,
        ink: INK,
        mode: 'ramp',
      }),
    );
    gif.frames.forEach((f, k) => {
      expect(Array.from(f.pixels), `frame ${String(k)} (t = ${String(times[k])})`).toEqual(
        Array.from(singles[k] as Uint8Array),
      );
    });
    // the pair really moves: consecutive frames differ in many pixels
    for (let k = 1; k < n; k++) {
      const a = gif.frames[k - 1]?.pixels as Uint8Array;
      const b = gif.frames[k]?.pixels as Uint8Array;
      expect(
        a.filter((v, i) => v !== b[i]).length,
        `frames ${String(k - 1)} and ${String(k)}`,
      ).toBeGreaterThan(500);
    }
  }, 300_000);
});

describe('recording a GIF', () => {
  const rec = { frames: 6, end: 2, speed: 1, paper: PAPER, ink: INK, mode: 'ramp' } as const;
  const flat = (w: number, h: number) => (t: number) =>
    Promise.resolve(new Uint8ClampedArray(w * h * 4).fill(Math.round(t * 100)));

  it('quantises each frame as it arrives: the encoder holds one byte a pixel, not four', async () => {
    const w = 64;
    const h = 48;
    let seen: readonly Uint8Array[] = [];
    await recordGif({ width: w, height: h, frame: flat(w, h) }, rec, (frames, spec) => {
      seen = frames;
      return encodeIndexed(frames, spec);
    });
    expect(seen).toHaveLength(6);
    const held = seen.reduce((a, f) => a + f.byteLength, 0);
    expect(held).toBe(6 * w * h);
    // v21's largest recording, 640 px and 120 frames, is 49 MB of indices (the RGBA frames were 197 MB)
    expect(120 * 640 * 640).toBeLessThan(50e6);
    for (const f of seen) expect(f.constructor).toBe(Uint8Array);
  });

  it('refuses a second recording while one runs, and runs `done` however it ends', async () => {
    let finished = 0;
    const slow = {
      width: 8,
      height: 8,
      frame: async (t: number) => {
        await new Promise((ok) => setTimeout(ok, 20));
        return flat(8, 8)(t);
      },
    };
    const first = recordGif(
      slow,
      rec,
      (f, s) => encodeIndexed(f, s),
      undefined,
      () => {
        finished++;
      },
    );
    await expect(recordGif(slow, rec, (f, s) => encodeIndexed(f, s))).rejects.toThrow(/already/);
    await first;
    expect(finished).toBe(1);
    // a failing source: the busy flag is released and `done` still runs
    await expect(
      recordGif(
        { width: 8, height: 8, frame: () => Promise.reject(new Error('no frame')) },
        rec,
        (f, s) => encodeIndexed(f, s),
        undefined,
        () => {
          finished++;
        },
      ),
    ).rejects.toThrow('no frame');
    expect(finished).toBe(2);
    await recordGif({ width: 8, height: 8, frame: flat(8, 8) }, rec, (f, s) => encodeIndexed(f, s));
  });

  it('rejects sizes, delays and frames a GIF cannot hold', async () => {
    const enc = (f: readonly Uint8Array[], s: GifSpec) => encodeIndexed(f, s);
    await expect(recordGif({ width: 0, height: 0, frame: flat(0, 0) }, rec, enc)).rejects.toThrow(
      /pixels/,
    );
    await expect(
      recordGif({ width: 70000, height: 4, frame: flat(1, 1) }, rec, enc),
    ).rejects.toThrow(/pixels/);
    await expect(
      recordGif({ width: 4, height: 4, frame: flat(4, 4) }, { ...rec, speed: 0.0001 }, enc),
    ).rejects.toThrow(/delay/);
    await expect(recordGif({ width: 4, height: 4, frame: flat(3, 3) }, rec, enc)).rejects.toThrow(
      /RGBA/,
    );
    await expect(
      recordGif({ width: 4, height: 4, frame: flat(4, 4) }, { ...rec, frames: 0 }, enc),
    ).rejects.toThrow();
  });
});
