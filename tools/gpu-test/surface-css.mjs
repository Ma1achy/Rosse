// @ts-check
/**
 * Surface check against v21 itself. The reference draws the plate's surface with CSS (the
 * `.plate` rules of head23.html: background colour, paper texture and blend mode, inset rim and,
 * on Chalkboard, a vignette). This loads the real reference page
 * (assets/reference/pages/rosse-v21.html), hides everything but the plate, and everything inside
 * it (the WebGL canvas, captions, insets), and screenshots the empty plate on Paper and, after the page's own theme
 * switch to dark, on Chalkboard. Nothing about the surface is retyped here, so the test cannot
 * share our assumptions. The only overrides are layout: the plate is pinned to the top-left
 * corner at 800 × 800 CSS px (the size of our plate) and transitions are switched off.
 *
 * The screenshots are compared, pixel for pixel, with the composite pass (GPU, empty ink) and
 * its CPU twin, at DPR 1 and 2.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import pngjs from 'pngjs';
import { ROOT } from './browser.mjs';

/**
 * Tolerance in 8-bit levels. The background and the sharp rim match exactly; Chromium draws the
 * blurred vignette with Skia's approximation of a Gaussian (σ = blur / 2), which ours computes
 * analytically, so a level or two is allowed (measured on SwiftShader: at most 2/255, at the rim). Values are
 * printed.
 */
export const SURFACE_TOL = 2;

const PLATE = 800;
const LAYOUT = `.plate{position:fixed!important;left:0!important;top:0!important;width:${String(PLATE)}px!important;height:${String(PLATE)}px!important;margin:0!important;z-index:2147483647!important}
body *{visibility:hidden!important}.plate{visibility:visible!important}.plate *{visibility:hidden!important}
*,*::before,*::after{transition:none!important;animation:none!important}`;

/** Serves the reference page on localhost (as tools/capture-reference does). */
async function serveReference() {
  const html = readFileSync(join(ROOT, 'assets/reference/pages/rosse-v21.html'));
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise((r) => {
    server.listen(0, 'localhost', () => {
      r(undefined);
    });
  });
  const a = server.address();
  if (!a || typeof a === 'string') throw new Error('no address');
  return {
    url: `http://localhost:${String(a.port)}/`,
    close: () => new Promise((r) => server.close(r)),
  };
}

/**
 * v21's empty plate as RGBA8, `theme` 'light' (Paper) or 'dark' (Chalkboard).
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {'light' | 'dark'} theme
 * @param {number} dpr
 */
async function referencePlate(browser, url, theme, dpr) {
  const ctx = await browser.newContext({
    viewport: { width: 1000, height: 1000 },
    deviceScaleFactor: dpr,
  });
  // the page reads its theme from localStorage, as when a visitor last chose it
  await ctx.addInitScript((t) => {
    localStorage.setItem('foundry-theme', t);
  }, theme);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: LAYOUT });
  await page.waitForFunction(
    (s) => document.querySelector('.plate')?.getAttribute('data-surface') === s,
    theme === 'dark' ? 'chalk' : 'paper',
    { timeout: 60_000 },
  );
  const state = await page.evaluate(() => {
    const p = document.querySelector('.plate');
    if (!p) return null;
    const cs = getComputedStyle(p);
    return { blend: cs.backgroundBlendMode, shadow: cs.boxShadow, colour: cs.backgroundColor };
  });
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: PLATE, height: PLATE } });
  if (process.env.ROSSE_SURFACE_DEBUG)
    writeFileSync(join(process.env.ROSSE_SURFACE_DEBUG, `v21-${theme}-${String(dpr)}.png`), shot);
  const png = pngjs.PNG.sync.read(shot);
  await ctx.close();
  return { data: png.data, width: png.width, state };
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} url the Vite server serving this repository
 * @returns {Promise<{ name: string, pass: boolean, lines: string[], data: unknown }>}
 */
