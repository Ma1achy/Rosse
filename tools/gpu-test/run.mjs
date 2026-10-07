// @ts-check
/**
 * `npm run test:gpu`: runs the browser test pages in tests/gpu/ on Chromium with WebGPU on
 * SwiftShader, served by Vite on localhost. Each page reports through `window.__gpuTest`
 * (tests/gpu/harness.ts). Exits non-zero if any page fails, times out or logs a WebGPU error.
 * Writes test-results/gpu.json.
 *
 * Also runs the surface check of ./surface-css.mjs (the composite against Chromium's own
 * rendering of the reference CSS), the orbit check of ./orbit.mjs (the page, dragged with the
 * mouse) the plates check of ./plates-page.mjs (the page's Plates choice) and the UI smoke test of
 * ./ui-smoke.mjs (the page's controls, tabs, URL state, themes, PNG export and accessible names).
 *
 * Usage: node tools/gpu-test/run.mjs [page …]   (default: every tests/gpu/*.html, surface-css,
 * orbit, plates-page and ui-smoke)
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, launch, prepareAssets, startServer } from './browser.mjs';
import { orbitCheck } from './orbit.mjs';
import { platesPageCheck } from './plates-page.mjs';
import { surfaceCssCheck } from './surface-css.mjs';
import { uiSmokeCheck } from './ui-smoke.mjs';

// a page test waits this long: the tier hash test takes about 100 s alone on SwiftShader and over 3 min on
// a machine shared with other jobs (ROSSE_GPU_TIMEOUT_MS overrides)
const TIMEOUT = Number(process.env.ROSSE_GPU_TIMEOUT_MS ?? 600_000);

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const withCss = !requested.length || requested.includes('surface-css');
const withOrbit = !requested.length || requested.includes('orbit');
const withPlatesPage = !requested.length || requested.includes('plates-page');
const withUiSmoke = !requested.length || requested.includes('ui-smoke');
const pages = requested.length
  ? requested
      .filter(
        (p) => p !== 'surface-css' && p !== 'orbit' && p !== 'plates-page' && p !== 'ui-smoke',
      )
      .map((p) => (p.endsWith('.html') ? p : `${p}.html`))
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
  if (withCss) {
    const t0 = Date.now();
    try {
      const r = await surfaceCssCheck(browser, server.url);
      results.push({ page: 'surface-css', ...r, errors: [] });
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${String(Date.now() - t0)} ms)`);
      for (const l of r.lines) console.log(`      ${l}`);
    } catch (e) {
      results.push({ page: 'surface-css', pass: false, lines: [String(e)], errors: [] });
      console.log(`FAIL  surface-css: ${String(e)}`);
    }
  }
  if (withOrbit) {
    const t0 = Date.now();
    try {
      const r = await orbitCheck(browser, server.url);
      results.push({ page: 'orbit', ...r, errors: [] });
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${String(Date.now() - t0)} ms)`);
      for (const l of r.lines) console.log(`      ${l}`);
    } catch (e) {
      results.push({ page: 'orbit', pass: false, lines: [String(e)], errors: [] });
      console.log(`FAIL  orbit: ${String(e)}`);
    }
  }
  if (withPlatesPage) {
    const t0 = Date.now();
    try {
      const r = await platesPageCheck(browser, server.url);
      results.push({ page: 'plates-page', ...r, errors: [] });
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${String(Date.now() - t0)} ms)`);
      for (const l of r.lines) console.log(`      ${l}`);
    } catch (e) {
      results.push({ page: 'plates-page', pass: false, lines: [String(e)], errors: [] });
      console.log(`FAIL  plates-page: ${String(e)}`);
    }
  }
  if (withUiSmoke) {
    const t0 = Date.now();
    try {
      const r = await uiSmokeCheck(browser, server.url);
      results.push({ page: 'ui-smoke', ...r, errors: [] });
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${String(Date.now() - t0)} ms)`);
      for (const l of r.lines) console.log(`      ${l}`);
    } catch (e) {
      results.push({ page: 'ui-smoke', pass: false, lines: [String(e)], errors: [] });
      console.log(`FAIL  ui-smoke: ${String(e)}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}

mkdirSync(join(ROOT, 'test-results'), { recursive: true });
writeFileSync(join(ROOT, 'test-results/gpu.json'), JSON.stringify(results, null, 2) + '\n');
const failed = results.filter((r) => !r.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} GPU checks passed`);
process.exit(failed ? 1 : 0);
