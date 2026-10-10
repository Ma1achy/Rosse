import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARAM_KEYS, type Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { SCHEMA, tierOf } from '../../src/core/schema';
import { CpuStippleTiers } from '../../src/fallback/stipple';
import { packGalaxy } from '../../src/model/galaxy';
import { effectiveDust } from '../../src/model/dust';
import { hasDustCulls } from '../../src/model/ribbons';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import type { DrawingsMeta } from '../../src/model/variation';
import { atlasFromBytes, type BuiltIndex } from '../../src/marks/atlas';
import type { VectorSheet } from '../../src/marks/vector';
import { TierState, tierWork } from '../../src/render/tiers';
import { structureKey } from '../../src/view/camera';

/**
 * ADR 0010: the schema's tier tags drive invalidation, and they are true. A camera move inside
 * one incE bucket must leave every model-tier buffer (the scene description and the stipple
 * samples) bit-identical; crossing a bucket rebuilds the model. The GPU half of this test is
 * tests/gpu/tiers.ts.
 */

/**
 * The drawings' metadata, from the packed atlases and the pen lines (`pretest` runs npm run
 * prepare-assets): with the strokes sheet and the pen lines, so that the line-work (curves, lanes,
 * hatches, carving lines) is in the scene, as on the page (review m3).
 */
function meta(): DrawingsMeta {
  const built = resolve(import.meta.dirname, '../../assets-built');
  const idx = JSON.parse(readFileSync(resolve(built, 'index.json'), 'utf8')) as BuiltIndex;
  const atlas = (n: 'dots' | 'knots' | 'stars' | 'cores' | 'strokes') =>
    atlasFromBytes(
      n,
      idx.atlases[n],
      new Uint8Array(readFileSync(resolve(built, idx.atlases[n].file))),
    );
  const penlines = JSON.parse(
    readFileSync(resolve(built, idx.vectors.penlines?.file ?? ''), 'utf8'),
  ) as VectorSheet;
  return drawingsMeta(
    {
      dots: atlas('dots'),
      knots: atlas('knots'),
      stars: atlas('stars'),
      cores: atlas('cores'),
      strokes: atlas('strokes'),
    },
    penlines,
  );
}

const M = meta();
const STIPPLE_ONLY = { lines: 0, knots: 0, envelope: 0, starMix: 0, field: 0, fgstars: 0 };
const sha = (b: ArrayBufferView | ArrayBuffer) =>
  createHash('sha256')
    .update(b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer))
    .digest('hex');

/** Every model-tier buffer of the scene description, the line-work's included, hashed. */
function sceneHash(P: Params): string {
  const { galaxy: G, ribbons: R } = buildScene(P, M);
  return [
    packGalaxy(G.g),
    G.shape,
    G.pool,
    G.dotBase,
    G.groups,
    R.points3,
    R.curveBuf,
    R.hatchBuf,
    R.carve,
  ]
    .map(sha)
    .join(' ');
}

/** Camera moves that stay inside the starting incE bucket. */
function moves(P: Params): { what: string; P: Params; zoom: number }[] {
  const list = [
    { what: 'az + 35', P: { ...P, az: (P.az + 35) % 360 }, zoom: 1 },
    { what: 'pa + 47', P: { ...P, pa: (P.pa + 47) % 360 }, zoom: 1 },
    { what: 'winding mirrored', P: { ...P, winding: -P.winding }, zoom: 1 },
    { what: 'zoom 2', P, zoom: 2 },
    { what: 'zoom 0.15', P, zoom: 0.15 },
    { what: 'zoom 12', P, zoom: 12 },
    { what: 'mTime 0.7', P: { ...P, mTime: 0.7 }, zoom: 1 },
  ];
  for (const d of [-9, -3.15, 2.7, 9, 180 - 2 * P.incl])
    if (
      structureKey({ ...P, incl: P.incl + d }) === structureKey(P) &&
      P.incl + d >= 0 &&
      P.incl + d <= 180
    )
      list.push({ what: `incl ${String(P.incl + d)}`, P: { ...P, incl: P.incl + d }, zoom: 1 });
  return list;
}

