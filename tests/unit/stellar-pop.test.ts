/**
 * Stellar populations (ADR 0090): with `popAuto` the stipple clumps, old stars are drawn finer than
 * young ones, a halo holds globular clusters and star sizes spread wider; off, v21's.
 */
import { describe, expect, it } from 'vitest';
import { randF32 } from '../../src/core/rng';
import { Stream } from '../../src/core/streams';
import { streamOrbit, streamPoint } from '../../src/model/stream-orbits';
import { DEF } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { SCHEMA } from '../../src/core/schema';
import { runStipple } from '../../src/fallback/kernels/stipple';
import { Cls } from '../../src/model/classes';
import { GalaxyFlag } from '../../src/model/galaxy';
import { buildScene } from '../../src/model/scene';
import { META } from './support/vectors';

const run = (name: string, popAuto: number) => {
  const P = presetParams(name, 7, { popAuto, field: 0, stars: 30000, starMix: 1, starsAuto: 1 });
  const G = buildScene(P, META).galaxy;
  return { G, s: runStipple(G) };
};

describe('popAuto', () => {
  it('is off in the core and sets its flag only when on', () => {
    expect(DEF.popAuto).toBe(0);
    expect(SCHEMA.popAuto).toMatchObject({ kind: 'choice', tier: 'model' });
    expect(run('Grand design', 0).G.g.flags & GalaxyFlag.popAuto).toBe(0);
    expect(run('Grand design', 1).G.g.flags & GalaxyFlag.popAuto).not.toBe(0);
  });

  it('draws young dots larger than old ones, where v21 drew the same', () => {
    const mean = (popAuto: number, cls: number) => {
      const { s } = run('Grand design', popAuto);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < s.n; i++)
        if (((s.u32[i * 8 + 3] ?? 0) & 255) === cls) {
          sum += s.f32[i * 8 + 5] ?? 0;
          n++;
        }
      return sum / Math.max(1, n);
    };
    const ratio = (p: number) => mean(p, Cls.young) / mean(p, Cls.old);
    expect(ratio(1)).toBeGreaterThan(1.4 * ratio(0));
  });

  it('puts globular clusters in the halo: tight swarms, not a smooth falloff', () => {
    const fullest = (popAuto: number) => {
      const P = presetParams('Smooth, round', 7, { popAuto, halo: 1, field: 0, stars: 40000 });
      const s = runStipple(buildScene(P, META).galaxy);
      const cell = new Map<string, number>();
      for (let i = 0; i < s.n; i++) {
        const x = s.f32[i * 8] ?? 0;
        const y = s.f32[i * 8 + 1] ?? 0;
        // out where only the halo is
        if (((s.u32[i * 8 + 3] ?? 0) & 255) === 255 || Math.hypot(x, y) < 1.5) continue;
        const k = `${String(Math.round(x / 0.3))},${String(Math.round(y / 0.3))}`;
        cell.set(k, (cell.get(k) ?? 0) + 1);
      }
      return Math.max(...cell.values());
    };
    expect(fullest(1)).toBeGreaterThan(1.5 * fullest(0));
  });

  it('spaces the stipple on a jittered grid: stars sit nearer their cell anchors than chance', () => {
    const meanOffset = (popAuto: number) => {
      const P = presetParams('Barred spiral', 7, { popAuto, field: 0, stars: 30000 });
      const G = buildScene(P, META).galaxy;
      const s = runStipple(G);
      const h = 0.045;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < s.n; i++) {
        if (((s.u32[i * 8 + 3] ?? 0) & 255) === 255) continue;
        const x = s.f32[i * 8] ?? 0;
        const y = s.f32[i * 8 + 1] ?? 0;
        const cx = Math.floor(x / h);
        const cy = Math.floor(y / h);
        const cell = ((cx + 4096) * 8192 + (cy + 4096)) >>> 0;
        const ax = (cx + randF32(G.g.key, Stream.clumps, cell, 0)) * h;
        const ay = (cy + randF32(G.g.key, Stream.clumps, cell, 1)) * h;
        sum += Math.hypot(x - ax, y - ay) / h;
        n++;
      }
      return sum / n;
    };
    expect(meanOffset(1)).toBeLessThan(meanOffset(0) - 0.03);
  });

  it('adds a faint thick disc: old stars out in the disc, high above the plane', () => {
    const share = (popAuto: number) => {
      const P = presetParams('Disc, no arms', 7, { popAuto, field: 0, stars: 30000, halo: 0 });
      const G = buildScene(P, META).galaxy;
      const s = runStipple(G);
      let n = 0;
      let old = 0;
      for (let i = 0; i < s.n; i++) {
        const cls = (s.u32[i * 8 + 3] ?? 0) & 255;
        const R = Math.hypot(s.f32[i * 8] ?? 0, s.f32[i * 8 + 1] ?? 0);
        if (cls === 255 || R < 1.5) continue;
        n++;
        // an old star out in the disc is a thick-disc star: v21 has none there
        if (cls === Cls.old && Math.abs(s.f32[i * 8 + 2] ?? 0) > 2 * G.g.thick) old++;
      }
      return old / n;
    };
    expect(share(1)).toBeGreaterThan(share(0) + 0.02);
  });

  it('lays halo stars along the streams the strokes draw', () => {
    const near = (popAuto: number) => {
      const P = presetParams('Disc, no arms', 7, {
        popAuto,
        lineWorld: 1,
        streams: 0.4,
        halo: 1,
        field: 0,
        stars: 40000,
      });
      const G = buildScene(P, META).galaxy;
      expect(G.g.n_stream).toBe(popAuto ? 1 : 0);
      const o = streamOrbit(P.seed, 0);
      const arc = Array.from({ length: 80 }, (_, k) => streamPoint(o, k / 79, 0, 0));
      const s = runStipple(G);
      let n = 0;
      let on = 0;
      for (let i = 0; i < s.n; i++) {
        if (((s.u32[i * 8 + 3] ?? 0) & 255) === 255) continue;
        n++;
        const p = [s.f32[i * 8] ?? 0, s.f32[i * 8 + 1] ?? 0, s.f32[i * 8 + 2] ?? 0];
        if (
          arc.some(
            (a) => Math.hypot(a[0] - (p[0] ?? 0), a[1] - (p[1] ?? 0), a[2] - (p[2] ?? 0)) < 0.12,
          )
        )
          on++;
      }
      return on / n;
    };
    expect(near(1)).toBeGreaterThan(3 * near(0));
  });
});
