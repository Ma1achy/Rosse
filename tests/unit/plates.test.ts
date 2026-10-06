/**
 * Plates (M6): the slipped plates' offsets and gains, and the colour plate's population inks, are
 * v21's, compared as ink images.
 *
 * `tools/capture-reference/plates.mjs` captured v21 drawing four cases (the slipped plates and the
 * colour plates, each on Paper and on the Chalkboard) with every `drawSprites` call recorded: the
 * atlas, the instance rows, the ink, the offset and the gain, and v21's own canvas. This test
 * draws the same rows with the engine's passes (CPU engine, equal to WebGPU at L1,
 * tests/gpu/plates.ts) and compares:
 *
 * - the passes: the engine's `platePasses` against the recorded calls, pass by pass (offsets and
 *   gains exactly, inks to 10⁻⁶);
 * - the inks: each layer's population, as the engine tags it, gives the ink v21 recorded for it;
 * - the ink images: premultiplied RGBA of the engine's ink target against v21's canvas, per
 *   channel: the total, and the summed absolute difference relative to the total. The two engines
 *   sample their atlases differently (a grid texture's mips against per-layer mips), which is the
 *   floor of the second measure; a plate slipped by a pixel, a gain 30% off or a wrong ink is far
 *   above it (the negative controls).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { CpuRenderer } from '../../src/fallback';
import { rasteriseSprites } from '../../src/fallback/raster';
import { CpuStipple, CpuStippleTiers } from '../../src/fallback/stipple';
import type { Instance } from '../../src/marks/instance';
import { buildScene } from '../../src/model/scene';
import { presetParams } from '../../src/core/presets';
import { cameraOf } from '../../src/view/camera';
import type { InkLayer } from '../../src/render/layers';
import { PALETTES } from '../../src/render/palette';
import { platePasses, type Plates, type Pop } from '../../src/render/plates';
import { loadAtlases, metaOf } from '../golden/compare/engine-cpu';

const ROOT = resolve(import.meta.dirname, '../..');

interface Call {
  kind: 'sprites';
  atlas: 'dots' | 'knots' | 'stars' | 'cores' | 'pieces';
  ink: [number, number, number];
  off: [number, number];
  gain: number;
  rows: number[][];
}
interface Capture {
  name: string;
  plates: Plates;
  theme: 'light' | 'dark';
  size: number;
  calls: Call[];
}

const CASES = ['slip-paper', 'slip-chalk', 'colour-paper', 'colour-chalk'];
const dir = resolve(ROOT, 'tests/golden/plates');
const load = (name: string) => ({
  cap: JSON.parse(readFileSync(resolve(dir, `${name}.json`), 'utf8')) as Capture,
  png: PNG.sync.read(readFileSync(resolve(dir, `${name}.ink.png`))),
});

const f32 = Math.fround;
const close = (a: readonly number[], b: readonly number[], tol = 1e-6) =>
  a.length === b.length && a.every((x, i) => Math.abs(x - (b[i] ?? NaN)) <= tol);

const instances = (c: Call): Instance[] =>
  c.rows.map((w) => ({
    x: w[0] ?? 0,
    y: w[1] ?? 0,
    layer: w[2] ?? 0,
    alpha: w[3] ?? 0,
    m: [w[4] ?? 0, w[5] ?? 0, w[6] ?? 0, w[7] ?? 0],
  }));

/** v21's calls of one pass of the plates: the colour plate's one, or a quarter of the slipped. */
function firstPass(cap: Capture): Call[] {
  const n = platePasses(cap.plates, PALETTES.light).length;
  expect(cap.calls.length % n).toBe(0);
  return cap.calls.slice(0, cap.calls.length / n);
}

/** The population of each layer of the colour plate, as the engine tags the same layers. */
function enginePops(): Pop[] {
  const params = presetParams('Stellar populations', 7, { lines: 0, bubbles: 0, stars: 900 });
  const atlases = loadAtlases(ROOT);
  const view = new CpuStipple(buildScene(params, metaOf(atlases))).view(cameraOf(params, 1));
  const atlas = ['dots', 'dots', 'dots', 'knots', 'stars', 'cores'];
  const pops: Pop[] = [];
  let at = 0;
  for (const l of view.layers) {
    if (l.kind !== 'sprites' || !l.instances.length) continue;
    // the layers v21 draws as its populations, in its order: old, disc and young dots, knots,
    // stars, then the core
    if (l.atlas === atlas[at]) {
      pops.push(l.pop ?? 'line');
      at++;
    }
  }
  return pops;
}