describe('tier invalidation (ADR 0010)', () => {
  it('present parameters (plates) leave the scene description unchanged', () => {
    for (const name of ['Grand design', 'Disc, no arms', 'Smooth, round']) {
      const P = presetParams(name, 7);
      expect(tierOf('plates')).toBe('present');
      const h0 = sceneHash(P);
      for (const plates of ['ink', 'slip', 'colour'])
        expect(sceneHash({ ...P, plates }), `${name}: plates ${plates}`).toBe(h0);
      expect(tierWork({ P, zoom: 1 }, { P: { ...P, plates: 'colour' }, zoom: 1 })).toEqual({
        model: false,
        view: false,
      });
    }
  });

  it('follows the schema: model, view (camera, mTime, zoom), present', () => {
    const P = presetParams('Grand design', 7);
    for (const k of PARAM_KEYS) {
      const s = SCHEMA[k];
      const v = P[k];
      const changed =
        s.kind === 'number'
          ? (v as number) === s.max
            ? s.min
            : s.max
          : (s.options.find((o) => o !== v) ?? v);
      if (changed === v) continue;
      // an inclination change across a bucket is a model change; keep this one inside it
      const b = k === 'incl' ? { ...P, incl: P.incl + 1 } : { ...P, [k]: changed };
      const w = tierWork({ P, zoom: 1 }, { P: b, zoom: 1 });
      const t = tierOf(k);
      expect(w, k).toEqual({ model: t === 'model', view: t !== 'present' });
    }
    expect(tierWork({ P, zoom: 1 }, { P, zoom: 1 })).toEqual({ model: false, view: false });
    expect(tierWork({ P, zoom: 1 }, { P, zoom: 2 })).toEqual({ model: false, view: true });
    expect(
      tierWork({ P: { ...P, incl: 60 }, zoom: 1 }, { P: { ...P, incl: 75 }, zoom: 1 }),
    ).toEqual({ model: true, view: true });
    expect(tierWork(null, { P, zoom: 1 })).toEqual({ model: true, view: true });
    expect(tierWork({ P, zoom: 1, modelKey: 'a' }, { P, zoom: 1, modelKey: 'b' }).model).toBe(true);
  });

  it('runs only the stages that changed, and rebuilds after a failure', () => {
    const t = new TierState();
    const P = presetParams('Ringed', 7);
    const log: string[] = [];
    const stages = { model: () => log.push('model'), view: () => log.push('view') };
    t.run({ P, zoom: 1 }, stages);
    t.run({ P: { ...P, az: 10 }, zoom: 1 }, stages);
    t.run({ P: { ...P, az: 10 }, zoom: 1 }, stages);
    t.run({ P: { ...P, az: 10, arms: 3 }, zoom: 1 }, stages);
    expect(log).toEqual(['model', 'view', 'view', 'model', 'view']);
    expect(t.runs).toEqual({ model: 2, view: 3 });
    expect(() =>
      t.run(
        { P, zoom: 1 },
        {
          model: () => {
            throw new Error('lost');
          },
          view: () => undefined,
        },
      ),
    ).toThrow();
    log.length = 0;
    t.run({ P, zoom: 1 }, stages);
    expect(log).toEqual(['model', 'view']);
  });

  it('view parameters are true to their tag: the scene description does not depend on them', () => {
    for (const name of ['Grand design', 'Edge-on with dust', 'Disc, no arms', 'Smooth, round']) {
      const P = presetParams(name, 7);
      const h0 = sceneHash(P);
      for (const m of moves(P)) expect(sceneHash(m.P), `${name}: ${m.what}`).toBe(h0);
    }
  });

  it('natural dust is model data: orbit and zoom leave its scene description alone (ADR 0075)', () => {
    for (const name of ['Grand design', 'Edge-on with dust', 'Disc, no arms']) {
      const P = presetParams(name, 7, { dustAuto: 1 });
      const h0 = sceneHash(P);
      for (const m of moves(P)) expect(sceneHash(m.P), `${name}: ${m.what}`).toBe(h0);
    }
    // and it is a model change when it is switched on or off, for a galaxy that carries any
    const P = presetParams('Grand design', 7);
    expect(sceneHash({ ...P, dustAuto: 1 })).not.toBe(sceneHash(P));
    expect(tierWork({ P, zoom: 1 }, { P: { ...P, dustAuto: 1 }, zoom: 1 }).model).toBe(true);
  });

  it('the natural star spread is model data: orbit and zoom leave it alone, switching it rebuilds (ADR 0077)', () => {
    const P = presetParams('Grand design', 7, { starsAuto: 1, starMix: 1 });
    const h0 = sceneHash(P);
    for (const m of moves(P)) expect(sceneHash(m.P), m.what).toBe(h0);
    expect(sceneHash({ ...P, starsAuto: 0 })).not.toBe(h0);
    expect(tierWork({ P, zoom: 1 }, { P: { ...P, starsAuto: 0 }, zoom: 1 }).model).toBe(true);
  });

  it('the natural bulge is model data: orbit and zoom leave it alone, switching it rebuilds (ADR 0076)', () => {
    const P = presetParams('Grand design', 7, { bulgeAuto: 1 });
    const h0 = sceneHash(P);
    for (const m of moves(P)) expect(sceneHash(m.P), m.what).toBe(h0);
    expect(sceneHash({ ...P, bulgeAuto: 0 })).not.toBe(h0);
    expect(tierWork({ P, zoom: 1 }, { P: { ...P, bulgeAuto: 0 }, zoom: 1 }).model).toBe(true);
  });
});