export async function surfaceCssCheck(browser, url) {
  const ref = await serveReference();
  const lines = [];
  /** @type {Record<string, unknown>} */
  const data = {};
  let pass = true;
  try {
    for (const dpr of [1, 2]) {
      const page = await browser.newPage({ deviceScaleFactor: dpr });
      await page.goto(`${url}/tests/gpu/rng.html#no-op`);
      const ours = await page.evaluate(
        async ({ dpr, plate }) => {
          const { BuiltAssets } = await import('/src/marks/atlas.ts');
          const { CpuRenderer } = await import('/src/fallback/index.ts');
          const { GpuRenderer } = await import('/src/render/frame.ts');
          const { readTexture } = await import('/src/gpu/readback.ts');
          const { requestDevice } = await import('/src/gpu/device.ts');
          const { SURFACES } = await import('/src/render/surface.ts');
          const assets = await BuiltAssets.load('/');
          const paper = await assets.paper();
          const size = { plateCss: plate, dpr };
          const cpu = new CpuRenderer(size, paper);
          cpu.drawInk();
          const { device } = await requestDevice(navigator);
          const gpu = new GpuRenderer(device, size, paper);
          gpu.setLayers([]);
          gpu.drawInk();
          // bytes travel back as base64: far faster than arrays of numbers
          /** @param {Uint8Array | Uint8ClampedArray} b */
          const b64 = (b) => {
            let s = '';
            for (let i = 0; i < b.length; i += 0x8000)
              s += String.fromCharCode(...b.subarray(i, i + 0x8000));
            return btoa(s);
          };
          /** @type {Record<string, { cpu: string, gpu: string }>} */
          const out = {};
          for (const s of /** @type {const} */ (['paper', 'chalk'])) {
            const t = device.createTexture({
              size: [gpu.width, gpu.height],
              format: 'rgba8unorm',
              usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
            });
            gpu.present(t.createView(), 'rgba8unorm', SURFACES[s]);
            out[s] = {
              cpu: b64(cpu.present(SURFACES[s])),
              gpu: b64(await readTexture(device, t, 4)),
            };
            t.destroy();
          }
          gpu.destroy();
          device.destroy();
          return out;
        },
        { dpr, plate: PLATE },
      );
      await page.close();
      for (const [s, theme] of /** @type {const} */ ([
        ['paper', 'light'],
        ['chalk', 'dark'],
      ])) {
        const r = await referencePlate(browser, ref.url, theme, dpr);
        lines.push(
          `v21 ${s}, DPR ${String(dpr)}: blend ${String(r.state?.blend)}, box-shadow ${String(r.state?.shadow)}`,
        );
        for (const engine of /** @type {const} */ (['gpu', 'cpu'])) {
          const o = Buffer.from(ours[s]?.[engine] ?? '', 'base64');
          if (r.data.length !== o.length) {
            pass = false;
            lines.push(
              `  ${engine}: size mismatch (${String(r.data.length)} ≠ ${String(o.length)})`,
            );
            continue;
          }
          let max = 0;
          let maxInterior = 0;
          let differing = 0;
          let sumRef = 0;
          let sumOurs = 0;
          const W = r.width;
          const edge = 4 * dpr; // the rim and its anti-aliasing
          for (let i = 0; i < o.length; i++) {
            if (i % 4 === 3) continue;
            const d = Math.abs((r.data[i] ?? 0) - (o[i] ?? 0));
            sumRef += r.data[i] ?? 0;
            sumOurs += o[i] ?? 0;
            if (d) differing++;
            max = Math.max(max, d);
            const p = i >> 2;
            const x = p % W;
            const y = Math.floor(p / W);
            if (x >= edge && y >= edge && x < W - edge && y < W - edge)
              maxInterior = Math.max(maxInterior, d);
          }
          const n = (o.length / 4) * 3;
          if (max > SURFACE_TOL) pass = false;
          data[`${s} dpr${String(dpr)} ${engine}`] = { max, maxInterior, differing };
          lines.push(
            `  ${engine}: max ${String(max)}/255 (away from the rim ${String(maxInterior)}/255), ${String(differing)} channel values differ, mean ${(sumOurs / n).toFixed(2)} vs v21 ${(sumRef / n).toFixed(2)}`,
          );
        }
      }
    }
  } finally {
    await ref.close();
  }
  lines.push(`tolerance ${String(SURFACE_TOL)}/255`);
  return { name: 'surface (composite = v21 plate)', pass, lines, data };
}
