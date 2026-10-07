/**
 * The catalogue in a real Web Worker, in Chromium (milestone M12): the worker decodes the packed
 * catalogue (fetch, JSON, base64, gunzip, columns) and answers cards, finds, random picks and
 * filters; every sampled row of tests/vectors/gz2-catalogue.json (from decode_gz2_catalogue.py)
 * comes back exactly, the types count what the numpy masks count, and the cost is reported (time
 * per step and heap, for the phone concern in docs/milestones/m12/README.md). The columns'
 * SHA-256 checksums are checked on a decode in the page, with Chromium's own `crypto.subtle`.
 */
import catalogueUrl from '../../assets/data/rosse/gz2-catalogue.json?url';
import { CatalogueClient } from '../../src/extras/catalogue/client';
import {
  base64ToBytes,
  decodeCatalogueBytes,
  gunzip,
  type PackedCatalogue,
} from '../../src/extras/catalogue/decode';
import { GALAXY_TYPE_NAMES } from '../../src/extras/catalogue/tools';
import vectors from '../vectors/gz2-catalogue.json';
import { run } from './harness';

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

run('catalogue worker (decode, tools, cost)', async () => {
  const lines: string[] = [];
  let pass = true;
  const fail = (s: string) => {
    pass = false;
    lines.push(`FAIL ${s}`);
  };

  const client = new CatalogueClient();
  const t0 = performance.now();
  const stats = await client.load(catalogueUrl);
  const wall = performance.now() - t0;
  lines.push(
    `worker load: ${wall.toFixed(0)} ms wall (fetch+parse ${stats.ms.parse.toFixed(0)}, gunzip ${stats.ms.gunzip.toFixed(0)}, columns ${stats.ms.decode.toFixed(0)}); held ${(stats.heldBytes / 1048576).toFixed(1)} MB; JS heap ${stats.heapBytes === undefined ? 'not reported' : `${(stats.heapBytes / 1048576).toFixed(1)} MB`}`,
  );
  if (stats.n !== vectors.n) fail(`n ${String(stats.n)}`);

  for (const r of vectors.rows) {
    const card = await client.card(r.i);
    const g = card.galaxy;
    if (g.objid !== r.objid || g.ra !== r.ra || g.dec !== r.dec)
      fail(`row ${String(r.i)}: id, RA or Dec differ`);
    vectors.fields.forEach((f, k) => {
      const want = r.bytes[k] as number;
      if (f === 'nvotes' && g.n !== want) fail(`row ${String(r.i)} nvotes`);
      if (f === 'smooth' && g.votes.smooth !== want / 15) fail(`row ${String(r.i)} smooth`);
      if (f === 'spiral' && g.votes.spiral !== want / 15) fail(`row ${String(r.i)} spiral`);
    });
  }
  lines.push(
    `${String(vectors.rows.length)} sampled rows through the worker match decode_gz2_catalogue.py`,
  );

  for (const t of GALAXY_TYPE_NAMES) {
    const got = (await client.filter({ type: t, limit: 1 })).total;
    const want = (vectors.typeCounts as Record<string, number>)[t];
    if (got !== want) fail(`type ${t}: ${String(got)} against ${String(want)}`);
    const i = await client.random(t);
    if (i === null || i < 0 || i >= stats.n) fail(`random ${t}`);
  }
  const f = await client.find(vectors.rows[5]?.objid ?? '');
  if (f.kind !== 'galaxy' || f.index !== vectors.rows[5]?.i) fail('find by object id');
  lines.push('types, random, find and filter answer as the numpy masks do');
  client.close();

  // checksums of every column, on a decode in the page
  const packed = (await (await fetch(catalogueUrl)).json()) as PackedCatalogue;
  const t1 = performance.now();
  const cat = decodeCatalogueBytes(await gunzip(base64ToBytes(packed.b64)), packed.hdr);
  lines.push(`main-thread decode ${(performance.now() - t1).toFixed(0)} ms`);
  const copy = async (a: Uint8Array) => sha256(new Uint8Array(a));
  for (const name of vectors.fields) {
    const got = await copy(cat.cols[name] as Uint8Array);
    if (got !== (vectors.sha256 as Record<string, string>)[name]) fail(`checksum of ${name}`);
  }
  for (const [name, a] of [
    ['ra', cat.ra],
    ['dec', cat.dec],
    ['objid', cat.objid],
  ] as const) {
    const got = await copy(new Uint8Array(a.buffer));
    if (got !== (vectors.sha256 as Record<string, string>)[name]) fail(`checksum of ${name}`);
  }
  lines.push(`${String(vectors.fields.length + 3)} column checksums match`);
  return { pass, lines };
});
