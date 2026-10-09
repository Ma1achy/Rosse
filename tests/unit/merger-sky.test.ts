/**
 * A merger carries the main parameters' own sky and overlays (render(), app23.js:L1232–1234, L1281):
 * the sky's background under the pair, the foreground stars and the overlay star over it, placed once
 * by the real camera, never by a galaxy's own face-on one.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { CpuMerger } from '../../src/fallback/merger';
import { Cls } from '../../src/model/classes';
import { buildMergerScene } from '../../src/model/merger';
import type { InkLayer } from '../../src/render/layers';
import { starJobs } from '../../src/model/stars';
import { cameraOf, scenePoint } from '../../src/view/camera';
import { GoldenNode } from '../golden/compare/node';

const ROOT = resolve(import.meta.dirname, '../..');
const node = new GoldenNode(ROOT);
const NAME = 'Layered: lensed merger';
const base = presetParams(NAME, 7, { lensOn: 0, field: 0.6, fgstars: 0.6, ovStar: 0 });

const isFg = (l: InkLayer) => l.kind === 'sprites' && l.atlas === 'fgstars';
const run = (P: typeof base, zoom = 1) =>
  new CpuMerger(P, node.cpu.meta, node.referenceOptions(P, zoom, NAME).merger).view(zoom);

describe('the merger sky', () => {
  it('has a sky host only when the picture asks for one', () => {
    expect(buildMergerScene(base, node.cpu.meta).skyHost?.sky).toBeTruthy();
    const bare = { ...base, field: 0, fgstars: 0, trails: 0, arrow: 0, jet: 0, streams: 0 };
    expect(buildMergerScene(bare, node.cpu.meta).skyHost).toBeUndefined();
  });

  it('starts with the sky background and ends with the foreground stars', () => {
    const { layers } = run(base);
    const first = layers[0];
    expect(first?.kind === 'sprites' && first.svgLayer).toBe('background');
    const last = layers[layers.length - 1];
    expect(last && isFg(last)).toBe(true);
    expect(layers.filter(isFg)).toHaveLength(1);
  });

  it('draws the sky of the main parameters once, not the galaxies', () => {
    const scene = buildMergerScene(base, node.cpu.meta);
    for (const G of scene.galaxies) expect(G.sky).toBeNull();
    const view = run(base);
    for (const g of view.galaxies) expect(g.layers.some(isFg)).toBe(false);
  });

  it('describes the overlay star once, on the real camera', () => {
    const P = { ...base, ovStar: 0.8 };
    const scene = buildMergerScene(P, node.cpu.meta);
    expect(scene.skyHost?.stars?.ctxs).toHaveLength(1);
    for (const G of scene.galaxies) expect(G.stars).toBeNull();
    // at the home camera it sits ovStarD from the centre in direction ovStarA, as on a single galaxy
    const host = scene.skyHost;
    if (!host?.stars) throw new Error('no overlay');
    const cam = cameraOf(P);
    const drawn = starJobs(host.stars, P, cam, host.home).jobs.find((j) => j.kind === 5);
    const a = (P.ovStarA * Math.PI) / 180;
    const sp = scenePoint(host.home, P.ovStarD * Math.cos(a), P.ovStarD * Math.sin(a), 1.4, cam);
    expect(drawn?.c[0]).toBeCloseTo(sp[0], 2);
    expect(drawn?.c[1]).toBeCloseTo(sp[1], 2);
  });

  it('moves the overlay star with the orbit, as a point in the scene', () => {
    const P = { ...base, ovStar: 0.8 };
    const host = buildMergerScene(P, node.cpu.meta).skyHost;
    if (!host?.stars) throw new Error('no overlay');
    const centre = (Q: typeof P) =>
      starJobs(host.stars ?? { ctxs: [], nDrawn: 0 }, Q, cameraOf(Q), host.home).jobs.find(
        (j) => j.kind === 5,
      )?.c;
    const a = centre(P);
    const b = centre({ ...P, incl: P.incl + 30, az: P.az + 40 });
    expect(
      Math.hypot((a?.[0] ?? 0) - (b?.[0] ?? 0), (a?.[1] ?? 0) - (b?.[1] ?? 0)),
    ).toBeGreaterThan(5);
  });

  it('draws the overlay star among the merger layers', () => {
    const P = { ...base, ovStar: 0.8, field: 0, fgstars: 0 };
    const sstars = (Q: typeof P) => run(Q).perClass[Cls.rstar] ?? 0;
    expect(sstars(P)).toBeGreaterThan(sstars({ ...P, ovStar: 0 }));
  });
});
