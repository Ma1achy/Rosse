import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  decodeCatalogueBytes,
  gunzip,
  type Catalogue,
  type PackedCatalogue,
} from '../../src/extras/catalogue/decode';
import { fieldValue, galaxyAt, type Field } from '../../src/extras/catalogue/fields';
import { CatalogueService } from '../../src/extras/catalogue/service';
import {
  GALAXY_TYPE_NAMES,
  filter,
  find,
  indexOfObjid,
  nearest,
  ofType,
  randomOf,
} from '../../src/extras/catalogue/tools';

const ROOT = join(import.meta.dirname, '../..');
interface Vectors {
  n: number;
  fields: string[];
  sha256: Record<string, string>;
  typeCounts: Record<string, number>;
  typeFirst: Record<string, number[]>;
  rows: { i: number; objid: string; ra: number; dec: number; bytes: number[] }[];
}
const vectors = JSON.parse(
  readFileSync(join(ROOT, 'tests/vectors/gz2-catalogue.json'), 'utf8'),
) as Vectors;
const sha = (b: Uint8Array): string =>
  createHash('sha256')
    .update(Buffer.from(b.buffer, b.byteOffset, b.byteLength))
    .digest('hex');

let cat: Catalogue;
let packed: PackedCatalogue;
const timing = { base64: 0, gunzip: 0, decode: 0, heapMB: 0 };

beforeAll(async () => {
  packed = JSON.parse(
    readFileSync(join(ROOT, 'assets/data/rosse/gz2-catalogue.json'), 'utf8'),
  ) as PackedCatalogue;
  const t0 = performance.now();
  const bytes = base64ToBytes(packed.b64);
  const t1 = performance.now();
  const raw = await gunzip(bytes);
  const t2 = performance.now();
  cat = decodeCatalogueBytes(raw, packed.hdr);
  const t3 = performance.now();
  Object.assign(timing, { base64: t1 - t0, gunzip: t2 - t1, decode: t3 - t2 });
}, 60_000);

describe('catalogue decode against decode_gz2_catalogue.py', () => {
  it('has the header counts', () => {
    expect(cat.n).toBe(vectors.n);
    expect(cat.n).toBe(239_695);
    expect(Object.keys(cat.cols)).toEqual(vectors.fields);
    expect(cat.objid.length).toBe(cat.n);
  });

  it('matches the checksum of every column, RA, Dec and the ids', () => {
    for (const f of vectors.fields)
      expect(sha(cat.cols[f] as Uint8Array), f).toBe(vectors.sha256[f]);
    const le = (a: Float64Array | BigUint64Array): Uint8Array => new Uint8Array(a.buffer);
    // little-endian hosts only (every platform this runs on)
    expect(sha(le(cat.ra))).toBe(vectors.sha256.ra);
    expect(sha(le(cat.dec))).toBe(vectors.sha256.dec);
    expect(sha(le(cat.objid))).toBe(vectors.sha256.objid);
  });

  it('matches every field of the sampled rows, exactly', () => {
    expect(vectors.rows.length).toBeGreaterThan(200);
    for (const r of vectors.rows) {
      vectors.fields.forEach((f, k) => {
        expect((cat.cols[f] as Uint8Array)[r.i], `${f}[${String(r.i)}]`).toBe(r.bytes[k]);
      });
      expect(cat.ra[r.i]).toBe(r.ra);
      expect(cat.dec[r.i]).toBe(r.dec);
      expect((cat.objid[r.i] as bigint).toString()).toBe(r.objid);
    }
  });

  it('scales the fields as the decode script documents', () => {
    // rows with a known byte pattern: q 0 is missing, wind is signed, the rest follow the table
    const get = (f: Field, i: number) => fieldValue(cat, f, i);
    for (const r of vectors.rows.slice(0, 60)) {
      const b = (f: string) => r.bytes[vectors.fields.indexOf(f)] as number;
      expect(get('smooth', r.i)).toBe(b('smooth') / 15);
      expect(get('q', r.i)).toBe(b('q') ? (b('q') - 1) / 254 : undefined);
      expect(get('pa', r.i)).toBe((b('pa') / 255) * 180);
      expect(get('wind', r.i)).toBe((b('wind') > 127 ? b('wind') - 256 : b('wind')) / 127);
      expect(get('conc', r.i)).toBe(b('conc') ? b('conc') / 60 + 1 : undefined);
      expect(get('r90', r.i)).toBe(b('r90') ? b('r90') / 4 : undefined);
      expect(get('gr', r.i)).toBe(b('gr') ? b('gr') / 170 - 0.3 : undefined);
      expect(get('z', r.i)).toBe(b('z') ? b('z') / 800 : undefined);
      expect(get('fdev', r.i)).toBe(b('fdev') ? (b('fdev') - 1) / 254 : undefined);
    }
  });

  it('rejects a catalogue of the wrong length', () => {
    expect(() => decodeCatalogueBytes(new Uint8Array(10), packed.hdr)).toThrow(/unpacked/);
  });

  it('records the decode cost (printed for docs/milestones/m12)', () => {
    const held =
      (cat.cols.smooth as Uint8Array).buffer.byteLength +
      cat.ra.byteLength * 2 +
      cat.objid.byteLength;
    console.log(
      `catalogue decode in Node: base64 ${timing.base64.toFixed(0)} ms, gunzip ${timing.gunzip.toFixed(0)} ms, columns ${timing.decode.toFixed(0)} ms; held ${(held / 1048576).toFixed(1)} MB`,
    );
    expect(held).toBeLessThan(20 * 1048576);
  });
});

