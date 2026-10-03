import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cosF, randGaussF, sinF, tanF } from '../../src/core/f32math';
import { NoiseSalt, vnoise } from '../../src/core/noise';
import { presetParams } from '../../src/core/presets';
import { Stream } from '../../src/core/streams';
import { dustTau, runProject } from '../../src/fallback/kernels/project';
import { compact, scanBlocks, scanLocal, SCAN_BLOCK } from '../../src/fallback/kernels/scan';
import { SAMPLE_WORDS, armProfile, runStipple, wrapPi } from '../../src/fallback/kernels/stipple';
import { CpuStipple } from '../../src/fallback/stipple';
import { CLASS_COUNT, Cls } from '../../src/model/classes';
import { proposalCount, RMAX } from '../../src/model/galaxy';
import { coreInstances } from '../../src/model/parts';
import { buildScene } from '../../src/model/scene';
import {
  dotSprite,
  makeVariation,
  readableSources,
  type DrawingsMeta,
} from '../../src/model/variation';
import { cameraOf, viewDesc } from '../../src/view/camera';

/** The drawings' metadata, from the packed atlases (npm run prepare-assets). */
function meta(): DrawingsMeta {
  const idx = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../assets-built/index.json'), 'utf8'),
  ) as { atlases: Record<string, { layers: number; meta: Record<string, unknown[]> }> };
  const a = idx.atlases;
  const get = (n: string) => {
    const x = a[n];
    if (!x) throw new Error(n);
    return x;
  };
  return {
    dots: { src: get('dots').meta.src as string[], size: get('dots').meta.size as number[] },
    knots: { count: get('knots').layers },
    stars: { count: get('stars').layers },
    cores: { kind: get('cores').meta.kind as string[], style: get('cores').meta.style as string[] },
  };
}

const M = meta();
const STIPPLE_ONLY = { lines: 0, knots: 0, envelope: 0, starMix: 0, field: 0, fgstars: 0 };

