/**
 * A merger keeps its galaxies' character (ADR 0093): with `mergeAuto` an elliptical is a soft glow,
 * dust lanes and a bridge thin the stars, and every star stays where the simulation puts it (nothing
 * is pinned to its start, so the discs rotate and the tides tear them); with 0 the marks are v21's (tests/unit/merger-view.test.ts).
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { CpuMerger } from '../../src/fallback/merger';
import { runMergerSprites } from '../../src/fallback/kernels/merger-sprites';
import { mergerViewUniform } from '../../src/model/merger';
import { CpuMergerStars, simUniform } from '../../src/fallback/kernels/merger';
import { Cls } from '../../src/model/classes';
import { GoldenNode } from '../golden/compare/node';

const node = new GoldenNode(resolve(import.meta.dirname, '../..'));

const run = (mergeAuto: number, extra = {}) => {
  const P = presetParams('Merger: spiral meets elliptical', 7, { mergeAuto, dust: 0.5, ...extra });
  const m = new CpuMerger(P, node.cpu.meta, node.referenceOptions(P, 1).merger);
  const fr = m.view(1).framing;
  const mv = mergerViewUniform(m.scene, fr, 1);
  mv.keep_dots = 1;
  const marks = runMergerSprites(
    mv,
    m.stars.blend(fr.sel),
    m.stars.ic,
    m.scene.pool,
    m.scene.dotBase,
  );
  return { mv, marks, n0: m.scene.desc.n[0], total: m.scene.desc.total, ic: m.stars.ic };
};

describe('mergeAuto in the merger kernels', () => {
  it('is off in the uniform without it', () => {
    const { mv } = run(0);
    expect(mv.mauto).toBe(0);
    expect((mv.pa0 as number[])[2]).toBe(0);
  });

  it('gives a spiral dust lanes, lets an elliptical be a halo, and has dust lanes', () => {
    const { mv } = run(1);
    expect(mv.mauto).toBe(1);
    expect((mv.pa0 as number[])[2]).toBeGreaterThan(0);
    expect((mv.pa1 as number[])[3]).toBe(1);
  });

  it('thins a spiral’s stars along the lanes', () => {
    const a = run(0);
    const b = run(1);
    const live = (r: typeof a, from: number, to: number) => {
      let k = 0;
      for (let i = from * 12; i < to * 12; i++) if (r.marks.classes[i] !== Cls.none) k++;
      return k;
    };
    // the spiral loses stars to the lanes; the elliptical (no lanes) keeps its dots and gains from
    // the denser halo
    expect(live(b, 0, b.n0)).toBeLessThan(live(a, 0, a.n0));
    expect(live(b, b.n0, b.total)).toBeGreaterThanOrEqual(live(a, b.n0, a.total));
  });
});

describe('the dark halo (ADR 0096)', () => {
  const stars = (mergeAuto: number) => {
    const P = presetParams('Merger: spiral meets elliptical', 7, { mergeAuto });
    const m = new CpuMerger(P, node.cpu.meta, node.referenceOptions(P, 1).merger);
    return { d: m.scene.desc, s: m.stars };
  };

  it('is off without mergeAuto, and a mass-scaled pull with it', () => {
    const a = simUniform(stars(0).d);
    const b = simUniform(stars(1).d);
    expect(a.h0).toBe(0);
    expect(a.h1).toBe(0);
    expect(b.h0).toBeGreaterThan(0);
    expect(b.h1).toBeGreaterThan(0);
    expect((b.h0 as number) / (b.m0 as number)).toBeCloseTo((b.h1 as number) / (b.m1 as number), 5);
  });

  it('starts the outer disc faster than the point mass alone gives: a flatter rotation curve', () => {
    // the mean of a star's speed about its core over the point mass's circular speed at its radius,
    // for the first galaxy's stars past half its radius, at the start
    const ratio = (mergeAuto: number) => {
      const { d } = stars(mergeAuto);
      const S = new CpuMergerStars(d);
      S.init();
      const G = d.gals[0];
      let sum = 0;
      let n = 0;
      for (let i = 0; i < G.count; i++) {
        const rn = S.ic[i * 4 + 2] as number;
        if (rn < 0.5) continue;
        const R = rn * G.rmax;
        const q = R * R + G.soft * G.soft;
        const vp = Math.sqrt((G.mass * R * R) / (q * Math.sqrt(q)));
        // the speed in the disc's plane about the core (the core's own velocity taken off)
        sum +=
          Math.hypot(
            (S.vs[i * 4] as number) - G.core[3],
            (S.vs[i * 4 + 1] as number) - G.core[4],
            (S.vs[i * 4 + 2] as number) - G.core[5],
          ) / vp;
        n++;
      }
      return sum / n;
    };
    expect(ratio(0)).toBeCloseTo(1, 1);
    expect(ratio(1)).toBeGreaterThan(1.1);
  });
});

describe('the gas (ADR 0098)', () => {
  const sim = (mergeAuto: number) => {
    const P = presetParams('Merger: the Mice', 7, { mergeAuto });
    const m = new CpuMerger(P, node.cpu.meta, node.referenceOptions(P, 1).merger);
    return { d: m.scene.desc, s: m.stars };
  };

  it('is off without mergeAuto and a share of the disc stars with it, never an elliptical’s', () => {
    const a = sim(0);
    expect(simUniform(a.d).gas).toBe(0);
    expect(Array.from({ length: a.d.total }, (_, i) => a.s.isGas(i)).some(Boolean)).toBe(false);
    const b = sim(1);
    expect(simUniform(b.d).gas).toBeGreaterThan(0);
    let g = 0;
    for (let i = 0; i < b.d.total; i++) if (b.s.isGas(i)) g++;
    expect(g / b.d.total).toBeGreaterThan(0.2);
    expect(g / b.d.total).toBeLessThan(0.4);
    const e = presetParams('Merger: spiral meets elliptical', 7, { mergeAuto: 1 });
    const me = new CpuMerger(e, node.cpu.meta, node.referenceOptions(e, 1).merger);
    let ge = 0;
    for (let i = me.scene.desc.n[0]; i < me.scene.desc.total; i++) if (me.stars.isGas(i)) ge++;
    expect(ge).toBe(0);
  });

  it('sinks toward the nuclei: at the horizon the gas is nearer a core than the stars are', () => {
    const { d, s } = sim(1);
    s.run();
    const k = Math.max(d.track.future.steps, 0);
    const core = (g: number) => {
      const o = (d.off.pos2 + k * 2 + g) * 4;
      return [d.cores[o] as number, d.cores[o + 1] as number, d.cores[o + 2] as number];
    };
    const c = [core(0), core(1)];
    const med = (gas: boolean) => {
      const r: number[] = [];
      for (let i = 0; i < d.total; i++) {
        if (s.isGas(i) !== gas) continue;
        const x = [
          s.horizon[i * 4] as number,
          s.horizon[i * 4 + 1] as number,
          s.horizon[i * 4 + 2] as number,
        ];
        r.push(Math.min(...c.map((q) => Math.hypot(...x.map((v, a) => v - (q[a] as number))))));
      }
      return r.sort((p, q) => p - q)[Math.floor(r.length / 2)] as number;
    };
    expect(med(true)).toBeLessThan(0.85 * med(false));
  });
});
