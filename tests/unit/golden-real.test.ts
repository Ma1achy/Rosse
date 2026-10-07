import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { GoldenNode, presetParams } from '../../tests/golden/compare/node';
import { fromReal, type RealGalaxy } from '../../src/extras/from-votes';
import { REAL_GALAXIES } from '../../src/extras/real/real-galaxies';
import { cameraOf, orientationOf } from '../../src/view/camera';

const ROOT = join(import.meta.dirname, '../..');

describe('the golden harness and the real galaxies (ADR 0060)', () => {
  it('names a real galaxy as fromReal draws it, at the case seed', () => {
    for (const i of [0, 6, 10, 41]) {
      const P = presetParams(`Real galaxy ${String(i)}`, 586);
      expect(P).toEqual({ ...fromReal(REAL_GALAXIES[i] as RealGalaxy).p, seed: 586 });
    }
  });

  it('still refuses a name that is neither a preset nor a real galaxy', () => {
    expect(() => presetParams('Real galaxy 99', 1)).toThrow();
    expect(() => presetParams('No such preset', 1)).toThrow();
  });

  it('gives a real case its reference options, home included, rather than crashing', () => {
    const node = new GoldenNode(ROOT);
    const rec = node.record('real-galaxy-6--real__s586__home');
    const o = node.referenceOptions(rec.params, rec.zoom ?? 1, rec.preset);
    expect(o.home).toEqual(orientationOf(cameraOf(presetParams('Real galaxy 6', 586))));
    // the orbit capture starts from the same home as the home capture
    const orbit = node.record('real-galaxy-6--real__s586__orbit');
    expect(node.referenceOptions(orbit.params, 1, orbit.preset).home).toEqual(o.home);
  });

  it('draws the re-draws of a real case', () => {
    const node = new GoldenNode(ROOT);
    const r = node.redraws('real-galaxy-6--real__s586__home', 2);
    expect(r).toHaveLength(1);
    expect(r[0]?.counts.dots).toBeGreaterThan(0);
  });
});
