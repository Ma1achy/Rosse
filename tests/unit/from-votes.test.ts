import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEF } from '../../src/core/params';
import { catalogueCaption } from '../../src/extras/catalogue/caption';
import {
  decodeCatalogueBytes,
  base64ToBytes,
  gunzip,
  type Catalogue,
  type PackedCatalogue,
} from '../../src/extras/catalogue/decode';
import { galaxyAt } from '../../src/extras/catalogue/fields';
import {
  describe as describeGalaxy,
  fromReal,
  fromVotes,
  mulberry32,
  shortType,
  type OddFeature,
  type RealGalaxy,
} from '../../src/extras/from-votes';

const ROOT = join(import.meta.dirname, '../..');
interface Expected {
  real: {
    i: number;
    id: string;
    bare: boolean;
    p: Record<string, unknown>;
    odd: OddFeature | null;
    describe: string;
    shortType: string;
  }[];
  rows: {
    i: number;
    objid: string;
    bare: boolean;
    p: Record<string, unknown>;
    odd: OddFeature | null;
  }[];
  showCat: { i: number; equal?: boolean; caption?: string; showCatError?: string }[];
}
const expected = JSON.parse(
  readFileSync(join(ROOT, 'tests/vectors/from-votes.json'), 'utf8'),
) as Expected;
const real = JSON.parse(
  readFileSync(join(ROOT, 'assets/data/rosse/real-galaxies/real-galaxies.json'), 'utf8'),
) as RealGalaxy[];
const full = (sparse: Record<string, unknown>) => ({ ...DEF, ...sparse });

let cat: Catalogue;
beforeAll(async () => {
  const packed = JSON.parse(
    readFileSync(join(ROOT, 'assets/data/rosse/gz2-catalogue.json'), 'utf8'),
  ) as PackedCatalogue;
  cat = decodeCatalogueBytes(await gunzip(base64ToBytes(packed.b64)), packed.hdr);
}, 60_000);

describe('fromVotes against v21', () => {
  it('has all 42 real galaxies and none of them a star', () => {
    expect(real).toHaveLength(42);
    expect(expected.real).toHaveLength(42);
    expect(expected.real.some((r) => r.bare)).toBe(false);
  });

  it('gives v21 parameters for all 42 real galaxies, exactly', () => {
    real.forEach((g, i) => {
      const want = expected.real[i];
      if (!want) throw new Error(`no expectation for ${String(i)}`);
      expect(g.id).toBe(want.id);
      const got = fromReal(g);
      expect(got.p, `${g.id} parameters`).toEqual(full(want.p));
      expect(got.odd, `${g.id} odd`).toBe(want.odd);
      expect(describeGalaxy(g, got), `${g.id} describe`).toBe(want.describe);
      expect(shortType(got.p, got.odd), `${g.id} shortType`).toBe(want.shortType);
    });
  });

  it('gives v21 parameters for the sampled catalogue rows, exactly', () => {
    expect(expected.rows.length).toBeGreaterThan(300);
    for (const want of expected.rows) {
      const g = galaxyAt(cat, want.i);
      expect(g.objid).toBe(want.objid);
      const got = fromVotes(g.votes, g.q, g.pa, g.windSign, g.seed, g.extras);
      expect(got.p, `row ${String(want.i)}`).toEqual(full(want.p));
      // a star-or-artefact galaxy: v21 returns the bare parameters, so its `odd` is undefined
      expect(got.odd, `row ${String(want.i)} odd`).toBe(want.bare ? null : want.odd);
    }
  });

  it('covers every branch (so the exact match means something)', () => {
    const subjects = new Set(expected.rows.map((r) => r.p.subject ?? 'galaxy'));
    expect(subjects).toEqual(new Set(['galaxy', 'star', 'artefact']));
    const odds = new Set([...expected.rows, ...expected.real].map((r) => r.odd));
    for (const o of ['ring', 'lens', 'disturbed', 'irregular', 'other', 'merger', 'dust', null])
      expect(odds.has(o as OddFeature | null), String(o)).toBe(true);
    const all = [...expected.rows, ...expected.real];
    for (const key of ['merger', 'lensOn', 'shellsOn', 'irr', 'streams', 'jet', 'ovStar', 'whole'])
      expect(
        all.some((r) => r.p[key]),
        key,
      ).toBe(true);
  });

  it('writes the same captions as v21 under the plate (showCat)', () => {
    let n = 0;
    for (const s of expected.showCat) {
      if (s.caption === undefined) {
        // the star-or-artefact rows: v21's showCat fails on them (res.p is undefined)
        expect(s.showCatError).toMatch(/undefined/);
        continue;
      }
      const g = galaxyAt(cat, s.i);
      const res = fromVotes(g.votes, g.q, g.pa, g.windSign, g.seed, g.extras);
      expect(catalogueCaption(g, res).text + 'See the real one on SkyServer ↗').toBe(s.caption);
      n++;
    }
    expect(n).toBe(12);
  });

  it('is pure: the same arguments give equal results, and the inputs are not changed', () => {
    const g = real[20] as RealGalaxy;
    const votes = JSON.stringify(g.votes);
    expect(fromReal(g)).toEqual(fromReal(g));
    expect(JSON.stringify(g.votes)).toBe(votes);
  });

  it('negative control: other votes, angle or seed give other parameters', () => {
    const g = real[20] as RealGalaxy;
    const base = fromReal(g).p;
    const bar = fromVotes({ ...g.votes, bar: 0.9 }, g.q, g.pa, 1, 5, null).p;
    expect(bar).not.toEqual(base);
    expect(fromVotes(g.votes, g.q, g.pa + 30, 1, 5, null).p.pa).not.toBe(
      fromVotes(g.votes, g.q, g.pa, 1, 5, null).p.pa,
    );
    expect(fromVotes(g.votes, g.q, g.pa, 1, 6, null).p).not.toEqual(
      fromVotes(g.votes, g.q, g.pa, 1, 5, null).p,
    );
  });

  it("uses v21's mulberry32 (first values of seed 1)", () => {
    const r = mulberry32(1);
    expect([r(), r(), r()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });
});
