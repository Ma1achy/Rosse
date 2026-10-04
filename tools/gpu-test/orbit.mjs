// @ts-check
/**
 * The orbit check (M3): the page, driven with a real mouse through Playwright, on WebGPU
 * (SwiftShader, `?present=copy`) and on the CPU engine.
 *
 * 1. A drag across the plate: az and incl must end where v21's formulas put them, replayed over
 *    the same pointer positions (az = wrap(az + 0.45 dx), incl = clamp(incl + 0.45 dy, 0, 180),
 *    app23.js:L1849); the marks move (the plate's pixels change) but their count does not; the
 *    model tier does not run again; no more than one frame ever waits in the queue.
 * 2. A right-drag rolls (pa changes, az and incl do not).
 * 3. The wheel and `+` zoom (v21's factors), double-click resets the zoom; still no model rebuild.
 */
const TOL = 1e-9;

/** v21's drag step (app23.js:L1849). */
function v21Drag(
  /** @type {{ az: number, incl: number }} */ s,
  /** @type {number} */ dx,
  /** @type {number} */ dy,
) {
  return {
    az: (((s.az + dx * 0.45) % 360) + 360) % 360,
    incl: Math.max(0, Math.min(180, s.incl + dy * 0.45)),
  };
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} url
 */
export async function orbitCheck(browser, url) {
  /** @type {string[]} */
  const lines = [];
  /** @type {Record<string, unknown>} */
  const data = {};
  let pass = true;
  const fail = (/** @type {string} */ m) => {
    pass = false;
    lines.push(`FAIL ${m}`);
  };
  for (const backend of ['webgpu', 'cpu']) {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const q = `preset=${encodeURIComponent('Smooth, round')}&seed=7&variant=stipple&backend=${backend}${backend === 'webgpu' ? '&present=copy' : ''}`;
    await page.goto(`${url}/?${q}`);
    await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, {
      timeout: 120_000,
    });
    /** @returns {Promise<any>} */
    const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__rosse)));
    /** a hash of the plate's pixels (2D canvas on both engines here) */
    const pixels = () =>
      page.evaluate(() => {
        const c = /** @type {HTMLCanvasElement} */ (document.getElementById('plate'));
        const ctx = c.getContext('2d');
        if (!ctx) return 'no 2d context';
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let h = 2166136261;
        for (let i = 0; i < d.length; i++) h = Math.imul(h ^ (d[i] ?? 0), 16777619) >>> 0;
        return h.toString(16);
      });
    /**
     * waits until the frame on the plate shows camera `want` and its counts have been read back
     * (the page reads them after presenting, outside the frame queue)
     */
    const settle = async (/** @type {Record<string, number>} */ want) => {
      await page.waitForFunction(
        ({ want, tol }) => {
          const r = window.__rosse;
          const c = /** @type {any} */ (r?.camera);
          return (
            !!c && !!r?.counts && Object.entries(want).every(([k, v]) => Math.abs(c[k] - v) <= tol)
          );
        },
        { want, tol: TOL },
        { timeout: 120_000 },
      );
    };
    // let the first frames (and the first resize) land
    let frames = -1;
    for (;;) {
      await page.waitForTimeout(300);
      const now = await page.evaluate(() => window.__rosse?.frames ?? 0);
      if (now === frames) break;
      frames = now;
    }
    await page.waitForFunction(() => !!window.__rosse?.counts, undefined, { timeout: 120_000 });
    const s0 = await state();
    const before = await pixels();
    const box = await page.locator('#plate').boundingBox();
    if (!box) throw new Error('no plate');
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);

    // 1. drag: 24 moves, right and down
    const path = Array.from({ length: 24 }, (_, k) => [
      cx + 9 * (k + 1),
      cy + 2 * (k + 1) + (k % 3),
    ]);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    let want = { az: s0.camera.az, incl: s0.camera.incl };
    let prev = [cx, cy];
    for (const p of path) {
      await page.mouse.move(p[0] ?? 0, p[1] ?? 0);
      want = v21Drag(want, (p[0] ?? 0) - (prev[0] ?? 0), (p[1] ?? 0) - (prev[1] ?? 0));
      prev = p;
    }
    await page.mouse.up();
    await settle(want);
    const s1 = await state();
    const after = await pixels();
    const tag = `[${backend}]`;
    lines.push(
      `${tag} drag of ${String(path.length)} moves: az ${s0.camera.az.toFixed(2)} → ${s1.camera.az.toFixed(4)} (v21 ${want.az.toFixed(4)}), incl ${s0.camera.incl.toFixed(2)} → ${s1.camera.incl.toFixed(4)} (v21 ${want.incl.toFixed(4)}); ` +
        `${String(s1.frames - s0.frames)} frames drawn; dots ${String(s0.counts.dots)} → ${String(s1.counts.dots)}; tiers model ${String(s0.tiers.model)} → ${String(s1.tiers.model)}, view ${String(s0.tiers.view)} → ${String(s1.tiers.view)}; most frames queued ${String(s1.maxQueued)}`,
    );
    if (Math.abs(s1.camera.az - want.az) > TOL || Math.abs(s1.camera.incl - want.incl) > TOL)
      fail(`${tag} the camera is not where v21's formulas put it`);
    if (s1.camera.pa !== s0.camera.pa || s1.camera.zoom !== s0.camera.zoom)
      fail(`${tag} a drag changed pa or zoom`);
    if (after === before) fail(`${tag} the marks did not move`);
    if (JSON.stringify(s1.counts) !== JSON.stringify(s0.counts))
      fail(
        `${tag} the mark counts changed: ${JSON.stringify(s0.counts)} → ${JSON.stringify(s1.counts)}`,
      );
    if (s1.tiers.model !== s0.tiers.model) fail(`${tag} the model tier ran during the drag`);
    if (s1.tiers.view <= s0.tiers.view) fail(`${tag} the view tier did not run`);
    if (s1.maxQueued > 1) fail(`${tag} ${String(s1.maxQueued)} frames waited in the queue at once`);

    // 2. right-drag: roll by the pointer's turn about the plate's centre (app23.js:L1848)
    const bx = box.x + box.width / 2;
    const by = box.y + box.height / 2;
    const turn = Math.atan2(cy + 120 - by, cx + 200 - bx) - Math.atan2(cy - by, cx + 200 - bx);
    const paWant = (((s1.camera.pa + (turn * 180) / Math.PI) % 360) + 360) % 360;
    await page.mouse.move(cx + 200, cy);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(cx + 200, cy + 120, { steps: 6 });
    await page.mouse.up({ button: 'right' });
    await settle({ az: s1.camera.az, incl: s1.camera.incl, pa: paWant });
    const s2 = await state();
    lines.push(
      `${tag} right-drag: pa ${String(s1.camera.pa)} → ${s2.camera.pa.toFixed(4)}° (v21 ${paWant.toFixed(4)}°), az and incl unchanged`,
    );
    if (Math.abs(s2.camera.pa - paWant) > 1e-6)
      fail(`${tag} roll ${String(s2.camera.pa)}, want ${String(paWant)}`);

    // 3. zoom: wheel, +, double-click
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -200);
    await settle({ zoom: Math.exp(200 * 0.0015) });
    await page.locator('#plate').focus();
    await page.keyboard.press('+');
    await settle({ zoom: Math.exp(200 * 0.0015) * 1.15 });
    const s3 = await state();
    const zoomed = await pixels();
    await page.mouse.dblclick(cx, cy);
    await settle({ zoom: 1 });
    const s4 = await state();
    lines.push(
      `${tag} wheel −200 then +: zoom ${s3.camera.zoom.toFixed(4)} (v21 ${(Math.exp(0.3) * 1.15).toFixed(4)}); double-click: zoom ${String(s4.camera.zoom)}; model tier ran ${String(s4.tiers.model)} time(s) in all`,
    );
    if (zoomed === after) fail(`${tag} zooming did not change the plate`);
    if (s4.tiers.model !== s0.tiers.model) fail(`${tag} the model tier ran during orbit or zoom`);
    if (s4.maxQueued > 1) fail(`${tag} ${String(s4.maxQueued)} frames waited in the queue at once`);
    if (s4.backend !== backend) fail(`${tag} drawn by ${String(s4.backend)}`);
    for (const e of errors) fail(`${tag} page error: ${e}`);
    data[backend] = { s0, s1, s2, s3, s4, want };
    await page.close();
  }
  return {
    name: 'orbit: drag, roll and zoom on the page (v21 formulas, no model rebuild)',
    pass,
    lines,
    data,
  };
}
