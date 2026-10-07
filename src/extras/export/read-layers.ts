/**
 * Copies the WebGPU engine's ink layers back to the CPU for an export (src/extras/export/svg.ts):
 * the sprite instances (the compactions' counts from their indirect arguments), the ribbon
 * segments and the capsules, as the CPU forms of the layers. On demand only: a few buffer copies
 * and one wait, never on the frame path (ADR 0003). The buffers are the ones the frame drew from,
 * so the export shows what the plate shows.
 */
import { INSTANCE_LAYOUT, type Instance } from '../../marks/instance';
import { CAPSULE_WORDS, RIBBON_SEG_WORDS } from '../../model/ribbons';
import type { InkLayer } from '../../render/layers';
import type { ExportLayer } from './svg';

/** Copies `size` bytes of `src` from `offset` to the CPU. */
export async function readBuffer(
  device: GPUDevice,
  src: GPUBuffer,
  offset: number,
  size: number,
): Promise<ArrayBuffer> {
  const bytes = Math.max(16, Math.ceil(size / 4) * 4);
  const dst = device.createBuffer({
    label: 'export readback',
    size: bytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = device.createCommandEncoder({ label: 'export readback' });
  enc.copyBufferToBuffer(src, offset, dst, 0, Math.min(bytes, src.size - offset));
  device.queue.submit([enc.finish()]);
  await dst.mapAsync(GPUMapMode.READ);
  const copy = dst.getMappedRange().slice(0, size);
  dst.unmap();
  dst.destroy();
  return copy;
}

/** A draw count from indirect arguments the buffer allows reading, else the layer's own count. */
async function indirectWord(
  device: GPUDevice,
  buffer: GPUBuffer | undefined,
  offset: number,
  word: number,
  fallback: number,
): Promise<number> {
  if (!buffer || !(buffer.usage & GPUBufferUsage.COPY_SRC)) return fallback;
  const a = new Uint32Array(await readBuffer(device, buffer, offset, 16));
  return a[word] ?? 0;
}

/** What every layer carries besides its marks. */
function common(l: InkLayer) {
  return {
    gain: l.gain,
    ...(l.pop ? { pop: l.pop } : {}),
    ...(l.svgLayer ? { svgLayer: l.svgLayer } : {}),
  };
}

function instancesOf(buf: ArrayBuffer, n: number): Instance[] {
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const w = INSTANCE_LAYOUT.size / 4;
  const out: Instance[] = new Array<Instance>(n);
  for (let i = 0; i < n; i++) {
    const o = i * w;
    out[i] = {
      x: f[o] ?? 0,
      y: f[o + 1] ?? 0,
      layer: u[o + 2] ?? 0,
      alpha: f[o + 3] ?? 0,
      m: [f[o + 4] ?? 0, f[o + 5] ?? 0, f[o + 6] ?? 0, f[o + 7] ?? 0],
    };
  }
  return out;
}

/**
 * The frame's layers (`GpuStipple.inkLayers()`) in their CPU forms. A layer already on the CPU
 * (the drawn cores) passes through. Capsule buffers are joined into one layer, the hatching's
 * (the buffer with no indirect count) first, and `hatch` says how many of them it is.
 */
export async function readInkLayers(
  device: GPUDevice,
  layers: readonly InkLayer[],
): Promise<ExportLayer[]> {
  const out: ExportLayer[] = [];
  for (const l of layers) {
    if (l.kind === 'sprites' || l.kind === 'ribbons') out.push(l);
    else if (l.kind === 'capsules') out.push({ ...l, hatch: 0 });
    else if (l.kind === 'gpu-sprites') {
      const s = l.source;
      const cap = Math.floor(s.size / INSTANCE_LAYOUT.size);
      const n = Math.min(cap, await indirectWord(device, s.indirect, s.indirectOffset, 1, cap));
      const buf = await readBuffer(device, s.buffer, s.offset, n * INSTANCE_LAYOUT.size);
      out.push({ ...common(l), kind: 'sprites', atlas: l.atlas, instances: instancesOf(buf, n) });
    } else if (l.kind === 'gpu-ribbons') {
      const buf = await readBuffer(device, l.buffer, 0, l.count * RIBBON_SEG_WORDS * 4);
      out.push({
        ...common(l),
        kind: 'ribbons',
        atlas: 'strokes',
        segs: new Float32Array(buf),
        segsU: new Uint32Array(buf),
        count: l.count,
      });
    } else {
      // capsules: [hatching (static count) | placed (compacted: indirect args [6n, 1, 0, 0])]
      const parts = [{ buffer: l.buffer, count: l.count, indirect: l.indirect }, ...(l.more ?? [])];
      const arrays: Float32Array[] = [];
      let hatch = 0;
      let total = 0;
      for (const p of parts) {
        const n = p.indirect
          ? Math.min(
              p.count,
              Math.floor((await indirectWord(device, p.indirect, 0, 0, 6 * p.count)) / 6),
            )
          : p.count;
        arrays.push(new Float32Array(await readBuffer(device, p.buffer, 0, n * CAPSULE_WORDS * 4)));
        if (!p.indirect) hatch += n;
        total += n;
      }
      const caps = new Float32Array(total * CAPSULE_WORDS);
      let at = 0;
      for (const a of arrays) {
        caps.set(a, at);
        at += a.length;
      }
      out.push({ ...common(l), kind: 'capsules', caps, count: total, hatch });
    }
  }
  return out;
}
