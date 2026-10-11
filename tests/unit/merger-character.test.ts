/**
 * A merger keeps its galaxies' character (ADR 0093): with `mergeAuto` a disc holds its inner stars
 * where they started, an elliptical is a soft glow, dust lanes and a bridge thin the stars, and
 * with 0 the marks are v21's (tests/unit/merger-view.test.ts).
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { CpuMerger } from '../../src/fallback/merger';
import { runMergerSprites } from '../../src/fallback/kernels/merger-sprites';
import { mergerViewUniform } from '../../src/model/merger';
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
    expect((mv.ea0 as number[])[3]).toBe(0);
    expect((mv.pa0 as number[])[2]).toBe(0);
  });

  it('holds a spiral’s inner disc, lets an elliptical be a halo, and has dust lanes', () => {
    const { mv } = run(1);
    expect(mv.mauto).toBe(1);
    expect((mv.ea0 as number[])[3]).toBeGreaterThan(0);
    expect((mv.pa0 as number[])[2]).toBeGreaterThan(0);
    expect((mv.ea1 as number[])[3]).toBe(0);
    expect((mv.pa1 as number[])[3]).toBe(1);
  });

  it('moves a spiral’s inner stars toward their own disc, and thins them along the lanes', () => {
    const a = run(0);
    const b = run(1);
    let moved = 0;
    for (let i = 0; i < a.n0; i++)
      if ((a.ic[i * 4 + 2] as number) < 0.2) {
        const d = Math.hypot(
          (a.marks.scr[i * 2] as number) - (b.marks.scr[i * 2] as number),
          (a.marks.scr[i * 2 + 1] as number) - (b.marks.scr[i * 2 + 1] as number),
        );
        if (d > 0.5) moved++;
      }
    expect(moved).toBeGreaterThan(20);
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
