/**
 * The page's side of the catalogue worker. The integration surface for M11's UI:
 *
 * ```ts
 * import catalogueUrl from '../../assets/data/rosse/gz2-catalogue.json?url';
 * const cat = new CatalogueClient();
 * const stats = await cat.load(catalogueUrl);     // first use: unpacks 239,695 galaxies
 * const i = await cat.random('barred');           // an index, or null
 * const card = await cat.card(i);                 // params (card.mapping.p), caption, link
 * // draw: params = card.mapping.p (a full `Params`), as for a preset
 * ```
 *
 * Every call resolves with the worker's reply or rejects with its error message. Load on the first
 * use of the catalogue (v21's `loadCat`), not at page start.
 */
import type { GalaxyCard, LoadStats, Reply, Request } from './service';
import type { FindResult, GalaxyType, Query, QueryResult } from './tools';

type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never;

export class CatalogueClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { ok: (v: unknown) => void; err: (e: Error) => void }
  >();

  constructor(worker?: Worker) {
    this.worker = worker ?? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.ok(e.data.result);
      else p.err(new Error(e.data.error));
    };
  }

  private call<T>(req: Distribute<Request>): Promise<T> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('the catalogue worker is closed'));
    const id = this.nextId++;
    return new Promise<T>((ok, err) => {
      this.pending.set(id, { ok: ok as (v: unknown) => void, err });
      worker.postMessage({ ...req, id });
    });
  }

  /** Fetch and decode the catalogue at `url` (once). */
  load(url: string): Promise<LoadStats> {
    return this.call({ op: 'load', url });
  }
  /** One galaxy with its drawing parameters and caption. */
  card(index: number): Promise<GalaxyCard> {
    return this.call({ op: 'card', index });
  }
  /** A random galaxy of a type (v21's buttons), or null if there is none. */
  random(type: GalaxyType): Promise<number | null> {
    return this.call({ op: 'random', type });
  }
  /** A DR7 object id, or "RA, Dec" in degrees. */
  find(text: string): Promise<FindResult> {
    return this.call({ op: 'find', text });
  }
  /** Type, field ranges and a cone; paged. */
  filter(query: Query): Promise<QueryResult> {
    return this.call({ op: 'filter', query });
  }

  /** Stop the worker and free the catalogue. */
  close(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.err(new Error('the catalogue worker is closed'));
    this.pending.clear();
  }
}
