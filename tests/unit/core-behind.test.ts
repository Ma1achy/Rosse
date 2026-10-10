/** The drawn core behind the disc (ADR 0092): `coreAuto` 0 is v21's, 1 a core drawn first, under the disc. */
import { describe, expect, it } from 'vitest';
import { DEF } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { SCHEMA } from '../../src/core/schema';
import { CpuStipple } from '../../src/fallback/stipple';
import { CORE_BEHIND_ALPHA, coreAlpha } from '../../src/model/parts';
import { buildScene } from '../../src/model/scene';
import { cameraOf } from '../../src/view/camera';
import { META } from './support/vectors';

const coreIndex = (coreAuto: number) => {
  const P = presetParams('Grand design', 7, { coreAuto, field: 0, fgstars: 0 });
  const layers = new CpuStipple(buildScene(P, META)).view(cameraOf(P)).layers;
  const at = layers.findIndex((l) => l.kind === 'sprites' && l.atlas === 'cores');
  const alpha = (layers[at] as { instances: { alpha: number }[] } | undefined)?.instances[0]?.alpha;
  return { at, n: layers.length, alpha };
};

describe('coreAuto', () => {
  it('is off by default, a model-tier choice', () => {
    expect(DEF.coreAuto).toBe(0);
    expect(SCHEMA.coreAuto).toMatchObject({ kind: 'choice', tier: 'model' });
    expect(coreAlpha(presetParams('Grand design', 7))).toBe(1);
    expect(CORE_BEHIND_ALPHA).toBe(1);
    expect(coreAlpha(presetParams('Grand design', 7, { coreAuto: 1 }))).toBe(CORE_BEHIND_ALPHA);
  });

  it('keeps v21: the core is the last of the galaxy’s layers, opaque', () => {
    const c = coreIndex(0);
    expect(c.alpha).toBe(1);
    expect(c.at).toBeGreaterThan(c.n / 2);
  });

  it('draws the core first, still opaque, under the disc’s marks', () => {
    const on = coreIndex(1);
    const off = coreIndex(0);
    expect(on.alpha).toBe(CORE_BEHIND_ALPHA);
    expect(on.at).toBeLessThan(off.at);
    expect(on.at).toBeLessThan(3);
    expect(on.n).toBe(off.n);
  });
});
