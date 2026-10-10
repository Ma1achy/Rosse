/**
 * The jet, the stellar streams and the tidal tail as bundles of 3D strokes (ADR 0089), with
 * `lineWorld`: they have width and depth, where v21 drew one pen line or one stretched sprite.
 */
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { buildScene } from '../../src/model/scene';
import { ROOT } from './support/vectors';
import { GoldenNode } from '../golden/compare/node';

// the meta with the strokes sheet, so that the line-work is in the scene
const META = new GoldenNode(ROOT).cpu.meta;

const roles = (over: object) => {
  const P = presetParams('Grand design', 7, { jet: 1, streams: 0.8, tail: 0.8, ...over });
  const R = buildScene(P, META).ribbons;
  const by = (role: string) => R.curves.filter((c) => c.role === role);
  return { jet: by('jet'), stream: by('stream'), tail: by('tail') };
};

describe('strands', () => {
  it('draw a bundle for each of the jet, the streams and the tail with lineWorld', () => {
    const r = roles({ lineWorld: 1 });
    expect(r.jet.length).toBeGreaterThan(20);
    expect(r.stream.length).toBe(14);
    expect(r.tail.length).toBe(11);
  });

  it("leave v21's one tail curve, and no jet or stream strokes, without it", () => {
    const r = roles({ lineWorld: 0 });
    expect(r.jet).toHaveLength(0);
    expect(r.stream).toHaveLength(0);
    expect(r.tail).toHaveLength(1);
  });

  it('open out and rise off the plane: the jet widens and the tail lifts', () => {
    const r = roles({ lineWorld: 1 });
    const spread = (pts: number[][], k: number) => Math.hypot(pts[k]?.[0] ?? 0, pts[k]?.[1] ?? 0);
    const tip = r.jet.map((c) => c.pts[c.pts.length - 1] as number[]);
    expect(Math.max(...tip.map((p) => Math.abs(p[2] ?? 0)))).toBeGreaterThan(1);
    expect(spread(r.tail[0]?.pts ?? [], 60)).toBeGreaterThan(spread(r.tail[0]?.pts ?? [], 0));
    expect(Math.max(...r.tail.flatMap((c) => c.pts.map((p) => Math.abs(p[2]))))).toBeGreaterThan(
      0.1,
    );
  });

  it('are tuned by the sliders: a bigger tail and jet have more, longer strands', () => {
    const lo = roles({ lineWorld: 1, tail: 0.2, jet: 0.2 });
    const hi = roles({ lineWorld: 1, tail: 1, jet: 1 });
    expect(hi.tail.length).toBeGreaterThan(lo.tail.length);
    expect(hi.jet.length).toBeGreaterThan(lo.jet.length);
    const reach = (c: { pts: number[][] }[]) =>
      Math.max(...c.map((x) => Math.hypot(...((x.pts[x.pts.length - 1] ?? [0])))));
    expect(reach(hi.tail)).toBeGreaterThan(1.3 * reach(lo.tail));
    expect(reach(hi.jet)).toBeGreaterThan(2 * reach(lo.jet));
    expect(roles({ lineWorld: 1, jet: 0 }).jet).toHaveLength(0);
  });

  it('is deterministic', () => {
    expect(roles({ lineWorld: 1 }).jet.map((c) => c.pts)).toEqual(
      roles({ lineWorld: 1 }).jet.map((c) => c.pts),
    );
  });
});
