// @ts-check
/**
 * `npm run perf:worker`: what moving the CPU engine into a worker changes on the page (M10,
 * ADR 0071). The same scripted drag (60 mouse moves) runs on the CPU engine twice, in a worker and
 * on the main thread (`?cpuworker=off`), and the page reports what the main thread saw:
 * the longest gap between animation frames, the long tasks (50 ms and over) and their total, and
 * how many frames were drawn. The CPU cost of a frame is the same in both (it is the same code);
 * the worker's gain is that the page stays responsive while it runs.
 *
 * Writes docs/milestones/m10/perf/cpu-worker.json. Numbers are from one headless Chromium on a
 * shared machine: compare the two rows, not the absolute values.
 */
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { ROOT, launch, prepareAssets, startServer } from '../gpu-test/browser.mjs';

const quick = process.argv.includes('--quick');
const preset = 'Grand design';
const MOVES = quick ? 12 : 60;

prepareAssets();
const server = await startServer();
const browser = await launch();
/** @type {Record<string, any>} */
const rows = {};
try {
  for (const [scn, pre, drag] of /** @type {[string, string, boolean][]} */ ([
    ['drag', preset, true],
    ['merger build', 'Merger: the Mice', false],
  ]))
    for (const mode of ['worker', 'main thread']) {
      const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
      await page.addInitScript(() => {
        const j = { maxGap: 0, longTasks: 0, longMs: 0, rafs: 0 };
        /** @type {any} */ (window).__jank = j;
        let last = performance.now();
        const tick = () => {
          const now = performance.now();
          j.maxGap = Math.max(j.maxGap, now - last);
          last = now;
          j.rafs++;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            j.longTasks++;
            j.longMs += e.duration;
          }
        }).observe({ entryTypes: ['longtask'] });
      });
      const q = `preset=${encodeURIComponent(pre)}&seed=7&backend=cpu${mode === 'worker' ? '' : '&cpuworker=off'}`;
      await page.goto(`${server.url}/?${q}`);
      await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, {
        timeout: 600_000,
      });
      const where = await page.evaluate(() => document.documentElement.dataset.cpuWhere);
      if (!drag) {
        // the first frame of a merger is its integration: what the page saw from load to it
        const t = await page.evaluate(() => /** @type {any} */ (window).__jank);
        rows[`${scn}: ${mode}`] = {
          where,
          framesDrawn: 1,
          maxFrameGapMs: Math.round(t.maxGap),
          longTasks: t.longTasks,
          longTaskMs: Math.round(t.longMs),
          animationFrames: t.rafs,
        };
        console.log(`${scn}: ${mode}`.padEnd(28), JSON.stringify(rows[`${scn}: ${mode}`]));
        await page.close();
        continue;
      }
      // let the first frames settle, then reset the monitor
      await page.waitForTimeout(1500);
      await page.evaluate(() => {
        const j = /** @type {any} */ (window).__jank;
        j.maxGap = 0;
        j.longTasks = 0;
        j.longMs = 0;
        j.rafs = 0;
      });
      const f0 = await page.evaluate(() => window.__rosse?.frames ?? 0);
      const box = await page.locator('#plate').boundingBox();
      if (!box) throw new Error('no plate');
      const cx = Math.round(box.x + box.width / 2);
      const cy = Math.round(box.y + box.height / 2);
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      const t0 = Date.now();
      for (let k = 1; k <= MOVES; k++) {
        await page.mouse.move(cx + 4 * k, cy + (k % 5));
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
      const driveMs = Date.now() - t0;
      await page.waitForTimeout(1500);
      const j = await page.evaluate(() => /** @type {any} */ (window).__jank);
      const f1 = await page.evaluate(() => window.__rosse?.frames ?? 0);
      rows[`${scn}: ${mode}`] = {
        where,
        moves: MOVES,
        driveMs,
        framesDrawn: f1 - f0,
        maxFrameGapMs: Math.round(j.maxGap),
        longTasks: j.longTasks,
        longTaskMs: Math.round(j.longMs),
        animationFrames: j.rafs,
      };
      console.log(`${scn}: ${mode}`.padEnd(28), JSON.stringify(rows[`${scn}: ${mode}`]));
      await page.close();
    }
} finally {
  await browser.close();
  await server.close();
}
if (!quick) {
  const file = join(ROOT, 'docs/milestones/m10/perf/cpu-worker.json');
  const cfg = (await resolveConfig(file)) ?? {};
  const rec = {
    kind: 'cpu-worker',
    label: 'CPU engine on the page: worker against main thread (headless Chromium)',
    date: new Date().toISOString().slice(0, 10),
    preset,
    loadAfter: loadavg().map((x) => Math.round(x * 100) / 100),
    rows,
  };
  writeFileSync(file, await format(JSON.stringify(rec), { ...cfg, filepath: file }));
}
