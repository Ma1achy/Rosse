/**
 * Shared helpers for the browser test pages in tests/gpu/, run by tools/gpu-test/run.mjs
 * (`npm run test:gpu`) on Chromium with SwiftShader WebGPU. A page reports once through
 * `window.__gpuTest`, which the runner waits for.
 */

export interface GpuTestResult {
  name: string;
  pass: boolean;
  /** summary lines, printed by the runner */
  lines: string[];
  /** anything else worth keeping in the JSON report */
  data?: unknown;
}

declare global {
  interface Window {
    __gpuTest?: GpuTestResult;
  }
}

export function report(result: GpuTestResult): void {
  window.__gpuTest = result;
  const pre = document.createElement('pre');
  pre.textContent = `${result.name}: ${result.pass ? 'PASS' : 'FAIL'}\n${result.lines.join('\n')}`;
  document.body.append(pre);
}

/** Runs a test body, turning exceptions into a failed result. */
export function run(name: string, body: () => Promise<Omit<GpuTestResult, 'name'>>): void {
  body().then(
    (r) => {
      report({ name, ...r });
    },
    (e: unknown) => {
      report({ name, pass: false, lines: [String(e instanceof Error ? (e.stack ?? e) : e)] });
    },
  );
}

export async function device(): Promise<{ adapter: GPUAdapter; device: GPUDevice }> {
  const { requestDevice } = await import('../../src/gpu/device');
  const r = await requestDevice(navigator);
  r.device.addEventListener('uncapturederror', (e) => {
    console.error('WebGPU error:', e.error.message);
  });
  return r;
}

export function adapterName(adapter: GPUAdapter): string {
  const i = adapter.info;
  return [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' / ');
}

/** Reads a whole 2D texture back: rows tightly packed, `bytesPerPixel` each. */
export async function readTexture(
  device: GPUDevice,
  texture: GPUTexture,
  bytesPerPixel: number,
): Promise<Uint8Array> {
  const { width, height } = texture;
  const row = width * bytesPerPixel;
  const stride = Math.ceil(row / 256) * 256;
  const buffer = device.createBuffer({
    size: stride * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride }, [width, height]);
  device.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) out.set(src.subarray(y * stride, y * stride + row), y * row);
  buffer.unmap();
  buffer.destroy();
  return out;
}

/** IEEE half to number. */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}
