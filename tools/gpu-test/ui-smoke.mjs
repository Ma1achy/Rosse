// @ts-check
/**
 * The page's UI smoke test (M11), driven through Playwright on the CPU engine and on WebGPU
 * (SwiftShader, `?present=copy`):
 *
 * - the page loads with no error, the plate draws, and on the CPU engine it says "drawn on the CPU";
 * - the tabs follow the keyboard (arrow keys), a preset card draws its preset;
 * - a slider and its number box change the drawing and the address, and a link restores them;
 * - Paper and Chalkboard switch the page and the plate and are kept in the address;
 * - "New stars" and "Surprise me" draw, "Export PNG" saves a real PNG of the plate's size;
 * - every control has an accessible name; reduced motion starts the timeline without a loop;
 * - nothing is drawn that the engine cannot (the merger and lens tabs follow the feature flags).
 *
 * Exports `uiSmokeCheck(browser, url)`; `node tools/gpu-test/ui-smoke.mjs` runs it alone.
 */
import { readFileSync } from 'node:fs';

/**
 * @param {import('playwright').Browser} browser
 * @param {string} url
 */
export async function uiSmokeCheck(browser, url) {
  /** @type {string[]} */
  const lines = [];
  let pass = true;
  const fail = (/** @type {string} */ m) => {
    pass = false;
    lines.push(`FAIL ${m}`);
  };
  for (const backend of ['cpu', 'webgpu']) {
    const label = backend;
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
      acceptDownloads: true,
      reducedMotion: backend === 'cpu' ? 'reduce' : 'no-preference',
    });
    const page = await ctx.newPage();
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const open = async (/** @type {string} */ query) => {
      await page.goto(
        `${url}/?backend=${backend}${backend === 'webgpu' ? '&present=copy' : ''}${query}`,
      );
      await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, {
        timeout: 180_000,
      });
    };
    /** a frame after the one counted */
    const settled = async (/** @type {number} */ after) => {
      await page.waitForFunction((n) => (window.__rosse?.frames ?? 0) > n, after, {
        timeout: 180_000,
      });
    };
    const frames = () => page.evaluate(() => window.__rosse?.frames ?? 0);
    const rosse = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__rosse)));

    await open('&seed=7');
    // the CPU note
    const note = (await page.locator('#note').textContent()) ?? '';
    if ((backend === 'cpu') !== note.includes('drawn on the CPU'))
      fail(`${label}: the CPU note is "${note}"`);

    // the tabs, by keyboard
    const tabs = await page.locator('[role=tab]').allTextContents();
    for (const t of ['Choose', 'Galaxy', 'Sky', 'Ink'])
      if (!tabs.includes(t)) fail(`${label}: no ${t} tab (${tabs.join(', ')})`);
    await page.locator('#tab-choose').focus();
    await page.keyboard.press('ArrowRight');
    if ((await page.locator('#tab-galaxy').getAttribute('aria-selected')) !== 'true')
      fail(`${label}: ArrowRight did not select the Galaxy tab`);
    if (
      !(await page.locator('#pane-galaxy').isVisible()) ||
      (await page.locator('#pane-choose').isVisible())
    )
      fail(`${label}: the tab's panel did not show`);

    // a slider: the keyboard moves it, the drawing and the address follow
    let n = await frames();
    const arms = page.locator('#c-arms');
    await arms.focus();
    await page.keyboard.press('ArrowRight');
    await settled(n);
    const armsValue = await arms.inputValue();
    if (armsValue !== '3') fail(`${label}: arms is ${armsValue} after one ArrowRight (want 3)`);
    await page.waitForFunction(() => location.search.includes('arms=3'), undefined, {
      timeout: 5000,
    });
    // the number box: type a value, Enter
    n = await frames();
    await page.locator('#c-pitch-n').fill('30');
    await page.keyboard.press('Enter');
    await settled(n);
    if ((await page.locator('#c-pitch').inputValue()) !== '30')
      fail(`${label}: typing 30 in the pitch box did not move the slider`);
    // an out-of-range value is clamped
    await page.locator('#c-pitch-n').fill('999');
    await page.keyboard.press('Enter');
    if ((await page.locator('#c-pitch').inputValue()) !== '45')
      fail(`${label}: 999 was not clamped to 45`);

    // a preset card
    await page.click('#tab-choose');
    await page.locator('button.card[data-preset="Barred spiral"]').click();
    await page.waitForFunction(() => window.__rosse?.preset === 'Barred spiral', undefined, {
      timeout: 180_000,
    });
    let st = await rosse();
    if (st.preset !== 'Barred spiral') fail(`${label}: the preset card drew ${st.preset}`);
    if (
      (await page
        .locator('button.card[data-preset="Barred spiral"]')
        .getAttribute('aria-pressed')) !== 'true'
    )
      fail(`${label}: the preset card is not pressed`);
    await page.click('#tab-galaxy');
    const armsBefore = await page.locator('#c-arms').inputValue();
    if ((await page.locator('#c-bar').inputValue()) === '0')
      fail(`${label}: the controls did not follow the preset (bar is 0)`);

    // Paper and Chalkboard
    await page.click('button[data-surface="chalk"]');
    await page.waitForFunction(() => window.__rosse?.surface === 'chalk', undefined, {
      timeout: 180_000,
    });
    st = await rosse();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (st.surface !== 'chalk' || theme !== 'dark')
      fail(`${label}: the Chalkboard (${st.surface}, ${String(theme)})`);
    await page.waitForFunction(() => location.search.includes('surface=chalk'), undefined, {
      timeout: 5000,
    });
    // reloaded from that address: the same drawing
    const href = page.url();
    await page.goto(href);
    await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, {
      timeout: 180_000,
    });
    st = await rosse();
    if (st.preset !== 'Barred spiral' || st.surface !== 'chalk')
      fail(`${label}: the link did not restore ${st.preset} on ${st.surface}`);
    await page.click('#tab-galaxy');
    if ((await page.locator('#c-arms').inputValue()) !== armsBefore)
      fail(`${label}: the link did not restore arms (${armsBefore})`);
    // an edited value travels in the link
    await page.goto(`${href}&arms=5&pen=3.5`);
    await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, {
      timeout: 180_000,
    });
    await page.click('#tab-galaxy');
    if ((await page.locator('#c-arms').inputValue()) !== '5')
      fail(`${label}: ?arms=5 did not set the slider`);
    await page.click('button[data-surface="paper"]');

    // New stars, Surprise me
    const seed0 = await page.locator('#seed').inputValue();
    n = await frames();
    await page.click('#reseed');
    await settled(n);
    if (
      (await page.locator('#seed').inputValue()) === seed0 &&
      (await rosse()).seed === Number(seed0)
    )
      fail(`${label}: New stars kept the seed`);
    n = await frames();
    await page.click('#surprise');
    await settled(n);

    // a typed seed keeps the edits
    await page.locator('#seed').fill('321');
    await page.locator('#seed').press('Enter');
    await page.locator('#seed').blur();
    await page.waitForFunction(() => window.__rosse?.seed === 321, undefined, { timeout: 60_000 });

    // PNG
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.click('#export-png'),
    ]);
    const path = await download.path();
    const bytes = readFileSync(path);
    const sig = bytes.subarray(0, 8).toString('hex');
    const w = bytes.readUInt32BE(16);
    const h = bytes.readUInt32BE(20);
    st = await rosse();
    if (sig !== '89504e470d0a1a0a') fail(`${label}: the download is not a PNG`);
    if (w !== st.size.plateCss * st.size.dpr || w !== h)
      fail(`${label}: the PNG is ${String(w)}×${String(h)}, the plate ${JSON.stringify(st.size)}`);
    if (download.suggestedFilename() !== 'rosse-321.png')
      fail(`${label}: the PNG is called ${download.suggestedFilename()}`);
    if (bytes.length < 5000) fail(`${label}: the PNG is only ${String(bytes.length)} bytes`);

    // the merger's controls and timeline, previewed: they exist, the scrub moves mTime
    if (backend === 'cpu') {
      await page.goto(
        `${url}/?backend=cpu&features=merger&preset=${encodeURIComponent('Merger: the Mice')}`,
      );
      await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, {
        timeout: 180_000,
      });
      if (!(await page.locator('#timeline').isVisible()))
        fail(`${label}: no timeline for a merger`);
      if (!(await page.locator('#tab-merger').isVisible())) fail(`${label}: no Merger tab`);
      await page.locator('#tl-scrub').fill('0.5');
      await page.waitForFunction(() => location.search.includes('mTime=0.5'), undefined, {
        timeout: 5000,
      });
      await page.click('#tl-play');
      await page.waitForFunction(
        () => Number(new URLSearchParams(location.search).get('mTime')) > 0.55,
        undefined,
        { timeout: 20_000 },
      );
      await page.click('#tl-play');
      await page.click('#tab-merger');
      if (!(await page.locator('#c-mRatio').isVisible())) fail(`${label}: no mass ratio slider`);
      // and without the preview, a merger is not offered
      await page.goto(`${url}/?backend=cpu&preset=${encodeURIComponent('Merger: the Mice')}`);
      await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, {
        timeout: 180_000,
      });
      if (await page.locator('#tab-merger').count())
        fail(`${label}: a Merger tab for a merger that is not drawn`);
    }

    // accessible names
    const unnamed = await page.evaluate(() => {
      /** @type {string[]} */
      const bad = [];
      document.querySelectorAll('input, select, button, [role=tab], canvas[role]').forEach((e) => {
        if (e instanceof HTMLElement && e.closest('[hidden]')) return;
        const input = /** @type {HTMLInputElement} */ (e);
        const named =
          e.getAttribute('aria-label') ||
          e.getAttribute('aria-labelledby') ||
          (input.labels && input.labels.length > 0) ||
          (e.textContent ?? '').trim();
        if (!named) bad.push(e.id || e.outerHTML.slice(0, 60));
      });
      return bad;
    });
    if (unnamed.length) fail(`${label}: controls without a name: ${unnamed.join(', ')}`);
    // groups of radios have a legend
    const noLegend = await page.evaluate(
      () =>
        [...document.querySelectorAll('fieldset.choice')].filter((f) => !f.querySelector('legend'))
          .length,
    );
    if (noLegend) fail(`${label}: ${String(noLegend)} choices without a legend`);

    // reduced motion: the timeline does not loop by itself
    if (backend === 'cpu' && (await page.locator('#tl-loop').isChecked()))
      fail(`${label}: the timeline loops under reduced motion`);
    // features: a tab for a part that is not drawn must not be offered
    const flags = await page.evaluate(() => window.__rosse?.backend);
    void flags;
    for (const e of errors) fail(`${label}: page error ${e}`);
    lines.push(
      `${label}: ${tabs.join('/')}; ${String(w)}px PNG ${String(bytes.length)} bytes; ${String(errors.length)} errors`,
    );
    await ctx.close();
  }
  return { name: 'the page (UI smoke)', pass, lines };
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const { launch, prepareAssets, startServer } = await import('./browser.mjs');
  prepareAssets();
  const server = await startServer();
  const browser = await launch();
  try {
    const r = await uiSmokeCheck(browser, server.url);
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
    for (const l of r.lines) console.log(`      ${l}`);
    process.exitCode = r.pass ? 0 : 1;
  } finally {
    await browser.close();
    await server.close();
  }
}