describe('catalogue tools', () => {
  it('types pick the galaxies v21 picks (counts and first matches against numpy masks)', () => {
    for (const t of GALAXY_TYPE_NAMES) {
      expect(ofType(cat, t).length, t).toBe(vectors.typeCounts[t]);
      expect(ofType(cat, t, 5), t).toEqual(vectors.typeFirst[t]);
    }
  });

  it('random picks uniformly among a type, and returns null for none', () => {
    const seq = [0, 0.999999, 0.5];
    let k = 0;
    const rand = () => seq[k++ % 3] as number;
    const all = ofType(cat, 'merger');
    expect(randomOf(cat, 'merger', rand)).toBe(all[0]);
    expect(randomOf(cat, 'merger', rand)).toBe(all[all.length - 1]);
    expect(randomOf(cat, 'merger', rand)).toBe(all[Math.floor(all.length / 2)]);
    const empty: Catalogue = { ...cat, n: 0 };
    expect(randomOf(empty, 'any', rand)).toBeNull();
  });

  it('finds by object id (binary search) and by position', () => {
    for (const i of [0, 1, 1234, 239_694]) {
      expect(indexOfObjid(cat, cat.objid[i] as bigint)).toBe(i);
      const r = find(cat, String(cat.objid[i]));
      expect(r).toEqual({ kind: 'galaxy', index: i });
    }
    expect(indexOfObjid(cat, 1n)).toBe(-1);
    expect(find(cat, '588017703489241361').kind).toMatch(/none|galaxy/);
    const i = 5000;
    const r = find(cat, `${String(cat.ra[i])}, ${String(cat.dec[i])}`);
    expect(r).toEqual({ kind: 'galaxy', index: i });
    expect(nearest(cat, cat.ra[i] as number, cat.dec[i] as number)?.arcsec).toBe(0);
    expect(find(cat, '0, -89.9').kind).toBe('none');
    expect(find(cat, 'M51').kind).toBe('help');
  });

  it('filters by type, field range and cone, with paging', () => {
    const spirals = filter(cat, { type: 'a spiral', limit: 3 });
    expect(spirals.total).toBe(vectors.typeCounts['a spiral']);
    expect(Array.from(spirals.indices)).toEqual(vectors.typeFirst['a spiral']?.slice(0, 3));
    const page2 = filter(cat, { type: 'a spiral', limit: 3, offset: 3 });
    expect(Array.from(page2.indices)).toEqual(ofType(cat, 'a spiral', 6).slice(3));
    const red = filter(cat, { where: [{ field: 'gr', min: 0.9 }], limit: 5 });
    expect(red.total).toBeGreaterThan(0);
    for (const i of red.indices)
      expect(fieldValue(cat, 'gr', i) as number).toBeGreaterThanOrEqual(0.9);
    const near = filter(cat, {
      cone: { ra: cat.ra[100] as number, dec: cat.dec[100] as number, radiusArcsec: 30 },
    });
    expect(Array.from(near.indices)).toContain(100);
    // a galaxy with no value for the field never passes a bound on it
    const noQ = ofType(cat, 'any').find((i) => (cat.cols.q as Uint8Array)[i] === 0);
    if (noQ !== undefined)
      expect(filter(cat, { where: [{ field: 'q', min: 0 }], limit: 1e6 }).indices).not.toContain(
        noQ,
      );
  });

  it('maps a galaxy to the arguments of showCat', () => {
    const g = galaxyAt(cat, 777);
    expect(g.objid).toBe(String(cat.objid[777]));
    expect(g.seed).toBe(Number((cat.objid[777] as bigint) % 9973n) + 1);
    expect(() => galaxyAt(cat, -1)).toThrow(RangeError);
  });
});

describe('catalogue service', () => {
  it('loads from a packed file and answers requests as the worker does', async () => {
    const svc = new CatalogueService();
    const fetcher = (() =>
      Promise.resolve(
        new Response(readFileSync(join(ROOT, 'assets/data/rosse/gz2-catalogue.json'))),
      )) as typeof fetch;
    const stats = await svc.load('x', fetcher);
    expect(stats.n).toBe(239_695);
    expect(stats.heldBytes).toBeLessThan(20 * 1048576);
    const card = svc.card(4242);
    expect(card.galaxy.index).toBe(4242);
    expect(card.mapping.p.seed).toBe(card.galaxy.seed);
    expect(card.caption.text).toContain(card.galaxy.objid);
    expect(card.caption.skyServerUrl).toContain('skyserver.sdss.org');
    const bad = await svc.handle({ id: 9, op: 'card', index: -5 });
    expect(bad).toMatchObject({ id: 9, ok: false });
    const ok = await svc.handle({ id: 10, op: 'find', text: card.galaxy.objid });
    expect(ok).toEqual({ id: 10, ok: true, result: { kind: 'galaxy', index: 4242 } });
    const fresh = new CatalogueService();
    expect(await fresh.handle({ id: 1, op: 'card', index: 0 })).toMatchObject({ ok: false });
  }, 60_000);
});
