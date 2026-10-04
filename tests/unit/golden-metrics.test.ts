import { describe, expect, it } from 'vitest';
import {
  bandMean,
  blur,
  compareMeasures,
  densityMap,
  distanceTransform,
  extentOf,
  inkBeyond,
  momentsOf,
  radiusAt,
  downsample,
  grey,
  measure,
  quantile,
  ssim,
  strokeWidths,
  totalInk,
  type Grey,
} from '../../tests/golden/compare/metrics';
import { countAllowance, evaluate, type Thresholds } from '../../tests/golden/compare/thresholds';

/** A plate with anti-aliased discs (coverage by 4×4 supersampling). */
function discs(w: number, h: number, list: [number, number, number][]): Grey {
  const g = grey(w, h);
  for (const [cx, cy, r] of list)
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
        let c = 0;
        for (let j = 0; j < 4; j++)
          for (let i = 0; i < 4; i++) {
            const px = x + (i + 0.5) / 4;
            const py = y + (j + 0.5) / 4;
            if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) c++;
          }
        // ink over ink: 1 − (1 − a)(1 − b)
        const k = y * w + x;
        g.data[k] = 1 - (1 - (g.data[k] ?? 0)) * (1 - c / 16);
      }
  return g;
}

/** Random dots of radius r, from a tiny LCG (deterministic). */
function randomDots(n: number, r: number, seed: number, w = 200, h = 200): Grey {
  let s = seed;
  const u = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  return discs(
    w,
    h,
    Array.from({ length: n }, () => [10 + u() * (w - 20), 10 + u() * (h - 20), r]),
  );
}

/** A little galaxy: n dots with an exponential surface density of scale `h` round (cx, cy). */
function blobDots(n: number, seed: number, cx = 200, cy = 200, h = 30, w = 400): Grey {
  let s = seed;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
  return discs(
    w,
    w,
    Array.from({ length: n }, () => {
      const r = -h * Math.log(u() * u());
      const t = 2 * Math.PI * u();
      return [cx + r * Math.cos(t), cy + r * Math.sin(t), 1.3] as [number, number, number];
    }),
  );
}

