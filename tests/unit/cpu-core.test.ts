import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { CpuEngineCore } from '../../src/fallback/core';
import { CpuRenderer } from '../../src/fallback';
import { CpuStipple } from '../../src/fallback/stipple';
import { buildScene } from '../../src/model/scene';
import { PALETTES } from '../../src/render/palette';
import { SURFACES } from '../../src/render/surface';
import { cameraOf, orientationOf } from '../../src/view/camera';
import { loadAtlases, loadVectors, metaOf } from '../golden/compare/engine-cpu';

const ROOT = new URL('../..', import.meta.url).pathname;
const paper = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(200) };
const size = { plateCss: 200, dpr: 1 };

describe('CpuEngineCore (what the worker runs)', () => {
  const atlases = loadAtlases(ROOT);
  const vectors = loadVectors(ROOT);
  const meta = metaOf(atlases, vectors.penlines, vectors);

  it('draws what the kernels and the rasteriser draw directly', () => {
    const P = presetParams('Grand design', 7);
    const core = new CpuEngineCore(atlases, paper, meta, size);
    core.draw(P, 1);
    const got = core.present('paper', 'ink');

    const r = new CpuRenderer(size, paper);
    atlases.forEach((a) => {
      r.addAtlas(a);
    });
    r.setLayers(new CpuStipple(buildScene(P, meta, {})).view(cameraOf(P, 1)).layers);
    r.drawInk({ plates: 'ink', palette: PALETTES.light });
    const want = r.present(SURFACES.paper);
    expect(got.width).toBe(r.width);
    expect(Buffer.from(got.pixels.buffer).equals(Buffer.from(want.buffer))).toBe(true);
  });

  it('runs the view tier only for a camera move, and nothing for a surface change', () => {
    const P = presetParams('Smooth, round', 7);
    const core = new CpuEngineCore(atlases, paper, meta, size);
    // the overlays' home is the camera the page placed the scene at: it does not move with a drag
    const home = orientationOf(cameraOf(P));
    expect(core.draw(P, 1, home).tiers).toEqual({ model: 1, view: 1 });
    expect(core.draw({ ...P, az: (P.az + 20) % 360 }, 1, home).tiers).toEqual({
      model: 1,
      view: 2,
    });
    const paperFrame = core.present('paper', 'ink');
    const chalkFrame = core.present('chalk', 'ink');
    expect(chalkFrame.pixels).not.toEqual(paperFrame.pixels);
  });

  it('wants a draw before a present, and resizes', () => {
    const core = new CpuEngineCore(atlases, paper, meta, size);
    expect(() => core.present('paper', 'ink')).toThrow();
    core.draw(presetParams('Smooth, round', 7), 1);
    core.resize({ plateCss: 100, dpr: 1 });
    expect(core.present('paper', 'ink').width).toBe(100);
  });

  it('builds a merger once and scrubs it as a view change', () => {
    const P = presetParams('Merger: the Mice', 7);
    const core = new CpuEngineCore(atlases, paper, meta, size);
    const first = core.draw(P, 1);
    expect(first.tiers.model).toBe(1);
    expect(first.counts.dots).toBeGreaterThan(0);
    const scrub = core.draw({ ...P, mTime: 0.4, az: (P.az + 10) % 360 }, 1);
    expect(scrub.tiers.model).toBe(1);
    expect(scrub.tiers.view).toBe(first.tiers.view + 1);
    expect(core.inkLayers.length).toBeGreaterThan(0);
    // a model parameter rebuilds it
    expect(core.draw({ ...P, seed: 8 }, 1).tiers.model).toBe(2);
  }, 120000);
});
