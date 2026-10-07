// @ts-check
/**
 * `npm run thumbnails`: draws every preset the page offers with this engine and saves it as a small
 * WebP, one set on Paper and one on the Chalkboard, in src/ui/thumbs/{paper,chalk}/<slug>.webp
 * (the cards of the Choose tab show them).
 *
 * It opens the page in Chromium with WebGPU on SwiftShader (`?present=copy`, as the other browser
 * tools), clicks each preset's card at seed 7 and the preset's own camera, waits for the frame (a
 * merger's simulation included), and crops the middle three quarters of the plate and scales it to 192 px in the page with high-quality
 * smoothing, then encodes it as WebP at quality 0.62. The seed, the camera and the engine are the
 * page's own, so running it again on the same engine gives the same files. Only presets whose cards
 * the page shows are drawn: presets that need what the engine does not draw yet (src/render/
 * capabilities.ts) get their thumbnails when it does, by running this again.
 *
 * Usage: node tools/thumbnails/make.mjs [--only "Grand design" --only "Barred spiral"] [--backend cpu]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, launch, prepareAssets, startServer } from '../gpu-test/browser.mjs';

const args = process.argv.slice(2);
const only = args.flatMap((a, i) => (a === '--only' ? [args[i + 1] ?? ''] : []));
const bi = args.indexOf('--backend');
const backend = bi >= 0 ? (args[bi + 1] ?? 'webgpu') : 'webgpu';
const SIZE = 192;
const seed = 7;

/** The file name of a preset (the same rule as src/ui/thumbs.ts `slug`). */
export const slug = (/** @type {string} */ name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

prepareAssets();
const server = await startServer();
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on('pageerror', (e) => console.error(String(e)));
  await page.goto(
    `${server.url}/?backend=${backend}${backend === 'webgpu' ? '&present=copy' : ''}&seed=${String(seed)}&surface=paper`,
  );
  await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, {
    timeout: 300_000,
  });
  const names = await page.$$eval('button.card', (b) =>
    b.map((x) => /** @type {HTMLElement} */ (x).dataset.preset ?? ''),
  );
  const todo = names.filter((n) => !only.length || only.includes(n));
  console.log(`${String(todo.length)} presets on ${backend}`);
  let total = 0;
  for (const surface of ['paper', 'chalk']) {
    mkdirSync(join(ROOT, 'src/ui/thumbs', surface), { recursive: true });
    await page.click(`button[data-surface="${surface}"]`);
    for (const name of todo) {
      const before = await page.evaluate(() => window.__rosse?.frames ?? 0);
      await page.click(`button.card[data-preset="${name}"]`);
      await page.waitForFunction(
        ({ name, n, surface }) => {
          const r = window.__rosse;
          const stats = document.getElementById('stats')?.textContent ?? '';
          return (
            !!r &&
            r.frames > n &&
            r.preset === name &&
            r.surface === surface &&
            r.seed === 7 &&
            !stats.includes('Simulating')
          );
        },
        { name, n: before, surface },
        { timeout: 600_000 },
      );
      /** @type {string} */
      const dataUrl = await page.evaluate((size) => {
        const src = /** @type {HTMLCanvasElement} */ (document.getElementById('plate'));
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
        ctx.imageSmoothingQuality = 'high';
        // the middle three quarters: a galaxy fills a plate's middle, the rest is paper
        const m = src.width * 0.125;
        ctx.drawImage(src, m, m, src.width - 2 * m, src.height - 2 * m, 0, 0, size, size);
        return c.toDataURL('image/webp', 0.62);
      }, SIZE);
      const bytes = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
      writeFileSync(join(ROOT, 'src/ui/thumbs', surface, `${slug(name)}.webp`), bytes);
      total += bytes.length;
      console.log(`${surface}  ${name}  ${String(bytes.length)} bytes`);
    }
  }
  console.log(`${String(total)} bytes in all`);
} finally {
  await browser.close();
  await server.close();
}
