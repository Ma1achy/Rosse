import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { CpuEngineCore } from '../../src/fallback/core';
import { exportSvgCpu, exportSvgOf, infoOfData } from '../../src/extras/export/engine';
import { CpuStipple } from '../../src/fallback/stipple';
import { buildSvg, type ExportLayer } from '../../src/extras/export/svg';
import { buildScene } from '../../src/model/scene';
import { cameraOf, orientationOf } from '../../src/view/camera';
import { loadAtlases, loadVectors, metaOf } from '../golden/compare/engine-cpu';

const ROOT = new URL('../..', import.meta.url).pathname;
const paper = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(200) };
const size = { plateCss: 200, dpr: 1 };
const atlases = loadAtlases(ROOT);
const vectors = loadVectors(ROOT);
const meta = metaOf(atlases, vectors.penlines, vectors);
const quiet = { starMix: 0, field: 0, fgstars: 0 };

describe('the page-level SVG export (ExportSource) on the CPU engine', () => {
  it('gives the same SVG as the direct export, through the core and a source that answers late', async () => {
    const P = presetParams('Grand design', 7, quiet);
    const core = new CpuEngineCore(atlases, paper, meta, size);
    const home = orientationOf(cameraOf(P));
    core.draw(P, 1, home);
    const source = {
      device: () => null,
      // the worker's layers come back by message: a promise
      layers: () =>
        new Promise<typeof core.inkLayers>((ok) => setTimeout(() => ok(core.inkLayers), 5)),
      exportInfo: () => Promise.resolve(infoOfData(core.exportInfo())),
    };
    const got = await exportSvgOf(source);

    const stipple = new CpuStipple(buildScene(P, meta, { home }));
    const direct = exportSvgCpu(stipple, stipple.view(cameraOf(P, 1)));
    expect(got.counts).toEqual(direct.counts);
    expect(got.svg).toBe(direct.svg);
    // the pens' metadata and the seed came through the info, not from the layers
    expect(got.svg).toContain('seed 7');
    expect(got.counts.dust).toBeGreaterThan(50);
  });

  it("carries the seed and the pens of a merger's frame, with no placed-drawing roles", () => {
    const P = presetParams('Merger: the Mice', 11, quiet);
    const core = new CpuEngineCore(atlases, paper, meta, size);
    core.draw(P, 1);
    const info = infoOfData(core.exportInfo());
    expect(info.seed).toBe(11);
    expect(info.roles).toBeUndefined();
    expect(info.hatchCaps).toBe(0);
    expect(info.dotSize.length).toBeGreaterThan(0);
  });

  it('sends a layer that names its SVG layer there, whole, and keeps it out of the hatching', () => {
    const caps = new Float32Array(3 * 12);
    for (let i = 0; i < 3; i++) {
      caps.set([10 * i, 10, 10 * i + 5, 12, 1, 0, 0, 0, 0, 0, 0, 0], i * 12);
    }
    const layer = {
      kind: 'capsules',
      caps,
      count: 3,
      gain: 1,
      svgLayer: 'background',
      hatch: 0,
    } as unknown as ExportLayer;
    const r = buildSvg([layer], { seed: 1, dotSize: [1] });
    expect(r.counts.background).toBeGreaterThan(0);
    expect(r.counts.dust).toBe(0);
  });

  it('gives the ink of the key plate alone, at the size drawn', () => {
    const P = presetParams('Smooth, round', 7, quiet);
    const core = new CpuEngineCore(atlases, paper, meta, { plateCss: 96, dpr: 1 });
    core.draw(P, 1);
    const f = core.inkFrame();
    expect(f.width).toBe(96);
    expect(f.pixels.length).toBe(96 * 96 * 4);
    let ink = 0;
    for (let i = 3; i < f.pixels.length; i += 4) if ((f.pixels[i] ?? 0) > 100) ink++;
    expect(ink).toBeGreaterThan(100);
  });
});
