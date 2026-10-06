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

export const CHROMIUM_ARGS = [
  '--enable-unsafe-webgpu',
  '--use-webgpu-adapter=swiftshader',
  '--enable-features=Vulkan',
];

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
  return { url: `http://localhost:${String(address.port)}`, close: () => server.close() };
}

export async function launch() {
  return chromium.launch({ headless: true, args: CHROMIUM_ARGS });
}
