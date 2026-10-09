/**
 * Stars and artefacts (src/model/stars.ts, src/fallback/kernels/star-marks.ts) against v21's own
 * `starSprites` (app23.js:L399–439), cut out of the reference and evaluated as written
 * (tests/golden/compare/v21-stars.ts):
 *
 * 1. **The marks**: with v21's own choices (which stars, where, how bright, the trail, the ghost,
 *    the hits), the engine's kernels make the number of marks of each class v21 makes, where v21's
 *    count is certain (the heart, the spikes, the drawn stars) exactly, and where it is random (the
 *    glare's limit, the rings' noise, a trail's flicker, the ghost's noise) within 4 standard
 *    deviations; and the same radial and angular distributions.
 * 2. **The choices**: the engine's own picks (counter streams, ADR 0004) have v21's distributions
 *    over 2,000 seeds, including the loops whose bound v21 draws afresh at every test.
 * 3. **The overlays**: the home orientation is explicit: a camera at the home draws the overlay
 *    where v21 puts it, and an orbit moves it as a point in the scene.
 */
import { describe, expect, it } from 'vitest';
import type { Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { CpuStipple } from '../../src/fallback/stipple';
import { Cls } from '../../src/model/classes';
import { buildScene } from '../../src/model/scene';
import { describeStars, starJobs, type StarCtxPicks } from '../../src/model/stars';
import { makeVariation } from '../../src/model/variation';
import { cameraOf, orientationOf, scenePoint } from '../../src/view/camera';
import { v21Variation } from '../golden/compare/v21';
import { v21StarMarks, v21StarPicks } from '../golden/compare/v21-stars';
import { META, ROOT, sameCounts, sameMoments } from './support/vectors';

const NO_SKY = { field: 0, fgstars: 0, companions: 0 };

/** v21's lists, and the engine's per-class counts on the same choices. */
function counts(P: Params, zoom = 1) {
  const V = v21Variation(P, META);
  const picks = v21StarPicks(ROOT, P, V, META, zoom);
  const sub = v21StarMarks(ROOT, { ...P }, V, META, zoom).out;
  const scene = buildScene(P, META, { variation: V, starPicks: picks });
  const view = new CpuStipple(scene).view(cameraOf(P, zoom));
  return {
    v21: {
      old: sub.old.length,
      disc: sub.disc.length,
      young: sub.young.length,
      knot: sub.knots.length,
      rstar: sub.rstars.length,
    },
    ours: {
      old: view.perClass[Cls.old] ?? 0,
      disc: view.perClass[Cls.disc] ?? 0,
      young: view.perClass[Cls.young] ?? 0,
      knot: view.perClass[Cls.knot] ?? 0,
      rstar: view.perClass[Cls.rstar] ?? 0,
    },
    scene,
  };
}

function within(name: string, ours: number, v21: number) {
  // a count of independent rejections is within 4 standard deviations of the other draw's
  const sd = Math.sqrt(Math.max(ours, v21, 1));
  expect(
    Math.abs(ours - v21),
    `${name}: ${String(ours)} against v21's ${String(v21)}`,
  ).toBeLessThanOrEqual(4 * sd * Math.SQRT2);
}

describe('the marks of a star or an artefact: the same as v21 makes on the same choices', () => {
  const CASES: [string, Params][] = [
    ['Star: bright, with spikes s7', presetParams('Star: bright, with spikes', 7, NO_SKY)],
    ['Star: bright, with spikes s4242', presetParams('Star: bright, with spikes', 4242, NO_SKY)],
    ['Star: faint s7', presetParams('Star: faint', 7, NO_SKY)],
    ['Artefact: satellite trail s7', presetParams('Artefact: satellite trail', 7, NO_SKY)],
    ['Artefact: ghost reflection s4242', presetParams('Artefact: ghost reflection', 4242, NO_SKY)],
    ['Artefact: cosmic rays s7', presetParams('Artefact: cosmic rays', 7, NO_SKY)],
  ];
  for (const [name, P] of CASES)
    it(name, { timeout: 60_000 }, () => {
      const { v21, ours } = counts(P);
      // the heart's knots, the drawn stars: a certain number
      if (P.artefact !== 'cosmic' || P.subject === 'star') {
        expect(ours.knot, 'knots').toBe(v21.knot);
      } else within('knots (with the hits' + "'" + ' own)', ours.knot, v21.knot);
      expect(ours.rstar, 'drawn stars').toBe(v21.rstar);
      within('old dots', ours.old, v21.old);
      within('disc dots', ours.disc, v21.disc);
      within('young dots', ours.young, v21.young);
    });

  it('at the zoom camera too (the spikes, the bleed column and the trail grow with the zoom)', () => {
    const P = presetParams('Star: bright, with spikes', 7, NO_SKY);
    const { v21, ours } = counts(P, 2);
    expect(ours.knot).toBe(v21.knot);
    within('old', ours.old, v21.old);
    within('disc', ours.disc, v21.disc);
    within('young', ours.young, v21.young);
  });
});

/** The picks of the subject context, from the engine (own) and v21 (replayed). */
function sampleStars(P: (seed: number) => Params, N = 2000) {
  const own: { picks: StarCtxPicks; spike: number }[] = [];
  const ref: { picks: StarCtxPicks; spike: number }[] = [];
  for (let s = 1; s <= N; s++) {
    const p = P(s);
    const V = makeVariation(p, META);
    const D = describeStars(p, V, META);
    const c = D?.ctxs[0]?.picks;
    if (c) own.push({ picks: c, spike: V.spike });
    const Vr = v21Variation(p, META);
    const r = v21StarPicks(ROOT, p, Vr, META).subject;
    if (r) ref.push({ picks: r, spike: Vr.spike });
  }
  return { own, ref };
}

describe("the choices of a star: the engine's own have v21's distributions, over 2,000 seeds", () => {
  it(
    'a star: its fainter neighbours (their number is a loop bound redrawn at each test)',
    { timeout: 300_000 },
    () => {
      const S = sampleStars((s) => presetParams('Star: bright, with spikes', s, NO_SKY));
      const both = (f: (c: StarCtxPicks, spike: number) => number[]) =>
        [
          S.own.flatMap((x) => f(x.picks, x.spike)),
          S.ref.flatMap((x) => f(x.picks, x.spike)),
        ] as const;
      sameCounts('stars', ...both((c) => [c.stars.length]));
      sameMoments('spike direction', ...both((c, sp) => c.stars.map((s) => s.spikeA - sp)));
      sameMoments('neighbour brightness', ...both((c) => c.stars.slice(1).map((s) => s.B)));
      sameMoments('neighbour x', ...both((c) => c.stars.slice(1).map((s) => s.ux)));
      sameMoments('neighbour y', ...both((c) => c.stars.slice(1).map((s) => s.uy)));
      sameCounts('core drawings', ...both((c) => c.stars.map((s) => s.tile)));
    },
  );

  it('a satellite trail', { timeout: 300_000 }, () => {
    const S = sampleStars((s) => presetParams('Artefact: satellite trail', s, NO_SKY));
    const both = (f: (c: StarCtxPicks, spike: number) => number[]) =>
      [
        S.own.flatMap((x) => f(x.picks, x.spike)),
        S.ref.flatMap((x) => f(x.picks, x.spike)),
      ] as const;
    sameMoments('angle', ...both((c) => (c.trail ? [c.trail.ta] : [])));
    sameMoments('offset', ...both((c) => (c.trail ? [c.trail.off] : [])));
    sameCounts('second line', ...both((c) => (c.trail ? [c.trail.dbl ? 1 : 0] : [])));
    sameMoments('gap', ...both((c) => (c.trail?.dbl ? [c.trail.sep] : [])));
    sameMoments('star x', ...both((c) => c.stars.map((s) => s.ux)));
    sameMoments('star brightness', ...both((c) => c.stars.map((s) => s.B)));
  });

  it('a ghost reflection', { timeout: 300_000 }, () => {
    const S = sampleStars((s) => presetParams('Artefact: ghost reflection', s, NO_SKY));
    const both = (f: (c: StarCtxPicks, spike: number) => number[]) =>
      [
        S.own.flatMap((x) => f(x.picks, x.spike)),
        S.ref.flatMap((x) => f(x.picks, x.spike)),
      ] as const;
    sameMoments('angle', ...both((c) => (c.ghost ? [c.ghost.sa] : [])));
    sameMoments('outer radius', ...both((c) => (c.ghost ? [c.ghost.k1] : [])));
    sameMoments('inner radius', ...both((c) => (c.ghost ? [c.ghost.k0] : [])));
    sameMoments('star x', ...both((c) => c.stars.map((s) => s.ux)));
  });

  it(
    'cosmic rays (their number is a loop bound redrawn at each test)',
    { timeout: 300_000 },
    () => {
      const S = sampleStars((s) => presetParams('Artefact: cosmic rays', s, NO_SKY), 400);
      const both = (f: (c: StarCtxPicks, spike: number) => number[]) =>
        [
          S.own.flatMap((x) => f(x.picks, x.spike)),
          S.ref.flatMap((x) => f(x.picks, x.spike)),
        ] as const;
      sameMoments('hits', ...both((c) => [c.cosmic?.length ?? 0]));
      sameMoments('x', ...both((c) => (c.cosmic ?? []).map((h) => h.ux)));
      sameMoments('y', ...both((c) => (c.cosmic ?? []).map((h) => h.uy)));
      sameMoments('angle', ...both((c) => (c.cosmic ?? []).map((h) => h.ha)));
      sameMoments('length', ...both((c) => (c.cosmic ?? []).map((h) => h.hl)));
      sameCounts('knotted', ...both((c) => (c.cosmic ?? []).map((h) => (h.knot ? 1 : 0))));
    },
  );
});

describe('overlays: an explicit home orientation (open question Q3, option b)', () => {
  const P = presetParams('Layered: spiral beside a bright star', 7, NO_SKY);
  const home = orientationOf(cameraOf(P));

  it('at the home camera the star is where v21 puts it, ovStarD from the centre in direction ovStarA', () => {
    const scene = buildScene(P, META, { home });
    const D = scene.stars;
    expect(D?.ctxs.length).toBe(1);
    const cam = cameraOf(P);
    const { jobs } = starJobs(D ?? { ctxs: [], nDrawn: 0 }, P, cam, home);
    const a = (P.ovStarA * Math.PI) / 180;
    // the star's core job (the last of its jobs, kind drawn): its centre is the scene point
    const drawn = jobs.find((j) => j.kind === 5);
    const sp = scenePoint(home, P.ovStarD * Math.cos(a), P.ovStarD * Math.sin(a), 1.4, cam);
    expect(drawn?.c[0]).toBeCloseTo(sp[0], 2);
    expect(drawn?.c[1]).toBeCloseTo(sp[1], 2);
    // at the home itself the scene point is the plate offset (the tilt and the roll cancel)
    expect(drawn?.c[0]).toBeCloseTo(400 + P.ovStarD * Math.cos(a) * 84, 2);
    expect(drawn?.c[1]).toBeCloseTo(400 + P.ovStarD * Math.sin(a) * 84, 2);
  });

  it('an orbit moves the star as a point in the scene; without a home it stays on the plate', () => {
    const orbit = { ...P, az: P.az + 35, incl: P.incl + 20 };
    const cam = cameraOf(orbit);
    const homed = describeStars(P, makeVariation(P, META), META);
    if (!homed) throw new Error('no stars');
    const at = (h: typeof home) => starJobs(homed, orbit, cam, h).jobs.find((j) => j.kind === 5)?.c;
    const fromHome = at(home);
    const pinned = at(orientationOf(cam));
    const a = (P.ovStarA * Math.PI) / 180;
    const expect0 = scenePoint(home, P.ovStarD * Math.cos(a), P.ovStarD * Math.sin(a), 1.4, cam);
    expect(fromHome?.[0]).toBeCloseTo(expect0[0], 2);
    // pinned to the plate (home = the camera itself): the same as at the home camera of that
    // orientation, not moved by the orbit
    const homeOfOrbit = scenePoint(
      orientationOf(cam),
      P.ovStarD * Math.cos(a),
      P.ovStarD * Math.sin(a),
      1.4,
      cam,
    );
    expect(pinned?.[0]).toBeCloseTo(homeOfOrbit[0], 2);
    expect(
      Math.hypot(
        (fromHome?.[0] ?? 0) - (pinned?.[0] ?? 0),
        (fromHome?.[1] ?? 0) - (pinned?.[1] ?? 0),
      ),
    ).toBeGreaterThan(5);
  });

  it('the overlay is a function of the parameters and the home, not of navigation history', () => {
    const orbit = { ...P, az: P.az + 35, incl: P.incl + 20 };
    const cam = cameraOf(orbit);
    // built at the home parameters or at the orbit's, with the same home: the same star
    const A = buildScene(orbit, META, { home }).stars;
    const B = buildScene(P, META, { home }).stars;
    if (!A || !B) throw new Error('no stars');
    const centre = (D: typeof A) => starJobs(D, orbit, cam, home).jobs.find((j) => j.kind === 5)?.c;
    expect(centre(A)).toEqual(centre(B));
    const cpu = new CpuStipple(buildScene(orbit, META, { home })).view(cam);
    expect(cpu.perClass[Cls.rstar]).toBeGreaterThan(0);
  });
});

describe('overlay artefacts stay on the screen; star satellites are in the scene (ADR 0055)', () => {
  const geometry = (name: string, ov: 'trail' | 'cosmic' | 'ghost', zoom: number) => {
    const P = { ...presetParams(name, 7, NO_SKY), ovArtefact: ov, ovStar: 0 };
    const home = orientationOf(cameraOf(P));
    const D = buildScene(P, META, { home }).stars;
    if (!D) throw new Error('no stars');
    const cam = { ...cameraOf(P), zoom };
    return starJobs(D, P, cam, home).jobs.filter((j) => j.kind >= 6);
  };

  it('an overlay trail and cosmic rays are the same at zoom 0.5 and 2', () => {
    for (const ov of ['trail', 'cosmic'] as const) {
      const a = geometry('Layered: spiral beside a bright star', ov, 0.5);
      const b = geometry('Layered: spiral beside a bright star', ov, 2);
      expect(a.length).toBeGreaterThan(0);
      expect(b).toEqual(a);
    }
  });

  it('a subject trail still grows with the zoom', () => {
    const P = presetParams('Artefact: satellite trail', 7, NO_SKY);
    const home = orientationOf(cameraOf(P));
    const D = buildScene(P, META, { home }).stars;
    if (!D) throw new Error('no stars');
    const half = (zoom: number) =>
      starJobs(D, P, { ...cameraOf(P), zoom }, home).jobs.find((j) => j.kind === 6)?.a ?? 0;
    expect(half(2) / half(0.5)).toBeCloseTo(4, 4);
  });

  describe.each([
    ['a subject star', 'Star: bright, with spikes', 0],
    ['an overlay star', 'Layered: spiral beside a bright star', 1],
  ])('%s', (_n, preset, ctxId) => {
    const P = presetParams(preset, 7, NO_SKY);
    const home = orientationOf(cameraOf(P));
    const D = buildScene(P, META, { home }).stars;
    const ctx = D?.ctxs.find((c) => c.id === ctxId);
    const drawn = (cam: ReturnType<typeof cameraOf>) => {
      if (!D) throw new Error('no stars');
      const out = starJobs({ ...D, ctxs: ctx ? [ctx] : [] }, P, cam, home).jobs;
      return {
        centres: out.filter((j) => j.kind === 5).map((j) => j.c),
        spikes: out.filter((j) => j.kind === 2).map((j) => j.p0),
      };
    };

    it('has satellites', () => {
      expect(ctx?.picks.stars.length).toBeGreaterThan(3);
    });

    it('the satellites move against the primary when the camera orbits; the spikes do not turn', () => {
      const cam = cameraOf(P);
      const orbit = { ...cam, incl: cam.incl + 25, az: cam.az + 40 };
      const a = drawn(cam);
      const b = drawn(orbit);
      expect(b.centres.length).toBe(a.centres.length);
      const rel = (d: typeof a, i: number) => [
        (d.centres[i]?.[0] ?? 0) - (d.centres[0]?.[0] ?? 0),
        (d.centres[i]?.[1] ?? 0) - (d.centres[0]?.[1] ?? 0),
      ];
      for (let i = 1; i < a.centres.length; i++) {
        const ra = rel(a, i);
        const rb = rel(b, i);
        expect(
          Math.hypot((ra[0] ?? 0) - (rb[0] ?? 0), (ra[1] ?? 0) - (rb[1] ?? 0)),
        ).toBeGreaterThan(1);
      }
      expect(b.spikes).toEqual(a.spikes);
    });

    it('the satellites scale about the primary with the zoom, at the home camera', () => {
      const cam = cameraOf(P);
      const a = drawn({ ...cam, zoom: 1 });
      const b = drawn({ ...cam, zoom: 2 });
      const d = (x: typeof a) =>
        Math.hypot(
          (x.centres[1]?.[0] ?? 0) - (x.centres[0]?.[0] ?? 0),
          (x.centres[1]?.[1] ?? 0) - (x.centres[0]?.[1] ?? 0),
        );
      expect(d(b) / d(a)).toBeCloseTo(2, 1);
    });
  });
});
