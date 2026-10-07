// @ts-check
/**
 * Shared by the README asset scripts: the render page (tools/readme-assets/render.html) in
 * Chromium on SwiftShader WebGPU, served by Vite, and helpers to turn what it returns into PNGs.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { ROOT, launch, prepareAssets, startServer } from '../gpu-test/browser.mjs';

export { ROOT };
export const CACHE = join(ROOT, '.cache/readme-assets');
export const RENDERS = join(CACHE, 'renders');
export const IMG = join(ROOT, 'docs/img');

/**
 * @typedef {{preset: string, seed: number, over?: Record<string, unknown>, az?: number,
 *   incl?: number, pa?: number, zoom?: number, mTime?: number, plates?: string}} Shot
 */

export class Renderer {
  /** @param {any} server @param {any} browser @param {any} page */
  constructor(server, browser, page) {
    this.server = server;
    this.browser = browser;
    this.page = page;
  }

  static async open() {
    prepareAssets();
    const server = await startServer();
    const browser = await launch();
    const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
    page.on('console', (m) => {
      if (m.type() === 'error') console.error(`[page] ${m.text()}`);
    });
    await page.goto(`${server.url}/tools/readme-assets/render.html`);
    await page.waitForFunction(
      () => window.__ra !== undefined || window.__raError !== undefined,
      undefined,
      {
        timeout: 180_000,
      },
    );
    const err = await page.evaluate(() => window.__raError);
    if (err) throw new Error(`render page failed: ${err}`);
    return new Renderer(server, browser, page);
  }

  /** a data op of the render page (`presetNames`, `reals`, `gz2`) */
  async op(/** @type {string} */ name, /** @type {unknown[]} */ ...args) {
    return this.page.evaluate(([n, a]) => window.__ra?.[n](...a), [name, args]);
  }

  /** @param {number} plateCss @param {number} dpr */
  async size(plateCss, dpr) {
    await this.page.evaluate(([c, d]) => window.__ra?.setSize(c, d), [plateCss, dpr]);
  }

  /** @param {Shot} s */
  async shot(s) {
    return this.page.evaluate((x) => window.__ra?.shot(x), s);
  }

  /** the last shot's ink alpha, as a Buffer of w*w bytes */
  async alpha() {
    const b64 = await this.page.evaluate(() => window.__ra?.alpha());
    return Buffer.from(b64 ?? '', 'base64');
  }

  /** the last shot composited onto a surface, as RGBA bytes */
  async plate(/** @type {'paper' | 'chalk'} */ surface) {
    const b64 = await this.page.evaluate((s) => window.__ra?.plate(s), surface);
    return Buffer.from(b64 ?? '', 'base64');
  }

  async close() {
    await this.browser.close();
    await this.server.close();
  }
}

/** RGBA bytes to a PNG buffer. */
export function rgbaPng(
  /** @type {Buffer} */ rgba,
  /** @type {number} */ w,
  /** @type {number} */ h,
) {
  const png = new PNG({ width: w, height: h });
  rgba.copy(png.data);
  return PNG.sync.write(png, { colorType: 6 });
}

/** An ink alpha as a PNG of black ink with that alpha (or, with `rgb`, that ink colour). */
export function alphaPng(
  /** @type {Buffer} */ a,
  /** @type {number} */ w,
  /** @type {[number, number, number]} */ rgb = [0, 0, 0],
) {
  const png = new PNG({ width: w, height: w });
  for (let i = 0; i < w * w; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = a[i] ?? 0;
  }
  return PNG.sync.write(png, { colorType: 6 });
}

const TYPES = /** @type {Record<string, string>} */ ({
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.css': 'text/css',
  '.js': 'text/javascript',
});

/** A static server on localhost for the repository (CSS masks and fonts need a real origin). */
export async function serveRepo() {
  const server = createServer((req, res) => {
    const path = normalize(join(ROOT, decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')));
    if (!path.startsWith(ROOT) || !existsSync(path) || !statSync(path).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(undefined)));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${String(port)}`, close: () => server.close() };
}

/** Screenshots a poster page (a path under the repository, with its query) with plain Chromium. */
export async function screenshot(
  /** @type {string} */ page,
  /** @type {string} */ out,
  /** @type {number} */ w,
  /** @type {number} */ h,
  /** @type {number} */ scale,
) {
  const server = await serveRepo();
  const browser = await chromium.launch({ headless: true });
  try {
    const tab = await browser.newPage({
      viewport: { width: w, height: h },
      deviceScaleFactor: scale,
    });
    await tab.goto(`${server.url}/${page}`);
    await tab.evaluate(() => document.fonts.ready);
    await tab.waitForFunction(() => [...document.images].every((i) => i.complete));
    await tab.waitForTimeout(300);
    await tab.screenshot({ path: out });
  } finally {
    await browser.close();
    server.close();
  }
}

export function sh(/** @type {string} */ cmd, /** @type {string[]} */ args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

/**
 * Screenshots a generated figure page (a path under the repository) at a fixed width, as tall as
 * the page is. One browser and one static server for a batch of figures.
 * @param {Array<{html: string, out: string}>} jobs @param {number} width @param {number} scale
 */
export async function figures(jobs, width, scale) {
  const server = await serveRepo();
  const browser = await chromium.launch({ headless: true });
  try {
    const tab = await browser.newPage({
      viewport: { width, height: 400 },
      deviceScaleFactor: scale,
    });
    for (const j of jobs) {
      await tab.setViewportSize({ width, height: 400 });
      await tab.goto(`${server.url}/${j.html}`);
      await tab.evaluate(() => document.fonts.ready);
      await tab.waitForFunction(() => [...document.images].every((i) => i.complete));
      await tab.waitForTimeout(150);
      const h = await tab.evaluate(() => document.documentElement.scrollHeight);
      await tab.setViewportSize({ width, height: h });
      await tab.screenshot({ path: j.out, fullPage: true });
    }
  } finally {
    await browser.close();
    server.close();
  }
}