/** Summed premultiplied RGBA of the engine's target, v21's canvas, and their absolute difference. */
function compareInk(data: ArrayLike<number>, png: PNG, size: number) {
  const ours = [0, 0, 0, 0];
  const theirs = [0, 0, 0, 0];
  const abs = [0, 0, 0, 0];
  for (let i = 0; i < size * size; i++) {
    const a = (png.data[i * 4 + 3] ?? 0) / 255;
    for (let c = 0; c < 4; c++) {
      // the PNG is straight alpha; v21's canvas holds premultiplied colour
      const t = c === 3 ? a : ((png.data[i * 4 + c] ?? 0) / 255) * a;
      const o = data[i * 4 + c] ?? 0;
      ours[c] = (ours[c] ?? 0) + o;
      theirs[c] = (theirs[c] ?? 0) + t;
      abs[c] = (abs[c] ?? 0) + Math.abs(o - t);
    }
  }
  return {
    /** the engine's total over v21's, minus one, per channel (R, G, B, α) */
    total: ours.map((o, c) => o / (theirs[c] || 1) - 1),
    /** the summed absolute difference over v21's total, per channel */
    err: abs.map((a, c) => a / (theirs[c] || 1)),
  };
}

/** The ink target with explicit passes (negative controls: the passes the engine does not use). */
function inkWith(
  layers: InkLayer[],
  passes: {
    ink: (pop: Pop) => readonly [number, number, number];
    off: [number, number];
    gain: number;
  }[],
  size: number,
) {
  const r = new CpuRenderer(
    { plateCss: size, dpr: 1 },
    { width: 1, height: 1, data: new Uint8Array(4) },
  );
  const atlases = loadAtlases(ROOT);
  for (const a of atlases) r.addAtlas(a);
  for (const p of passes)
    for (const l of layers) {
      if (l.kind !== 'sprites') continue;
      const atlas = atlases.find((a) => a.name === l.atlas);
      if (!atlas) continue;
      rasteriseSprites(r.ink, atlas, l.instances, {
        pxPerUnit: r.pxPerUnit,
        gain: l.gain * p.gain,
        ink: p.ink(l.pop ?? 'line'),
        off: p.off,
      });
    }
  return r.ink.data;
}

const TOTAL = 0.02;
const FLOOR = 0.08;

