/**
 * The catalogue service: the requests the page can make, as a plain class over a decoded
 * catalogue. `./worker.ts` runs one in a Web Worker and `./client.ts` talks to it; the class
 * itself needs no worker, so Node tests it directly.
 */
import { catalogueCaption, type Caption } from './caption';
import {
  base64ToBytes,
  decodeCatalogueBytes,
  gunzip,
  type Catalogue,
  type PackedCatalogue,
} from './decode';
import { galaxyAt, type CatalogueGalaxy } from './fields';
import { fromVotes, type FromVotes } from '../from-votes';
import {
  GALAXY_TYPE_NAMES,
  filter,
  find,
  randomOf,
  type FindResult,
  type GalaxyType,
  type Query,
  type QueryResult,
} from './tools';

/** A galaxy with what Rosse makes of it: its parameters and the words. */
export interface GalaxyCard {
  galaxy: CatalogueGalaxy;
  mapping: FromVotes;
  caption: Caption;
}

/** What the decode cost, for the phone concern (docs/milestones/m12/README.md). */
export interface LoadStats {
  n: number;
  /** Milliseconds: fetch, JSON parse and base64 (`parse`), gunzip, column decode, and the sum. */
  ms: { parse: number; gunzip: number; decode: number; total: number };
  /** Bytes held by the decoded catalogue (columns, RA, Dec, ids). */
  heldBytes: number;
  /** the JS heap in use after the load, where the browser says (Chromium's `performance.memory`) */
  heapBytes?: number;
}

/** The requests of the worker protocol (`id` is the caller's, echoed in the reply). */
export type Request =
  | { id: number; op: 'load'; url: string }
  | { id: number; op: 'card'; index: number }
  | { id: number; op: 'random'; type: GalaxyType }
  | { id: number; op: 'find'; text: string }
  | { id: number; op: 'filter'; query: Query };

export type Reply =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** The packed file's header and its bytes (base64 decoded); the text is not kept. */
function unpack(text: string): { hdr: PackedCatalogue['hdr']; bytes: Uint8Array } {
  const packed = JSON.parse(text) as PackedCatalogue;
  return { hdr: packed.hdr, bytes: base64ToBytes(packed.b64) };
}

function heapNow(): { heapBytes?: number } {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? { heapBytes: m.usedJSHeapSize } : {};
}

export class CatalogueService {
  cat: Catalogue | null = null;

  /** Fetch, unpack and decode the packed catalogue at `url`. */
  async load(url: string, fetcher: typeof fetch = fetch): Promise<LoadStats> {
    const t0 = performance.now();
    const res = await fetcher(url);
    if (!res.ok) throw new Error(`the catalogue did not load (${String(res.status)})`);
    // the text and the parsed object die inside `unpack`, before the gunzip allocates
    const { hdr, bytes } = unpack(await res.text());
    const t1 = performance.now();
    const raw = await gunzip(bytes);
    const t3 = performance.now();
    this.cat = decodeCatalogueBytes(raw, hdr);
    const t4 = performance.now();
    return {
      n: this.cat.n,
      ms: { parse: t1 - t0, gunzip: t3 - t1, decode: t4 - t3, total: t4 - t0 },
      ...heapNow(),
      heldBytes: heldBytes(this.cat),
    };
  }

  private need(): Catalogue {
    if (!this.cat) throw new Error('the catalogue is not loaded');
    return this.cat;
  }

  card(index: number): GalaxyCard {
    const g = galaxyAt(this.need(), index);
    const mapping = fromVotes(g.votes, g.q, g.pa, g.windSign, g.seed, g.extras);
    return { galaxy: g, mapping, caption: catalogueCaption(g, mapping) };
  }

  random(type: GalaxyType, rand: () => number = Math.random): number | null {
    if (!GALAXY_TYPE_NAMES.includes(type)) throw new Error(`unknown type ${type}`);
    return randomOf(this.need(), type, rand);
  }

  find(text: string): FindResult {
    return find(this.need(), text);
  }

  filter(q: Query): QueryResult {
    return filter(this.need(), q);
  }

  /** The worker's dispatcher: one request, one reply. */
  async handle(req: Request): Promise<Reply> {
    try {
      switch (req.op) {
        case 'load':
          return { id: req.id, ok: true, result: await this.load(req.url) };
        case 'card':
          return { id: req.id, ok: true, result: this.card(req.index) };
        case 'random':
          return { id: req.id, ok: true, result: this.random(req.type) };
        case 'find':
          return { id: req.id, ok: true, result: this.find(req.text) };
        case 'filter':
          return { id: req.id, ok: true, result: this.filter(req.query) };
      }
    } catch (e) {
      return {
        id: req.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

/** Bytes the decoded catalogue holds (the columns share one buffer). */
export function heldBytes(c: Catalogue): number {
  const col = c.cols[c.fields[0] as string] as Uint8Array;
  return col.buffer.byteLength + c.ra.byteLength + c.dec.byteLength + c.objid.byteLength;
}
