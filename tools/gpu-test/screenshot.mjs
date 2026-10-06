// @ts-check
/**
 * `npm run screenshots -- <dir>`: screenshots of the page's plate on Paper and Chalkboard, drawn
 * with WebGPU (SwiftShader) and with the CPU engine (`?backend=cpu`), as JPEG (binaries are
 * committed as ordinary blobs, so they are kept small). Default directory: docs/milestones/m1.
 *
 * WebGPU pages use `?present=copy` (the composite read back onto a 2D canvas), because
 * presenting a WebGPU canvas loses the device on headless SwiftShader.
 *
 * Options: --dpr <n> (device scale factor, default 1), --crop <css px> (also save a centre crop
 * of that size, scaled up 4×, to show the marks themselves).
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, launch, prepareAssets, startServer } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (/** @type {string} */ name, /** @type {string} */ dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? dflt) : dflt;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const outDir = resolve(ROOT, positional[0] ?? 'docs/milestones/m1');
const dpr = Number(opt('--dpr', '1'));
const crop = Number(opt('--crop', '0'));
mkdirSync(outDir, { recursive: true });

prepareAssets();
const server = await startServer();
const browser = await launch();
try {
  for (const backend of ['webgpu', 'cpu']) {
    const page = await browser.newPage({
      deviceScaleFactor: dpr,
      viewport: { width: 900, height: 900 },
    });
    page.on('console', (m) => {
      if (m.type() === 'error') console.error(`[${backend}] ${m.text()}`);
    });
    await page.goto(
      `${server.url}/?backend=${backend}${backend === 'webgpu' ? '&present=copy' : ''}`,
    );
    await page.waitForFunction(() => window.__rosse !== undefined, undefined, { timeout: 60_000 });
    for (const surface of ['paper', 'chalk']) {
      await page.click(`button[data-surface="${surface}"]`);
      await page.waitForFunction((s) => window.__rosse?.surface === s, surface, {
        timeout: 60_000,
      });
      const drawn = await page.evaluate(() => window.__rosse?.backend);
      if (drawn !== backend) throw new Error(`asked for ${backend}, drawn with ${String(drawn)}`);
      const plate = page.locator('#plate');
      const file = join(outDir, `plate-${surface}-${backend}.jpg`);
      await plate.screenshot({ path: file, type: 'jpeg', quality: 85 });
      console.log(`wrote ${file}`);
      if (crop > 0) {
        const zoomed = await browser.newPage({
          deviceScaleFactor: 4,
          viewport: { width: 900, height: 900 },
        });
        await zoomed.goto(
          `${server.url}/?backend=${backend}${backend === 'webgpu' ? '&present=copy' : ''}`,
        );
        await zoomed.waitForFunction(() => window.__rosse !== undefined, undefined, {
          timeout: 60_000,
        });
        await zoomed.click(`button[data-surface="${surface}"]`);
        await zoomed.waitForFunction((s) => window.__rosse?.surface === s, surface);
        const z = await zoomed.locator('#plate').boundingBox();
        if (!z) throw new Error('no plate');
        const cfile = join(outDir, `plate-${surface}-${backend}-centre.jpg`);
        await zoomed.screenshot({
          path: cfile,
          type: 'jpeg',
          quality: 85,
          clip: {
            x: z.x + z.width / 2 - crop / 2,
            y: z.y + z.height / 2 - crop / 2,
            width: crop,
            height: crop,
          },
        });
        console.log(`wrote ${cfile}`);
        await zoomed.close();
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
