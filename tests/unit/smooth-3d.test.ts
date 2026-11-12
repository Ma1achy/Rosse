/**
 * A smooth galaxy in the scene (ADR 0094): with `bulgeAuto` the round and cigar-shaped galaxies are
 * spheroids the camera moves around, not v21's flat 2D draw that ignores the azimuth. Without it the
 * marks are v21's: the azimuth changes nothing.
 */
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { CpuStipple } from '../../src/fallback/stipple';
import { Cls } from '../../src/model/classes';
import { buildScene } from '../../src/model/scene';
import { cameraOf } from '../../src/view/camera';
import { META } from './support/vectors';

const NO_SKY = { field: 0, fgstars: 0, companions: 0 };

/** The principal axes of the old stars' plate positions at an azimuth: the long over the short, and the long. */
function shape(bulgeAuto: number, az: number) {
  const P = { ...presetParams('Cigar-shaped', 7, NO_SKY), bulgeAuto, az };
  const scene = buildScene(P, META);
  const v = new CpuStipple(scene).view(cameraOf(P));
  const pts: [number, number][] = [];
  for (let i = 0; i < scene.galaxy.g.n; i++)
    if (v.classes[i] === Cls.old)
      pts.push([v.projected[i * 8] as number, v.projected[i * 8 + 1] as number]);
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const tr = (sxx + syy) / n;
  const det = (sxx * syy - sxy * sxy) / (n * n);
  const d = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + d;
  const l2 = tr / 2 - d;
  return { ratio: Math.sqrt(l1 / l2), long: Math.sqrt(l1), n };
}

describe('a cigar-shaped galaxy', () => {
  it('is v21’s flat draw without bulgeAuto: the azimuth does not move it', () => {
    const a = shape(0, 0);
    const b = shape(0, 90);
    expect(a.n).toBeGreaterThan(500);
    expect(Math.abs(b.ratio / a.ratio - 1)).toBeLessThan(0.06);
    expect(Math.abs(b.long / a.long - 1)).toBeLessThan(0.06);
  });

  it('is a cigar in the scene with bulgeAuto: long from the side, round end-on', () => {
    const side = shape(1, 0);
    const end = shape(1, 90);
    expect(side.ratio).toBeGreaterThan(2);
    expect(end.ratio).toBeLessThan(1.5);
    expect(end.long).toBeLessThan(side.long * 0.7);
  });
});