describe('f32 trigonometry and noise', () => {
  it('sinF, cosF, tanF are accurate to a few f32 ULP', () => {
    let worst = 0;
    for (let i = -20000; i <= 20000; i++) {
      const x = Math.fround(i * 0.0137);
      worst = Math.max(worst, Math.abs(sinF(x) - Math.sin(x)), Math.abs(cosF(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(2.5e-7);
    expect(Math.abs(tanF(Math.fround(0.3)) - Math.tan(0.3))).toBeLessThan(1e-6);
    expect(sinF(0)).toBe(0);
    expect(cosF(0)).toBe(1);
  });

  it('randGaussF is a standard normal', () => {
    let s = 0;
    let s2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const g = randGaussF(7, Stream.test, i, 0);
      s += g;
      s2 += g * g;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.04);
  });

  it('vnoise is in [0, 1), hits the lattice values and is continuous', () => {
    const a = vnoise(3, 4, 7, NoiseSalt.flocc);
    expect(vnoise(3.0001, 4, 7, NoiseSalt.flocc)).toBeCloseTo(a, 3);
    expect(vnoise(3, 4, 8, NoiseSalt.flocc)).not.toBe(a);
    expect(vnoise(3, 4, 7, NoiseSalt.patchy)).not.toBe(a);
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < 2000; i++) {
      const v = vnoise(i * 0.173 - 50, i * 0.311 - 80, 7, 1);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThan(1);
    expect(hi - lo).toBeGreaterThan(0.5);
  });

  it('wrapPi wraps into [−π, π)', () => {
    for (const a of [0, 1, -1, 3.2, -3.2, 7, -7, 100, -100]) {
      const w = wrapPi(a);
      expect(w).toBeGreaterThanOrEqual(-Math.PI - 1e-6);
      expect(w).toBeLessThan(Math.PI + 1e-6);
      expect(Math.abs(Math.sin(w) - Math.sin(a))).toBeLessThan(1e-4);
    }
  });
});

describe('makeVariation', () => {
  it('chooses a hand of 1–3 readable pens', () => {
    const ok = new Set(readableSources(M.dots));
    expect(ok.size).toBeGreaterThan(12);
    const counts = [0, 0, 0, 0];
    for (let seed = 1; seed <= 300; seed++) {
      const V = makeVariation(presetParams('Grand design', seed), M);
      const srcs = new Set(V.dotPool.map((t) => M.dots.src[t]));
      if (V.dotPool.length === M.dots.src.length) continue;
      for (const s of srcs) expect(ok.has(s ?? '')).toBe(true);
      expect(srcs.size).toBe(V.hand.length);
      counts[srcs.size] = (counts[srcs.size] ?? 0) + 1;
      expect(V.knotPool.length).toBe(24);
      expect(V.knotPool.every((k) => k >= 0 && k < M.knots.count)).toBe(true);
    }
    expect(counts[1]).toBeGreaterThan(50);
    expect(counts[2]).toBeGreaterThan(50);
    expect(counts[3]).toBeGreaterThan(20);
  });

  it('readable means a median dot of at least 7 px and at least 8 dots', () => {
    const dots = {
      src: ['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'c'],
      size: [9, 9, 9, 9, 9, 9, 9, 9, 5, 5, 5, 5, 5, 5, 5, 9, 20],
    };
    expect(readableSources(dots)).toEqual(['a']);
  });

  it('uses every dot when vary < 0.15', () => {
    const V = makeVariation(presetParams('Grand design', 7, { vary: 0.1 }), M);
    expect(V.dotPool.length).toBe(M.dots.src.length);
  });

  it('keeps each group on its own stream: changing the arms leaves the hand alone', () => {
    const a = makeVariation(presetParams('Grand design', 7), M);
    const b = makeVariation(presetParams('Grand design', 7, { arms: 5 }), M);
    expect(b.arms.length).toBe(5);
    expect(b.arms[0]).toEqual(a.arms[0]);
    expect(b.dotPool).toEqual(a.dotPool);
    expect(b.knotPool).toEqual(a.knotPool);
    expect([b.lop, b.warp, b.spike]).toEqual([a.lop, a.warp, a.spike]);
  });

  it('sizes dots as dotSprite does', () => {
    // a 10 px dot at pen 2.4: want = 2.35 · 0.99, quad = want · 40 / 10
    expect(dotSprite(10, 0.99)).toBeCloseTo(2.35 * 0.99 * 4, 10);
    // dots under 4 px count as 4: want = 1.9 + 0.045 · 4
    expect(dotSprite(2, 1)).toBeCloseTo((2.08 * 40) / 4, 10);
    expect(dotSprite(80, 1)).toBeCloseTo((3.4 * 40) / 80, 10);
  });
});

describe('stipple model', () => {
  it('makes round(stars · stipple · (1 + 0.28 starMix)) proposals', () => {
    expect(proposalCount(presetParams('Grand design'))).toBe(11096);
    expect(proposalCount(presetParams('Smooth, round', 7, STIPPLE_ONLY))).toBe(9500);
    expect(RMAX).toBe(240);
  });

  it('is deterministic and independent of the camera', () => {
    const P = presetParams('Barred spiral', 7);
    const a = runStipple(buildScene(P, M).galaxy);
    const b = runStipple(buildScene({ ...P, az: 77, incl: 61, pa: 5 }, M).galaxy);
    expect(Buffer.from(a.f32.buffer).equals(Buffer.from(b.f32.buffer))).toBe(true);
  });

  it('keeps every mark under orbit when no view cull applies (ADR 0004)', () => {
    const P = presetParams('Grand design', 7);
    const s = new CpuStipple(buildScene(P, M));
    const a = s.view(cameraOf(P));
    const b = s.view(cameraOf({ ...P, az: 35, incl: 50 }));
    expect(Array.from(b.perClass)).toEqual(Array.from(a.perClass));
  });

  it('weights the components as v21 does', () => {
    // Smooth, round: bulge 1, halo 0.25 → the halo is 0.0625 / 1.0625 of the proposals
    const G = buildScene(presetParams('Smooth, round', 7, STIPPLE_ONLY), M).galaxy;
    const s = runStipple(G);
    let far = 0;
    for (let i = 0; i < s.n; i++) {
      const o = i * SAMPLE_WORDS;
      if (Math.hypot(s.f32[o] ?? 0, s.f32[o + 1] ?? 0, s.f32[o + 2] ?? 0) > 3) far++;
    }
    // bulge (a = 0.198, √u ≤ √0.985) beyond 3 units: u > (3 / 3.198)² = 0.880, so 10.5%;
    // halo (1.4 · exponential) beyond 3 units: exp(−3 / 1.4) = 11.7%
    const expected = s.n * ((1 / 1.0625) * 0.105 + (0.0625 / 1.0625) * 0.117);
    expect(far).toBeGreaterThan(expected * 0.9);
    expect(far).toBeLessThan(expected * 1.1);
  });

  it('puts the dots of a stipple-only galaxy in the old population', () => {
    const s = new CpuStipple(buildScene(presetParams('Smooth, round', 7, STIPPLE_ONLY), M));
    const v = s.view(cameraOf(s.scene.P));
    expect(v.counts).toMatchObject({ dots: 9500, old: 9500, knots: 0, stars: 0, rstars: 0 });
  });

  it('classifies knots, sparkle stars and drawn stars on spirals at about v21’s rates', () => {
    // Grand design, seed 7, v21 (reference notes 6.4): 18 sparkle stars, 1,570 drawn stars
    const s = new CpuStipple(buildScene(presetParams('Grand design', 7), M));
    const c = s.view(cameraOf(s.scene.P)).counts;
    expect(c.rstars).toBeGreaterThan(1400);
    expect(c.rstars).toBeLessThan(1800);
    expect(c.stars).toBeGreaterThan(5);
    expect(c.stars).toBeLessThan(40);
    expect(c.knots).toBeGreaterThan(20);
    expect(c.young).toBeGreaterThan(1000);
  });

  it('has an arm profile that peaks on the arms', () => {
    const G = buildScene(presetParams('Grand design', 7), M).galaxy;
    let hi = 0;
    for (let t = 0; t < 360; t++) hi = Math.max(hi, armProfile(G, 1.5, (t * Math.PI) / 180));
    expect(hi).toBeGreaterThan(0.5);
    expect(armProfile(buildScene(presetParams('Smooth, round'), M).galaxy, 1, 0)).toBe(0);
  });

  it('culls by dust optical depth along the line of sight', () => {
    expect(dustTau(0, 0, 0, 1, 0)).toBe(0);
    expect(dustTau(4, 0, 0, 1, 1)).toBe(0);
    // face-on, from the midplane to the slab's near face: 0.06 · 9 · dust
    expect(dustTau(0, 0, 0, 1, 1)).toBeCloseTo(0.06 * 9, 5);
    // edge-on, in the slab: the 6-unit cap
    expect(dustTau(0, 0, 0, 1e-4, 1)).toBeCloseTo(6 * 9, 4);
    const P = presetParams('Edge-on with dust', 7);
    const s = new CpuStipple(buildScene(P, M));
    const edge = s.view(cameraOf(P)).counts.dots;
    const face = s.view(cameraOf({ ...P, incl: 0 })).counts.dots;
    expect(edge).toBeLessThan(face * 0.95);
  });
});

describe('compaction (scan)', () => {
  it('matches a per-class filter in sample order, across blocks', () => {
    const n = SCAN_BLOCK * 3 + 77;
    const classes = new Uint32Array(n);
    const inst = new Uint32Array(n * 8);
    for (let i = 0; i < n; i++) {
      classes[i] = (i * 7919) % 11 < CLASS_COUNT ? (i * 7919) % 11 : Cls.none;
      inst[i * 8] = i;
    }
    const { out, counts, cap, args } = compact(classes, n, inst);
    for (let c = 0; c < CLASS_COUNT; c++) {
      const want = Array.from({ length: n }, (_, i) => i).filter((i) => classes[i] === c);
      expect(counts[c]).toBe(want.length);
      expect(args[c * 4 + 1]).toBe(want.length);
      expect(args[c * 4]).toBe(4);
      const got = Array.from({ length: want.length }, (_, j) => out[(c * cap + j) * 8]);
      expect(got).toEqual(want);
    }
    const { blockTotals } = scanLocal(classes, n);
    expect(scanBlocks(blockTotals, 4).counts).toEqual(counts);
  });
});

describe('parts', () => {
  it('draws the core of a disc galaxy, and none on smooth ones', () => {
    const P = presetParams('Disc, no arms', 7, STIPPLE_ONLY);
    const c = coreInstances(P, M, cameraOf(P));
    expect(c).toHaveLength(1);
    expect(c[0]?.alpha).toBe(0.9);
    expect(M.cores.style[c[0]?.layer ?? 0]).toBe('dotted');
    expect(
      coreInstances(presetParams('Smooth, round'), M, cameraOf(presetParams('Smooth, round'))),
    ).toHaveLength(0);
    expect(coreInstances({ ...P, incl: 85 }, M, cameraOf({ ...P, incl: 85 }))).toHaveLength(0);
  });

  it('projects with the reference camera', () => {
    const P = presetParams('Grand design', 7);
    const G = buildScene(P, M).galaxy;
    const s = runStipple(G);
    const V = viewDesc(cameraOf(P), 0, s.n, 8);
    const p = runProject(V, s);
    expect(p.classes.length).toBe(s.n);
  });
});
