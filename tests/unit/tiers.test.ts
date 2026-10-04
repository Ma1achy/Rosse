import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARAM_KEYS, type Params } from '../../src/core/params';
import { presetParams } from '../../src/core/presets';
import { SCHEMA, tierOf } from '../../src/core/schema';
import { CpuStippleTiers } from '../../src/fallback/stipple';
import { packGalaxy } from '../../src/model/galaxy';
import { hasDustCulls } from '../../src/model/ribbons';
import { buildScene } from '../../src/model/scene';
import type { DrawingsMeta } from '../../src/model/variation';
import { TierState, tierWork } from '../../src/render/tiers';
import { inclBucket } from '../../src/view/camera';

/**
 * ADR 0010: the schema's tier tags drive invalidation, and they are true. A camera move inside
 * one incE bucket must leave every model-tier buffer (the scene description and the stipple
 * samples) bit-identical; crossing a bucket rebuilds the model. The GPU half of this test is
 * tests/gpu/tiers.ts.
 */

/** The drawings' metadata, from the packed atlases (`pretest` runs npm run prepare-assets). */
function meta(): DrawingsMeta {
  const idx = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../assets-built/index.json'), 'utf8'),
  ) as { atlases: Record<string, { layers: number; meta: Record<string, unknown[]> }> };
  const get = (n: string) => {
    const x = idx.atlases[n];
    if (!x) throw new Error(n);
    return x;
  };
  return {
    dots: { src: get('dots').meta.src as string[], size: get('dots').meta.size as number[] },
    knots: { count: get('knots').layers },
    stars: { count: get('stars').layers },
    cores: { kind: get('cores').meta.kind as string[], style: get('cores').meta.style as string[] },
  };
}

const M = meta();
const STIPPLE_ONLY = { lines: 0, knots: 0, envelope: 0, starMix: 0, field: 0, fgstars: 0 };
const sha = (b: ArrayBufferView | ArrayBuffer) =>
  createHash('sha256')
    .update(b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer))
    .digest('hex');

/** Every model-tier buffer of the scene description, hashed. */
function sceneHash(P: Params): string {
  const G = buildScene(P, M).galaxy;
  return [packGalaxy(G.g), G.shape, G.pool, G.dotBase].map(sha).join(' ');
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
    if (inclBucket(P.incl + d) === inclBucket(P.incl) && P.incl + d >= 0 && P.incl + d <= 180)
      list.push({ what: `incl ${String(P.incl + d)}`, P: { ...P, incl: P.incl + d }, zoom: 1 });
  return list;
}

describe('tier invalidation (ADR 0010)', () => {
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
});

describe('the CPU engine: orbiting changes no model buffer (hashes)', () => {
  const cases: [string, Params][] = [
    ['Smooth, round (stipple) s7', presetParams('Smooth, round', 7, STIPPLE_ONLY)],
    ['Disc, no arms (stipple) s4242', presetParams('Disc, no arms', 4242, STIPPLE_ONLY)],
    ['Grand design s7', presetParams('Grand design', 7)],
    ['Edge-on with dust s7 (incl 88, the dust cull)', presetParams('Edge-on with dust', 7)],
  ];
  for (const [name, P] of cases)
    it(name, () => {
      const eng = new CpuStippleTiers(M);
      const first = eng.frame(P, 1);
      const stipple = eng.stipple;
      if (!stipple) throw new Error('no model');
      const h0 = sha(stipple.samples.f32);
      const pos0 = sha(first.view.projected);
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
        if (!P.dust && !hasDustCulls(stipple.scene.ribbons))
          expect(total(view.perClass), m.what).toBe(n0);
      }
      expect(eng.tiers.runs.model).toBe(1);
      // across a bucket: the model is rebuilt, once
      const across = { ...P, incl: inclBucket(P.incl) === inclBucket(75) ? 30 : 75 };
      expect(eng.frame(across, 1).work).toEqual({ model: true, view: true });
      expect(eng.frame({ ...across, az: 3 }, 1).work).toEqual({ model: false, view: true });
      expect(eng.tiers.runs.model).toBe(2);
      // the stipple itself does not depend on the inclination (no incE use in M2's kernels)
      expect(sha(eng.stipple?.samples.f32 ?? new Float32Array(0))).toBe(h0);
    });
});
