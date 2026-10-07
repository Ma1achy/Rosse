/**
 * The ink of a frame as premultiplied RGBA8, from each engine's ink target, for the GIF
 * (./record.ts). The CPU engine's ink buffer is f32; the WebGPU engine's target is rgba16float and
 * is read back (src/gpu/readback.ts), once per frame, on the export path only.
 */
import type { InkBuffer } from '../../fallback';
import { readTexture } from '../../gpu/readback';

const to8 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** The CPU engine's ink buffer as RGBA8. */
export function cpuInkFrame(ink: InkBuffer): Uint8ClampedArray {
  const out = new Uint8ClampedArray(ink.width * ink.height * 4);
  for (let i = 0; i < out.length; i++) out[i] = to8(ink.data[i] ?? 0);
  return out;
}

/** IEEE half to number. */
function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** The WebGPU engine's ink target (rgba16float) as RGBA8. */
export async function gpuInkFrame(device: GPUDevice, ink: GPUTexture): Promise<Uint8ClampedArray> {
  const half = new Uint16Array((await readTexture(device, ink, 8)).buffer);
  const out = new Uint8ClampedArray(half.length);
  for (let i = 0; i < half.length; i++) out[i] = to8(halfToFloat(half[i] ?? 0));
  return out;
}