describe('golden metric (ADR 0013)', () => {
  it('total ink is the sum of α', () => {
    const g = grey(4, 4, new Float32Array(16).fill(0.25));
    expect(totalInk(g)).toBeCloseTo(4, 6);
  });

  it('the density map conserves ink away from the edges and is 4× smaller', () => {
    const g = grey(64, 64);
    g.data[32 * 64 + 30] = 1;
    g.data[20 * 64 + 40] = 0.5;
    const b = blur(g, 4);
    expect(totalInk(b)).toBeCloseTo(1.5, 4);
    const d = densityMap(g);
    expect([d.width, d.height]).toEqual([16, 16]);
    expect(totalInk(d) * 16).toBeCloseTo(1.5, 4);
    expect(totalInk(downsample(grey(8, 8, new Float32Array(64).fill(1)), 4))).toBe(4);
  });

  it('SSIM is 1 for identical maps, high for re-drawn dots, low for other structure', () => {
    const a = blobDots(6000, 1);
    const same = blobDots(6000, 1);
    const redraw = blobDots(6000, 2);
    expect(ssim(densityMap(a), densityMap(same))).toBeCloseTo(1, 10);
    // the same galaxy moved: same ink, other structure
    const moved = blobDots(6000, 2, 260, 200);
    const sRedraw = ssim(densityMap(a), densityMap(redraw));
    const sMoved = ssim(densityMap(a), densityMap(moved));
    expect(sRedraw).toBeGreaterThan(0.4);
    expect(sMoved).toBeLessThan(sRedraw - 0.15);
    // plain SSIM on the dots themselves punishes the re-draw far more (ADR 0013's point)
    expect(ssim(a, redraw)).toBeLessThan(sRedraw);
  });

  it('the distance transform is exact against brute force', () => {
    const w = 23;
    const h = 17;
    const mask = new Uint8Array(w * h);
    let s = 7;
    for (let i = 0; i < mask.length; i++)
      mask[i] = (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) >>> 28 < 11 ? 1 : 0;
    const dt = distanceTransform(mask, w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let best = Infinity;
        for (let yy = -1; yy <= h; yy++)
          for (let xx = -1; xx <= w; xx++) {
            const out = xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx];
            if (out) best = Math.min(best, Math.hypot(xx - x, yy - y));
          }
        expect(dt[y * w + x]).toBeCloseTo(mask[y * w + x] ? best : 0, 5);
      }
  });

  it('stroke widths measure disc diameters and line widths', () => {
    const d10 = strokeWidths(discs(40, 40, [[20.3, 19.6, 5]]));
    expect(d10.median).toBeGreaterThan(9);
    expect(d10.median).toBeLessThan(11);
    // a horizontal line 3 px wide
    const line = grey(60, 20);
    for (let x = 5; x < 55; x++) for (let y = 9; y < 12; y++) line.data[y * 60 + x] = 1;
    const l3 = strokeWidths(line);
    expect(l3.median).toBeGreaterThan(2.7);
    expect(l3.median).toBeLessThan(3.6);
    // many small dots 2.6 px across: the α ≥ 0.5 contour of so small a dot is a little smaller
    const dots = strokeWidths(randomDots(150, 1.3, 3));
    expect(dots.median).toBeGreaterThan(1.8);
    expect(dots.median).toBeLessThan(2.8);
    expect(dots.p90).toBeGreaterThanOrEqual(dots.median);
  });

  it('quantiles are nearest rank', () => {
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(quantile([], 0.5)).toBe(0);
  });

  it('compares and evaluates against thresholds', () => {
    const a = blobDots(6000, 4);
    const b = blobDots(6000, 5);
    const c = compareMeasures(measure(a), measure(b));
    expect(Math.abs(c.inkRel)).toBeLessThan(0.05);
    const t: Thresholds = {
      ink: 0.05,
      ssimCoarse: 0.6,
      median: 0.1,
      p90: 0.1,
      r25: 0.1,
      r50: 0.1,
      r90: 0.1,
      outer: 0.03,
      q: 0.05,
      qInner: 0.05,
      pa: 10,
      paBelowQ: 0.8,
      counts: 0.03,
      countsSmall: 0.1,
      poisson: 3,
      poissonBelow: 1000,
    };
    const e = evaluate(c, { dots: 300 }, { dots: 303 }, t);
    expect(e.failures).toEqual([]);
    const bad = evaluate(c, { dots: 300 }, { dots: 400 }, t);
    expect(bad.pass).toBe(false);
    expect(bad.failures.join(' ')).toMatch(/dots/);
    // a class under 100 marks gets the wider tolerance, a small one the Poisson allowance
    expect(evaluate(c, { knots: 50 }, { knots: 54 }, t).pass).toBe(true);
    expect(evaluate(c, { stars: 3 }, { stars: 0 }, t).pass).toBe(true);
    expect(evaluate(c, { stars: 3 }, { stars: 0 }, { ...t, poisson: 0 }).pass).toBe(false);
    // none in the reference: none allowed
    expect(evaluate(c, { stars: 0 }, { stars: 1 }, t).pass).toBe(false);
    expect(countAllowance(0, 3, t)).toBe(0);
    // the effective widths: 3 √(ref + render) below 1,000, the relative tolerance above
    expect(countAllowance(720, 774, t)).toBeCloseTo(3 * Math.sqrt(1494), 6);
    expect(countAllowance(9500, 9500, t)).toBeCloseTo(285, 6);
    expect(countAllowance(1016, 1082, t)).toBeCloseTo(30.48, 6);
  });

  it('measures extent and shape: radii, outer ink, axis ratio, position angle', () => {
    const round = blobDots(6000, 6, 400, 400, 30, 800);
    const big = blobDots(6000, 7, 400, 400, 45, 800);
    const m = measure(round);
    expect(m.extent.r25).toBeLessThan(m.extent.r50);
    expect(m.extent.r50).toBeLessThan(m.extent.r90);
    const c = compareMeasures(m, measure(big));
    expect(c.r50Rel).toBeGreaterThan(0.3);
    expect(c.outerDiff).toBeGreaterThan(0.1);
    // an elongated ellipse of ink at 30° (y down)
    const g = grey(400, 400);
    for (let y = 0; y < 400; y++)
      for (let x = 0; x < 400; x++) {
        const dx = x + 0.5 - 200;
        const dy = y + 0.5 - 200;
        const a = (30 * Math.PI) / 180;
        const u = dx * Math.cos(a) + dy * Math.sin(a);
        const v = -dx * Math.sin(a) + dy * Math.cos(a);
        if ((u / 80) ** 2 + (v / 40) ** 2 <= 1) g.data[y * 400 + x] = 1;
      }
    const mo = momentsOf(g, 150, 200, 200);
    expect(mo.q).toBeCloseTo(0.5, 2);
    expect(mo.pa).toBeCloseTo(30, 0);
    expect(radiusAt(extentOf(g, 200, 200), 1)).toBeLessThan(81);
    expect(inkBeyond(extentOf(g, 200, 200), 40)).toBeGreaterThan(0.3);
  });
});

describe('band means', () => {
  it('move continuously where a single order statistic jumps', () => {
    const make = (share: number) =>
      Float32Array.from({ length: 1000 }, (_, i) => (i < share * 1000 ? 2 : 2.236)).sort();
    expect(quantile(make(0.49), 0.5) / quantile(make(0.51), 0.5)).toBeCloseTo(1.118, 3);
    expect(
      Math.abs(bandMean(make(0.49), 0.4, 0.6) / bandMean(make(0.51), 0.4, 0.6) - 1),
    ).toBeLessThan(0.03);
    expect(bandMean([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.4, 0.6)).toBe(5.5);
  });
});
