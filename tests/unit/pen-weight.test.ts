/**
 * Pen weight (ADR 0006, roadmap M5): a vector drawing keeps the pen's width whatever size it is
 * drawn at. The lines of a whole drawing, placed by the parts at zoom 0.5, 1 and 3 (277, 554 and
 * 1,663 plate px across), expanded by the CPU twin of vector-expand.wgsl (equal to the GPU's at
 * L1, tests/gpu/vectors.ts) and rasterised as capsules, measured as the golden metric measures pen
 * weight (test c: the medial-axis widths of α ≥ 0.5, upsampled 4×, band mean of the 40th–60th
 * percentiles): the median stroke width is PEN.line plate px at every zoom, for two pens. The
 * rewound (warped) drawing too.
 */
import { describe, expect, it } from 'vitest';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { CpuRenderer } from '../../src/fallback';
import { runVectors, vectorInputs } from '../../src/fallback/kernels/vector';
import { vectorLayers } from '../../src/fallback/stipple';
import { buildScene } from '../../src/model/scene';
import { vectorView } from '../../src/model/vectors';
import { cameraOf } from '../../src/view/camera';
import { grey, strokeWidths } from '../golden/compare/metrics';
import { META } from './support/vectors';

const ZOOMS = [0.5, 1, 3];

/** The median stroke width (plate px) of the capsules of the scene's drawings at a zoom. */
function medianWidth(P: Params, zoom: number): { median: number; caps: number } {
  const scene = buildScene(P, META);
  const G = scene.galaxy;
  const cam = cameraOf(P, zoom);
  const D = scene.vectors;
  const vv = vectorView(D, P, scene.variation, META, cam, G.g.key, G.g.n_dot_pool);
  const vo = runVectors(vectorInputs(D.lib, vv, G.pool, G.dotBase, G.noise));
  const r = new CpuRenderer(
    { plateCss: 800, dpr: 1 },
    { width: 1, height: 1, data: new Uint8Array(4) },
  );
  // the lines only: the dots and blobs are sprites of the dots and knots sheets
  r.setLayers(vectorLayers(vo, 0, 0));
  r.drawInk();
  const a = grey(800, 800);
  for (let i = 0; i < 800 * 800; i++)
    a.data[i] = Math.round(Math.min(1, r.ink.data[i * 4 + 3] ?? 0) * 255) / 255;
  return { median: strokeWidths(a).median, caps: vo.nCaps };
}

describe('pen weight: a vector drawing keeps PEN.line at every zoom', () => {
  const cases: [string, Params][] = [
    [
      'a whole drawing (smooth), pen 2.4',
      presetParams('Smooth, round', 7, { whole: 1, stipple: 0, field: 0, fgstars: 0 }),
    ],
    [
      'a whole drawing (smooth), pen 4',
      presetParams('Smooth, round', 7, { whole: 1, stipple: 0, field: 0, fgstars: 0, pen: 4 }),
    ],
    [
      'a whole drawing rewound to the pitch (warped), pen 2.4',
      presetParams('Grand design', 23, { whole: 1, lines: 0, stipple: 0, field: 0, fgstars: 0 }),
    ],
  ];
  for (const [name, P] of cases)
    it(name, { timeout: 60_000 }, () => {
      const got = ZOOMS.map((z) => medianWidth(P, z));
      for (const [i, g] of got.entries()) {
        expect(g.caps, `zoom ${String(ZOOMS[i])}: capsules`).toBeGreaterThan(50);
        // within 5% of the pen, where the band mean resolves 1/4 px
        expect(
          Math.abs(g.median - P.pen) / P.pen,
          `zoom ${String(ZOOMS[i])}: median width ${g.median.toFixed(3)} px against PEN.line ${String(P.pen)}`,
        ).toBeLessThan(0.05);
      }
    });
});
