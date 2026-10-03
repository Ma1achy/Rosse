// @ts-check
/**
 * `npm run test:gpu`: runs the browser test pages in tests/gpu/ on Chromium with WebGPU on
 * SwiftShader, served by Vite on localhost. Each page reports through `window.__gpuTest`
 * (tests/gpu/harness.ts). Exits non-zero if any page fails, times out or logs a WebGPU error.
 * Writes test-results/gpu.json.
 *
 * Usage: node tools/gpu-test/run.mjs [page …]   (default: every tests/gpu/*.html)
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, launch, prepareAssets, startServer } from './browser.mjs';

const TIMEOUT = 180_000;

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const pages = requested.length
  ? requested.map((p) => (p.endsWith('.html') ? p : `${p}.html`))
  : readdirSync(join(ROOT, 'tests/gpu'))
      .filter((f) => f.endsWith('.html'))
      .sort();

prepareAssets();
const server = await startServer();
const browser = await launch();
/** @type {{ page: string, name?: string, pass: boolean, lines: string[], data?: unknown, errors: string[] }[]} */
const results = [];
try {
  for (const file of pages) {
    const page = await browser.newPage();
    /** @type {string[]} */
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    const t0 = Date.now();
    await page.goto(`${server.url}/tests/gpu/${file}`);
    try {
      await page.waitForFunction(() => window.__gpuTest !== undefined, undefined, {
        timeout: TIMEOUT,
      });
      const r = /** @type {{ name: string, pass: boolean, lines: string[], data?: unknown }} */ (
        await page.evaluate(() => window.__gpuTest)
      );
      const pass = r.pass && errors.length === 0;
      results.push({ page: file, ...r, pass, errors });
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${r.name}  (${String(Date.now() - t0)} ms)`);
      for (const l of r.lines) console.log(`      ${l}`);
    } catch (e) {
      results.push({ page: file, pass: false, lines: [String(e)], errors });
      console.log(`FAIL  ${file}: ${String(e)}`);
    }
    for (const e of errors) console.log(`      error: ${e}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

mkdirSync(join(ROOT, 'test-results'), { recursive: true });
writeFileSync(join(ROOT, 'test-results/gpu.json'), JSON.stringify(results, null, 2) + '\n');
const failed = results.filter((r) => !r.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} GPU test pages passed`);
process.exit(failed ? 1 : 0);
