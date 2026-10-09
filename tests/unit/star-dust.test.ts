/**
 * The dust in front of an overlay star dims the whole star (ADR 0074): `starJobs` gives every
 * star job the `keep = exp(−tau)` of the galaxy's own dustTau (src/fallback/kernels/project.ts) for
 * the star's place in the galaxy's frame along the line of sight, and the star-marks kernel keeps
 * each mark with that probability, one draw per mark, so the glare, the spikes, the rings and the
 * heart thin by the same share. The GPU = CPU comparison of the thinned classes is
 * tests/gpu/starmarks.ts.
 */
import { describe, expect, it } from 'vitest';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { CpuStipple } from '../../src/fallback/stipple';
import { dustTau } from '../../src/fallback/kernels/project';
import { Cls } from '../../src/model/classes';
import { buildScene } from '../../src/model/scene';
import { StarKind, satelliteDepth, starJobs, type StarJob } from '../../src/model/stars';
import { makeVariation } from '../../src/model/variation';
import { cameraOf, orientationOf, rotationOf, sceneGalaxyPoint } from '../../src/view/camera';
import { META } from './support/vectors';

const NO_SKY = { field: 0, fgstars: 0, companions: 0 };
const f = Math.fround;
const SPIRAL = 'Layered: spiral beside a bright star';

/** The scene of a dusty spiral with its overlay star near the centre, and the cameras either side. */
function setup(dust: number) {
  const P0: Params = { ...presetParams(SPIRAL, 7, NO_SKY), dust, ovStarD: 0.5 };
  const home = orientationOf(cameraOf(P0));
  const variation = makeVariation(P0, META);
  const a = (P0.ovStarA * Math.PI) / 180;
  const at = [P0.ovStarD * Math.cos(a), P0.ovStarD * Math.sin(a), 1.4] as const;
  const g = sceneGalaxyPoint(home, ...at);
  // the line of sight to the viewer crosses the disc from the star when the star is below it and the
  // view is from above (cos i > 0), or the other way round
  const behind: Params = { ...P0, incl: g[2] < 0 ? 60 : 120 };
  const front: Params = { ...P0, incl: g[2] < 0 ? 120 : 60 };
  return { P0, home, variation, at, g, behind, front };
}

const primaryOf = (jobs: StarJob[]) =>
  jobs.slice(0, jobs.findIndex((j) => j.kind === StarKind.drawn) + 1);

describe('keep, the share of an overlay star the dust lets through', () => {
  const S = setup(0.9);
  const jobsOf = (P: Params, dust: number) => {
    const scene = buildScene(P, META, { home: S.home, variation: S.variation });
    if (!scene.stars) throw new Error('no stars');
    return starJobs(scene.stars, P, cameraOf(P), S.home, dust).jobs;
  };

  it('is 1 everywhere with no dust, in every job', () => {
    const jobs = jobsOf({ ...S.behind, dust: 0 }, 0);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.keep === 1)).toBe(true);
  });

  it('is exp(−tau) of the shared dustTau for the star behind the disc, below 1', () => {
    expect(S.g[2] === 0 ? 0 : Math.abs(S.g[2])).toBeGreaterThan(0.06);
    const jobs = primaryOf(jobsOf(S.behind, 0.9));
    const tau = dustTau(S.g[0], S.g[1], S.g[2], f(rotationOf(cameraOf(S.behind)).ci), 0.9);
    expect(tau).toBeGreaterThan(0.5);
    expect(jobs.length).toBeGreaterThan(3);
    for (const j of jobs) expect(j.keep).toBe(f(Math.exp(-tau)));
    expect(jobs[0]?.keep).toBeLessThan(0.5);
  });

  it('is 1 for the star on the near side of the disc', () => {
    for (const j of primaryOf(jobsOf(S.front, 0.9))) expect(j.keep).toBe(1);
  });

  it('is 1 where there is no galaxy (the galaxy dust passed is 0), and for a subject star', () => {
    for (const j of jobsOf(S.behind, 0)) expect(j.keep).toBe(1);
    const P = { ...presetParams('Star: bright, with spikes', 7, NO_SKY), dust: 0.9 };
    const home = orientationOf(cameraOf(P));
    const D = buildScene(P, META, { home }).stars;
    if (!D) throw new Error('no stars');
    for (const j of starJobs(D, P, cameraOf(P), home, 0.9).jobs) expect(j.keep).toBe(1);
  });

  it('is 1 for the artefacts (trail, cosmic rays, ghost disc)', () => {
    for (const ov of ['trail', 'cosmic', 'ghost'] as const) {
      const P: Params = { ...S.behind, ovStar: 0, ovArtefact: ov };
      const jobs = jobsOf(P, 0.9).filter((j) => j.kind >= StarKind.trail);
      expect(jobs.length).toBeGreaterThan(0);
      for (const j of jobs) expect(j.keep).toBe(1);
    }
  });

  it('is each satellite’s own, from its own place in the galaxy’s frame', () => {
    const scene = buildScene(S.behind, META, { home: S.home, variation: S.variation });
    const ctx = scene.stars?.ctxs[0];
    if (!ctx?.place) throw new Error('no overlay star');
    const jobs = jobsOf(S.behind, 0.9);
    const drawn = jobs.filter((j) => j.kind === StarKind.drawn);
    expect(drawn.length).toBe(ctx.picks.stars.length);
    const ci = f(rotationOf(cameraOf(S.behind)).ci);
    const keeps = ctx.picks.stars.map((s, i) => {
      const p = ctx.place ?? { x: 0, y: 0, depth: 0 };
      const g = i
        ? sceneGalaxyPoint(S.home, p.x + s.ux, p.y + s.uy, p.depth + satelliteDepth(s))
        : sceneGalaxyPoint(S.home, p.x, p.y, p.depth);
      return f(Math.exp(-dustTau(g[0], g[1], g[2], ci, 0.9)));
    });
    expect(drawn.map((j) => j.keep)).toEqual(keeps);
    expect(new Set(keeps).size).toBeGreaterThan(1);
    // every job of a star carries its star's keep
    const per: number[] = [];
    let k = -1;
    for (const j of jobs) {
      if (j.kind === StarKind.heart) k++;
      per.push(j.keep - (keeps[k] ?? NaN));
    }
    expect(per.every((d) => d === 0)).toBe(true);
  });
});

