/**
 * Stellar populations (ADR 0090): with `popAuto` the stipple clumps, old stars are drawn finer than
 * young ones, a halo holds globular clusters and star sizes spread wider; off, v21's.
 */
import { describe, expect, it } from 'vitest';
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
});
