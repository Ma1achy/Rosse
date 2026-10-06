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

export { readTexture } from '../../src/gpu/readback';

/** IEEE half to number. */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}
