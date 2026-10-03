// @ts-check
/**
 * Surface check: the reference draws the plate's surface with CSS (head23.html, `.plate`):
 * the field colour with the paper texture in `overlay`, or #262b28 with it in `soft-light`.
 * Here Chromium renders exactly that CSS, and the result is compared, pixel for pixel, with
 * the composite pass (GPU, empty ink) and its CPU twin, at DPR 1 and 2.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pngjs from 'pngjs';
import { ROOT } from './browser.mjs';

/** Tolerance in 8-bit levels: browsers' image scaling and unorm rounding. */
const TOL = 1;

/**
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @returns {Promise<{ name: string, pass: boolean, lines: string[] }>}
 */
export async function surfaceCssCheck(browser, url) {
  const b64 = readFileSync(join(ROOT, 'assets/embedded-other/rosse_000_asset.png')).toString(
    'base64',
  );
  const css = `body{margin:0}
    .plate{width:800px;height:800px;background-color:#e6dece;background-image:url(data:image/png;base64,${b64});background-size:512px;background-blend-mode:overlay}
    .plate[data-surface="chalk"]{background-color:#262b28;background-blend-mode:soft-light}`;
  const lines = [];
  let pass = true;
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({
      deviceScaleFactor: dpr,
      viewport: { width: 900, height: 900 },
    });
    await page.setContent(`<style>${css}</style><div class="plate" id="p"></div>`);
    await page.waitForFunction(() => document.readyState === 'complete');
    /** @type {Record<string, Uint8Array>} */
    const shots = {};
    for (const s of ['paper', 'chalk']) {
      await page.evaluate((s) => {
        const p = document.getElementById('p');
        if (p) p.dataset.surface = s;
      }, s);
      shots[s] = pngjs.PNG.sync.read(await page.locator('#p').screenshot()).data;
    }
    await page.goto(`${url}/tests/gpu/rng.html#no-op`);
    const ours = await page.evaluate(async (dpr) => {
      const { BuiltAssets } = await import('/src/marks/atlas.ts');
      const { CpuRenderer } = await import('/src/fallback/index.ts');
      const { GpuRenderer } = await import('/src/render/frame.ts');
      const { readTexture } = await import('/src/gpu/readback.ts');
      const { requestDevice } = await import('/src/gpu/device.ts');
      const { SURFACES } = await import('/src/render/surface.ts');
      const assets = await BuiltAssets.load('/');
      const paper = await assets.paper();
      const size = { plateCss: 800, dpr };
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
      }
      return out;
    }, dpr);
    for (const s of ['paper', 'chalk']) {
      const ref = shots[s];
      for (const engine of /** @type {const} */ (['gpu', 'cpu'])) {
        const o = Buffer.from(ours[s]?.[engine] ?? '', 'base64');
        let max = 0;
        let differing = 0;
        if (!ref || ref.length !== o.length) {
          pass = false;
          lines.push(`DPR ${String(dpr)} ${s} ${engine}: size mismatch`);
          continue;
        }
        for (let i = 0; i < o.length; i++) {
          if (i % 4 === 3) continue;
          const d = Math.abs((ref[i] ?? 0) - (o[i] ?? 0));
          if (d) differing++;
          max = Math.max(max, d);
        }
        if (max > TOL) pass = false;
        lines.push(
          `DPR ${String(dpr)}, ${s}, ${engine}: max ${String(max)}/255 against Chromium's CSS, ${String(differing)} channel values differ`,
        );
      }
    }
    await page.close();
  }
  return { name: 'surface (composite = reference CSS)', pass, lines };
}
