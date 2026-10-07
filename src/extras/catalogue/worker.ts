/**
 * The catalogue worker: unpacks and decodes the 7.3 MB catalogue off the main thread and answers
 * `Request`s (./service.ts). Started by `CatalogueClient` (./client.ts):
 * `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
 */
import { CatalogueService, type Request } from './service';

const service = new CatalogueService();

self.onmessage = (e: MessageEvent<Request>) => {
  void service.handle(e.data).then((reply) => {
    self.postMessage(reply);
  });
};