describe('the marks the dust leaves, by kind', () => {
  const S = setup(0.9);
  const view = (P: Params) => {
    const scene = buildScene(P, META, { home: S.home, variation: S.variation });
    const v = new CpuStipple(scene).view(cameraOf(P));
    return { scene, v, n: scene.galaxy.g.n + scene.galaxy.g.n_extra };
  };

  it('with no dust the star is as without the extinction (every mark the kernel makes is kept)', () => {
    const clear = view({ ...S.behind, dust: 0 });
    const dusty = view(S.behind);
    // dust 0 keeps every mark the dusty run keeps, and the dusty run keeps no mark the clear one lacks
    let more = 0;
    for (let i = clear.n; i < clear.v.classes.length; i++) {
      const c = clear.v.classes[i] ?? 0;
      const d = dusty.v.classes[i - clear.n + dusty.n] ?? 0;
      if (d < 255 && c >= 255) more++;
    }
    expect(more).toBe(0);
  });

  it('thins the glare, the spikes, the rings and the heart by the same share, keep', () => {
    const clear = view({ ...S.behind, dust: 0 });
    const dusty = view(S.behind);
    const scene = dusty.scene;
    if (!scene.stars) throw new Error('no stars');
    const jobs = primaryOf(starJobs(scene.stars, S.behind, cameraOf(S.behind), S.home, 0.9).jobs);
    const keep = jobs[0]?.keep ?? 1;
    expect(keep).toBeLessThan(0.5);
    const live = (x: ReturnType<typeof view>, j: StarJob) => {
      let k = 0;
      for (let s = j.first; s < j.first + j.n; s++)
        if ((x.v.classes[x.n + s] ?? 255) < Cls.rstar) k++;
      return k;
    };
    const kinds = [StarKind.heart, StarKind.glare, StarKind.spike, StarKind.ring];
    for (const kind of kinds) {
      const js = jobs.filter((j) => j.kind === kind);
      const n0 = js.reduce((a, j) => a + live(clear, j), 0);
      const n1 = js.reduce((a, j) => a + live(dusty, j), 0);
      expect(n0, `kind ${String(kind)} made marks`).toBeGreaterThan(30);
      // a binomial share: within 4 standard deviations of keep
      const sd = Math.sqrt((keep * (1 - keep)) / n0);
      expect(
        Math.abs(n1 / n0 - keep),
        `kind ${String(kind)}: ${String(n1)}/${String(n0)}`,
      ).toBeLessThan(4 * sd);
    }
  });
});