describe('plates against v21', () => {
  for (const name of CASES.filter((n) => n.startsWith('slip'))) {
    it(`${name}: four passes at v21's offsets, gains and inks`, () => {
      const { cap } = load(name);
      const passes = platePasses('slip', cap.theme === 'dark' ? PALETTES.dark : PALETTES.light);
      expect(passes).toHaveLength(4);
      const per = cap.calls.length / 4;
      expect(per).toBeGreaterThan(0);
      passes.forEach((p, k) => {
        for (const c of cap.calls.slice(k * per, (k + 1) * per)) {
          expect(c.off, `pass ${String(k)} offset`).toEqual([...p.off]);
          expect(f32(c.gain), `pass ${String(k)} gain`).toBe(f32(p.gain));
          expect(close(c.ink, p.inkOf('line')), `pass ${String(k)} ink`).toBe(true);
        }
      });
    });
  }

  it('colour plate: each population has v21 inks, on both surfaces', () => {
    const pops = enginePops();
    expect(pops).toEqual(['old', 'disc', 'young', 'hii', 'young', 'old']);
    for (const name of ['colour-paper', 'colour-chalk']) {
      const { cap } = load(name);
      const palette = cap.theme === 'dark' ? PALETTES.dark : PALETTES.light;
      const calls = firstPass(cap);
      expect(calls.map((c) => c.atlas)).toEqual([
        'dots',
        'dots',
        'dots',
        'knots',
        'stars',
        'cores',
      ]);
      calls.forEach((c, i) => {
        const ink = platePasses('colour', palette)[0]?.inkOf(pops[i] ?? 'line') ?? [0, 0, 0];
        expect(close(c.ink, ink), `${name} layer ${String(i)} (${pops[i] ?? ''}) ink`).toBe(true);
        expect(c.off).toEqual([0, 0]);
        expect(c.gain).toBe(1);
      });
    }
  });

  for (const name of CASES) {
    it(`${name}: the ink image matches v21's canvas`, () => {
      const { cap, png } = load(name);
      const palette = cap.theme === 'dark' ? PALETTES.dark : PALETTES.light;
      const r = new CpuRenderer(
        { plateCss: cap.size, dpr: 1 },
        { width: 1, height: 1, data: new Uint8Array(4) },
      );
      for (const a of loadAtlases(ROOT)) r.addAtlas(a);
      const pops = cap.plates === 'colour' ? enginePops() : [];
      const calls = firstPass(cap);
      const layers: InkLayer[] = calls.map((c, i) => ({
        kind: 'sprites',
        atlas: c.atlas,
        gain: 1,
        pop: pops[i] ?? 'line',
        instances: instances(c),
      }));
      r.setLayers(layers);
      r.drawInk({ plates: cap.plates, palette });
      const m = compareInk(r.ink.data, png, cap.size);
      m.total.forEach((t, c) => {
        expect(Math.abs(t), `${name} total of channel ${String(c)}`).toBeLessThan(TOTAL);
      });
      m.err.forEach((e, c) => {
        expect(e, `${name} summed difference of channel ${String(c)}`).toBeLessThan(FLOOR);
      });
    });
  }

  it('switching plates runs no tier and keeps the drawn layers (the CPU engine)', () => {
    const eng = new CpuStippleTiers(metaOf(loadAtlases(ROOT)));
    const P = presetParams('Stellar populations', 7, { stars: 900 });
    const first = eng.frame(P, 1);
    const runs = { ...eng.tiers.runs };
    for (const plates of ['slip', 'colour', 'ink']) {
      const next = eng.frame({ ...P, plates }, 1);
      expect(next.work, plates).toEqual({ model: false, view: false });
      // the same view tier output: the layers are what the passes print again
      expect(next.view.layers, plates).toBe(first.view.layers);
    }
    expect(eng.tiers.runs).toEqual(runs);
  });

  it('negative controls: a plate slipped a pixel, a wrong gain and a wrong ink all fail', () => {
    const { cap, png } = load('slip-paper');
    const layers: InkLayer[] = firstPass(cap).map((c) => ({
      kind: 'sprites',
      atlas: c.atlas,
      gain: 1,
      instances: instances(c),
    }));
    const real = platePasses('slip', PALETTES.light).map((p) => ({
      ink: (pop: Pop) => p.inkOf(pop),
      off: [p.off[0], p.off[1]] as [number, number],
      gain: p.gain,
    }));
    const worst = (passes: typeof real) =>
      Math.max(
        ...compareInk(inkWith(layers, passes, cap.size), png, cap.size).err,
        ...compareInk(inkWith(layers, passes, cap.size), png, cap.size).total.map(Math.abs),
      );
    // the same passes pass: the controls differ only by what they change
    expect(worst(real)).toBeLessThan(FLOOR);
    const slipped = real.map((p, k) =>
      k === 1 ? { ...p, off: [p.off[0] + 1, p.off[1]] as [number, number] } : p,
    );
    expect(worst(slipped), 'magenta slipped a pixel').toBeGreaterThan(FLOOR);
    const gain = real.map((p, k) => (k === 0 ? { ...p, gain: p.gain * 1.3 } : p));
    expect(worst(gain), 'cyan 30% heavier').toBeGreaterThan(TOTAL);
    const swapped = real.map((p, k) => (k === 2 ? { ...p, ink: () => PALETTES.light.hii } : p));
    expect(worst(swapped), 'yellow plate in the wrong ink').toBeGreaterThan(TOTAL);
  });
});