describe('the CPU engine: orbiting changes no model buffer (hashes)', () => {
  const cases: [string, Params][] = [
    ['Smooth, round (stipple) s7', presetParams('Smooth, round', 7, STIPPLE_ONLY)],
    ['Disc, no arms (stipple) s4242', presetParams('Disc, no arms', 4242, STIPPLE_ONLY)],
    ['Grand design s7', presetParams('Grand design', 7)],
    ['Edge-on with dust s7 (incl 88, the dust cull)', presetParams('Edge-on with dust', 7)],
    ['Dusty spiral s4242 (lanes and carving lines)', presetParams('Dusty spiral', 4242)],
    ['Barred spiral s7 (ring knots, ring lane)', presetParams('Barred spiral', 7)],
    // the natural dust (ADR 0075) is model data: a camera move leaves it alone
    [
      'Grand design s7, natural dust (incl 35)',
      presetParams('Grand design', 7, { dustAuto: 1, incl: 35 }),
    ],
    // the natural bulge (ADR 0076) is model data too
    [
      'Grand design s7, natural bulge and dust (incl 60)',
      presetParams('Grand design', 7, { bulgeAuto: 1, dustAuto: 1, incl: 60 }),
    ],
    [
      'Barred spiral s7, natural dust, edge-on (lane, carving, the cull)',
      presetParams('Barred spiral', 7, { dustAuto: 1, incl: 88 }),
    ],
  ];
  for (const [name, P] of cases)
    it(name, () => {
      const eng = new CpuStippleTiers(M);
      const first = eng.frame(P, 1);
      const stipple = eng.stipple;
      if (!stipple) throw new Error('no model');
      const h0 = sha(stipple.samples.f32);
      const pos0 = sha(first.view.projected);
      const cls0 = sha(first.view.classes);
      const total = (c: Uint32Array) => c.reduce((a, b) => a + b, 0);
      const n0 = total(first.view.perClass);
      for (const m of moves(P)) {
        const { view, work } = eng.frame(m.P, m.zoom);
        expect(work, m.what).toEqual({ model: false, view: true });
        expect(eng.stipple, m.what).toBe(stipple);
        expect(sha(stipple.samples.f32), m.what).toBe(h0);
        if (m.what !== 'mTime 0.7') expect(sha(view.projected), m.what).not.toBe(pos0);
        // without dust (extinction, lanes, carving lines) nothing is culled by the view, so the
        // count cannot change
        if (!effectiveDust(P) && !hasDustCulls(stipple.scene.ribbons))
          expect(total(view.perClass), m.what).toBe(n0);
        // and back: the culls are pure functions of the camera, so returning restores every
        // sample's class exactly, lanes and carving lines included (review m3)
        const back = eng.frame(P, 1);
        expect(back.work, `${m.what} and back`).toEqual({ model: false, view: true });
        expect(sha(back.view.classes), `${m.what} and back`).toBe(cls0);
      }
      expect(eng.tiers.runs.model).toBe(1);
      // across a bucket: the model is rebuilt, once
      const across = { ...P, incl: structureKey({ ...P, incl: 75 }) === structureKey(P) ? 30 : 75 };
      expect(eng.frame(across, 1).work).toEqual({ model: true, view: true });
      expect(eng.frame({ ...across, az: 3 }, 1).work).toEqual({ model: false, view: true });
      expect(eng.tiers.runs.model).toBe(2);
      // the stipple itself does not depend on the inclination (no incE use in M2's kernels)
      expect(sha(eng.stipple?.samples.f32 ?? new Float32Array(0))).toBe(h0);
    });
});
