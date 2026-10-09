// @ts-check
/**
 * Shared by the GPU test runner and the screenshot tool: a Vite dev server on localhost (WebGPU
 * needs a secure context, and http://localhost is one) and a Chromium with WebGPU on SwiftShader,
 * so no GPU is needed. These flags work headless on hosted Linux runners.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

export const ROOT = resolve(import.meta.dirname, '../..');

/**
 * Which WebGPU adapter Chromium uses, from `ROSSE_WEBGPU_ADAPTER` (M10):
 *
 * - unset or `swiftshader`: SwiftShader, the software adapter of CI and of every checked-in golden;
 * - `hardware` (or `default`): whatever Chromium picks, a real GPU on a machine that has one (no
 *   adapter flag; Vulkan is enabled and, on a headless Linux box, the GPU sandbox flag is left to
 *   the caller's `ROSSE_CHROMIUM_ARGS`);
 * - anything else is passed to `--use-webgpu-adapter=` (for example `d3d12`, `metal`, `vulkan`).
 *
 * `ROSSE_CHROMIUM_ARGS` adds extra space-separated flags. The label is what reports print.
 */
export const ADAPTER_CHOICE =
  (process.env.ROSSE_WEBGPU_ADAPTER ?? 'swiftshader').trim() || 'swiftshader';

/** @param {string} choice */
export function chromiumArgs(choice = ADAPTER_CHOICE) {
  const extra = (process.env.ROSSE_CHROMIUM_ARGS ?? '').split(/\s+/).filter(Boolean);
  const adapter =
    choice === 'hardware' || choice === 'default' ? [] : [`--use-webgpu-adapter=${choice}`];
  return ['--enable-unsafe-webgpu', ...adapter, '--enable-features=Vulkan', ...extra];
}

export const CHROMIUM_ARGS = chromiumArgs();

/** Packs the atlases if needed (they are served from assets-built/). */
export function prepareAssets() {
  execFileSync(process.execPath, [resolve(ROOT, 'tools/pack-atlas/pack.mjs')], {
    stdio: 'inherit',
  });
}

/** Starts Vite on a free localhost port; returns its base URL and a close function. */
export async function startServer() {
  const server = await createServer({
    root: ROOT,
    configFile: resolve(ROOT, 'vite.config.ts'),
    logLevel: 'warn',
    server: { host: 'localhost', port: 0, strictPort: false, hmr: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  return {
    url: `http://localhost:${String(address.port)}`,
    close: () => server.close(),
    /** the Vite server itself (the golden runner loads TypeScript with ssrLoadModule) */
    vite: server,
  };
}

/**
 * `ROSSE_CHROMIUM_PATH` runs a browser other than Playwright's pinned build (for example the
 * system Chrome, to reach the Metal GPU on a Mac). The goldens and engine hashes are SwiftShader
 * on the pinned build; a run with another browser is informational against those.
 */
export async function launch() {
  const executablePath = process.env.ROSSE_CHROMIUM_PATH?.trim() || undefined;
  return chromium.launch({ headless: true, args: CHROMIUM_ARGS, executablePath });
}
