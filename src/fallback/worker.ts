/**
 * The CPU engine in a worker (ADR 0071): the same `CpuEngineCore` the tests run, behind messages,
 * so that the model tier, the view tier, the rasteriser and the composite never block the page's
 * main thread. Requests are handled in order; a frame's pixels go back as a transferred buffer.
 */
import { CpuEngineCore } from './core';
import { loadCpuAssets } from './assets';
import type { CpuReply, CpuRequest } from './protocol';

let core: CpuEngineCore | null = null;
const need = () => {
  if (!core) throw new Error('the CPU engine was not initialised');
  return core;
};

async function handle(m: CpuRequest): Promise<{ reply: CpuReply; transfer?: Transferable[] }> {
  switch (m.op) {
    case 'init': {
      const a = await loadCpuAssets(m.base);
      core = new CpuEngineCore(a.atlases, a.paper, a.meta, m.size);
      return { reply: { id: m.id, ok: true, op: 'init' } };
    }
    case 'draw':
      return { reply: { id: m.id, ok: true, op: 'draw', ...need().draw(m.P, m.zoom) } };
    case 'resize':
      need().resize(m.size);
      return { reply: { id: m.id, ok: true, op: 'resize' } };
    case 'layers':
      return { reply: { id: m.id, ok: true, op: 'layers', layers: need().inkLayers } };
    case 'present': {
      const f = need().present(m.surface, m.plates);
      return {
        reply: { id: m.id, ok: true, op: 'present', ...f },
        transfer: [f.pixels.buffer],
      };
    }
  }
}

// one request at a time, in arrival order (init is async)
let chain: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<CpuRequest>) => {
  chain = chain.then(async () => {
    try {
      const { reply, transfer } = await handle(e.data);
      postMessage(reply, { transfer: transfer ?? [] });
    } catch (err) {
      const reply: CpuReply = {
        id: e.data.id,
        ok: false,
        error: String(err instanceof Error ? (err.stack ?? err.message) : err),
      };
      postMessage(reply);
    }
  });
};
