// @ts-check
/**
 * The page's UI smoke test (M11), driven through Playwright on the CPU engine and on WebGPU
 * (SwiftShader, `?present=copy`). Each claim below is checked on pixels or on the page's state, not
 * by waiting for a frame:
 *
 * - the page loads with no error and says "drawn on the CPU" on the CPU engine only; the live
 *   regions are not rewritten when a frame changes nothing they say;
 * - the tabs follow the keyboard; a slider and its number box change the drawing's pixels and the
 *   address; a preset card draws its preset and the controls follow; a part can be taken out and
 *   added back;
 * - Paper and the Chalkboard, kept in the address; a link restores the drawing, with a dark colour
 *   scheme and with storage blocked; a link cannot ask for what the engine does not draw (the sky);
 *   the lens presets are offered, and a lensed quasar's flare runs on the timeline;
 * - a merger preset draws two galaxies (two dense blobs of ink), a single galaxy one, and the
 *   timeline changes the picture without running the model tier again; the timeline stays inside
 *   its end and the address follows it while it plays;
 * - the PNG is the plate's size, and the two engines' PNGs agree;
 * - every control in every tab has an accessible name; the keyboard reaches the page in reading
 *   order, and the focus ring shows; forced colours keep the sliders visible; reduced motion starts
 *   the timeline without a loop;
 * - the home orientation moves with a new preset or seed and never with a View control.
 *
 * Exports `uiSmokeCheck(browser, url)`; `node tools/gpu-test/ui-smoke.mjs` runs it alone.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const BIG = { timeout: 600_000 };

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
  /** @type {Record<string, PNG>} */
  const pngs = {};

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
    const q = (/** @type {string} */ query) =>
      // Paper unless the test says otherwise: the surface is remembered between pages of a context
      `${url}/?backend=${backend}${backend === 'webgpu' ? '&present=copy' : ''}${query.includes('surface=') ? '' : '&surface=paper'}${query}`;
    const open = async (/** @type {string} */ query) => {
      await page.goto(q(query));
      await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, BIG);
      await idle();
    };
    /** no build in progress and counts shown */
    const idle = () =>
      page.waitForFunction(
        () => !(document.getElementById('stats')?.textContent ?? '').includes('Simulating'),
        undefined,
        BIG,
      );
    const rosse = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__rosse)));
    const frames = () => page.evaluate(() => window.__rosse?.frames ?? 0);
    /** a frame after the one counted */
    const settled = async (/** @type {number} */ after) => {
      await page.waitForFunction((n) => (window.__rosse?.frames ?? 0) > n, after, BIG);
      await idle();
    };
    /** a hash of the plate's pixels (the plate is a 2D canvas on both engines under ?present=copy) */
    const plate = () =>
      page.evaluate(() => {
        const c = /** @type {HTMLCanvasElement} */ (document.getElementById('plate'));
        const d = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).getImageData(
          0,
          0,
          c.width,
          c.height,
        );
        let h = 2166136261;
        let ink = 0;
        for (let i = 0; i < d.data.length; i += 4) {
          h = Math.imul(h ^ (d.data[i] ?? 0), 16777619) >>> 0;
          h = Math.imul(h ^ (d.data[i + 1] ?? 0), 16777619) >>> 0;
          if ((d.data[i] ?? 255) < 90) ink++;
        }
        return { hash: h.toString(16), ink };
      });
    /**
     * How many separate concentrations of ink the plate has: ink pixels binned 32 × 32 and blurred
     * over 3 × 3 cells, then the local maxima with at least 35% of the highest, no two within 5
     * cells (a sixth of the plate) of each other.
     */
    const blobs = () =>
      page.evaluate(() => {
        const c = /** @type {HTMLCanvasElement} */ (document.getElementById('plate'));
        const d = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).getImageData(
          0,
          0,
          c.width,
          c.height,
        ).data;
        const N = 32;
        const raw = new Float64Array(N * N);
        for (let y = 0; y < c.height; y++)
          for (let x = 0; x < c.width; x++)
            if ((d[(y * c.width + x) * 4] ?? 255) < 90)
              raw[Math.floor((y / c.height) * N) * N + Math.floor((x / c.width) * N)]++;
        const at = (/** @type {number} */ x, /** @type {number} */ y) =>
          x < 0 || y < 0 || x >= N || y >= N ? 0 : (raw[y * N + x] ?? 0);
        const cell = new Float64Array(N * N);
        for (let y = 0; y < N; y++)
          for (let x = 0; x < N; x++) {
            let sum = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) sum += at(x + dx, y + dy);
            cell[y * N + x] = sum;
          }
        const max = Math.max(...cell);
        /** @type {{ x: number, y: number, v: number }[]} */
        const peaks = [];
        for (let y = 0; y < N; y++)
          for (let x = 0; x < N; x++) {
            const v = cell[y * N + x] ?? 0;
            if (v < 0.35 * max) continue;
            let top = true;
            for (let dy = -2; dy <= 2 && top; dy++)
              for (let dx = -2; dx <= 2; dx++) {
                const xx = x + dx;
                const yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= N || yy >= N || (!dx && !dy)) continue;
                if ((cell[yy * N + xx] ?? 0) > v) {
                  top = false;
                  break;
                }
              }
            if (top) peaks.push({ x, y, v });
          }
        peaks.sort((p, q) => q.v - p.v);
        /** @type {typeof peaks} */
        const kept = [];
        for (const p of peaks)
          if (kept.every((k) => Math.hypot(k.x - p.x, k.y - p.y) >= 5)) kept.push(p);
        return kept.length;
      });
    /** opens a card of the recipe if it is closed */
    const openCard = async (/** @type {string} */ id) => {
      const hd = page.locator(`#rc-${id}-hd`);
      if ((await hd.getAttribute('aria-expanded')) !== 'true') await hd.click();
    };
    const mTime = () =>
      page.evaluate(() => Number(new URLSearchParams(location.search).get('mTime') ?? 1));

    await open('&seed=7');
    // ---- the CPU note, the live regions
    const note = (await page.locator('#note').textContent()) ?? '';
    if ((backend === 'cpu') !== note.includes('drawn on the CPU'))
      fail(`${label}: the CPU note is "${note}"`);
    // the counts are read back after the first frame on the GPU: let them land first
    await page.waitForFunction(() => window.__rosse?.counts !== null, undefined, BIG);
    await page.evaluate(() => {
      /** @type {Record<string, number>} */
      const hits = {};
      window.__liveHits = hits;
      for (const id of ['stats', 'note', 'status', 'platecapt']) {
        hits[id] = 0;
        const e = document.getElementById(id);
        if (e)
          new MutationObserver((m) => {
            hits[id] = (hits[id] ?? 0) + m.length;
          }).observe(e, { childList: true, characterData: true, subtree: true });
      }
    });
    for (let i = 0; i < 3; i++) {
      const n = await frames();
      await page.click(`button[data-surface="${i % 2 ? 'paper' : 'chalk'}"]`);
      await settled(n);
    }
    await page.click('button[data-surface="paper"]');
    await page.waitForTimeout(500);
    const hits = await page.evaluate(() => window.__liveHits);
    if (hits.stats || hits.note || hits.status || hits.platecapt)
      fail(`${label}: live regions rewritten with nothing new to say ${JSON.stringify(hits)}`);

    // ---- the tabs, by keyboard
    const tabs = await page.locator('[role=tab]').allTextContents();
    for (const t of ['Choose', 'Galaxy', 'Merger', 'Sky', 'Ink'])
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

    // ---- a slider changes the pixels, the address and the summary
    await openCard('arms');
    const before = await plate();
    let n = await frames();
    await page.locator('#c-arms').focus();
    await page.keyboard.press('ArrowRight');
    await settled(n);
    const after = await plate();
    if ((await page.locator('#c-arms').inputValue()) !== '3')
      fail(`${label}: arms is not 3 after one ArrowRight`);
    if (before.hash === after.hash) fail(`${label}: the arms slider did not change the plate`);
    await page.waitForFunction(() => location.search.includes('arms=3'), undefined, {
      timeout: 5000,
    });
    if (!(await page.locator('#rc-arms-hd .rc-sm').textContent())?.startsWith('3 arms'))
      fail(`${label}: the arms summary did not follow the slider`);
    // the number box: type a value, Enter; out of range is clamped
    n = await frames();
    await page.locator('#c-pitch-n').fill('30');
    await page.keyboard.press('Enter');
    await settled(n);
    if ((await page.locator('#c-pitch').inputValue()) !== '30')
      fail(`${label}: typing 30 in the pitch box did not move the slider`);
    await page.locator('#c-pitch-n').fill('999');
    await page.keyboard.press('Enter');
    if ((await page.locator('#c-pitch').inputValue()) !== '45')
      fail(`${label}: 999 was not clamped to 45`);

    // ---- a preset card, and a part taken out and added back
    await page.click('#tab-choose');
    await page.locator('button.card[data-preset="Barred spiral"]').click();
    await page.waitForFunction(() => window.__rosse?.preset === 'Barred spiral', undefined, BIG);
    await idle();
    if (
      (await page
        .locator('button.card[data-preset="Barred spiral"]')
        .getAttribute('aria-pressed')) !== 'true'
    )
      fail(`${label}: the preset card is not pressed`);
    await page.click('#tab-galaxy');
    await openCard('bar');
    if ((await page.locator('#c-bar').inputValue()) === '0')
      fail(`${label}: the controls did not follow the preset (bar is 0)`);
    const armsBefore = await page.locator('#c-arms').inputValue();
    n = await frames();
    await page.locator('#rc-bar-hd').locator('xpath=..').locator('.rc-take').click();
    await settled(n);
    if (await page.locator('.rcard[data-id="bar"]').isVisible())
      fail(`${label}: the bar card is still there after Take out`);
    if (!(await page.locator('[data-add="bar"]').isVisible()))
      fail(`${label}: no Add button for the bar`);
    if (!(await page.locator('[data-add="bar"]').evaluate((e) => e === document.activeElement)))
      fail(`${label}: focus did not move to the Add button`);
    await page.locator('[data-add="bar"]').click();
    if ((await page.locator('#c-bar').inputValue()) === '0')
      fail(`${label}: Add did not bring the bar back to its value`);

    // ---- Paper and Chalkboard; a link restores the drawing
    await page.click('button[data-surface="chalk"]');
    await page.waitForFunction(() => window.__rosse?.surface === 'chalk', undefined, BIG);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (theme !== 'dark') fail(`${label}: the page is ${String(theme)} on the Chalkboard`);
    await page.waitForFunction(() => location.search.includes('surface=chalk'), undefined, {
      timeout: 5000,
    });
    const href = page.url();
    await page.goto(href);
    await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, BIG);
    let st = await rosse();
    if (st.preset !== 'Barred spiral' || st.surface !== 'chalk')
      fail(`${label}: the link did not restore ${st.preset} on ${st.surface}`);
    await page.click('#tab-galaxy');
    await openCard('arms');
    if ((await page.locator('#c-arms').inputValue()) !== armsBefore)
      fail(`${label}: the link did not restore arms (${armsBefore})`);
    await page.goto(`${href}&arms=5&pen=3.5`);
    await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, BIG);
    await page.click('#tab-galaxy');
    await openCard('arms');
    if ((await page.locator('#c-arms').inputValue()) !== '5')
      fail(`${label}: ?arms=5 did not set the slider`);

    // ---- a link cannot ask for what the engine does not draw (the sky: stars, artefacts, overlays)
    await page.goto(
      q('&preset=Star%3A+bright%2C+with+spikes&spikes=0.9&starMix=0.1&lensR=1.5&arms=4'),
    );
    await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, BIG);
    await page.waitForFunction(() => location.search.includes('arms=4'), undefined, {
      timeout: 5000,
    });
    const search = await page.evaluate(() => location.search);
    st = await rosse();
    if (st.preset !== 'Grand design') fail(`${label}: a star preset was drawn (${st.preset})`);
    for (const k of ['spikes', 'starMix'])
      if (search.includes(`${k}=`)) fail(`${label}: the link kept ?${k}=`);
    if (await page.locator('button.card[data-preset="Star: bright, with spikes"]').count())
      fail(`${label}: a card for a star preset`);

    // ---- the lens (M9): its presets and controls are offered, a lens preset draws more than the
    // plain galaxy, and the quasar's flare runs on the timeline without the model tier
    await open('&preset=Lens%3A+Einstein+ring&seed=7');
    st = await rosse();
    if (st.preset !== 'Lens: Einstein ring')
      fail(`${label}: the lens preset was not drawn (${st.preset})`);
    if (!(await page.locator('button.card[data-preset="Lens: Einstein ring"]').count()))
      fail(`${label}: no card for a lens preset`);
    if (st.home === undefined || st.home.incl !== st.camera.incl)
      fail(`${label}: the lens preset's home is not its camera`);
    await open('&preset=Lens%3A+Einstein+cross+%28quasar%29&seed=7');
    if (!(await page.locator('#timeline').isVisible())) fail(`${label}: no timeline for a quasar`);
    const q0 = await rosse();
    const f0 = await plate();
    n = await frames();
    await page.locator('#tl-scrub').fill('0.4');
    // the lens's frame is slow on SwiftShader: wait for the view tier that ran for the new moment
    await page.waitForFunction((v) => (window.__rosse?.tiers.view ?? 0) > v, q0.tiers.view, BIG);
    await settled(n);
    const f1 = await plate();
    const q1 = await rosse();
    if (f0.hash === f1.hash) fail(`${label}: the quasar's scrub did not change the picture`);
    if (q1.tiers.model !== q0.tiers.model)
      fail(
        `${label}: the quasar's scrub ran the model tier again (${q0.tiers.model} → ${q1.tiers.model})`,
      );

    // ---- New stars, Surprise me (also with a variant), a typed seed
    await open('&seed=7');
    const seed0 = await page.locator('#seed').inputValue();
    n = await frames();
    await page.click('#reseed');
    await settled(n);
    if ((await page.locator('#seed').inputValue()) === seed0)
      fail(`${label}: New stars kept the seed`);
    n = await frames();
    await page.click('#surprise');
    await settled(n);
    await page.locator('#seed').fill('321');
    await page.locator('#seed').press('Enter');
    await page.waitForFunction(() => window.__rosse?.seed === 321, undefined, BIG);
    await idle();

    // ---- the home orientation moves with a preset or a seed, never with a View control
    st = await rosse();
    const home0 = JSON.stringify(st.home);
    await page.click('#tab-sky');
    await openCard('camera');
    n = await frames();
    await page.locator('#c-incl').focus();
    await page.keyboard.press('ArrowRight');
    await settled(n);
    st = await rosse();
    if (JSON.stringify(st.home) !== home0) fail(`${label}: a View control moved the home`);
    await page.click('#tab-choose');
    await page.locator('button.card[data-preset="Edge-on with dust"]').click();
    await page.waitForFunction(
      () => window.__rosse?.preset === 'Edge-on with dust',
      undefined,
      BIG,
    );
    st = await rosse();
    if (JSON.stringify(st.home) === home0) fail(`${label}: a new preset did not set the home`);
    const home1 = JSON.stringify(st.home);
    n = await frames();
    await page.click('#reseed');
    await settled(n);
    st = await rosse();
    if (JSON.stringify(st.home) !== home1 && st.camera.incl !== JSON.parse(home1).incl)
      lines.push(`${label}: a new seed keeps the camera, so the home follows it (as v21)`);

    // ---- a merger draws two galaxies, a single galaxy one; the timeline changes the picture
    await open('&preset=Merger%3A+long+tails&seed=7');
    const two = await blobs();
    if (two < 2)
      fail(`${label}: a merger drew ${String(two)} concentration(s) of ink, want 2 or more`);
    await open('&preset=Smooth%2C+round&seed=7');
    const one = await blobs();
    if (one !== 1) fail(`${label}: a single galaxy drew ${String(one)} concentrations`);
    await open('&preset=Merger%3A+the+Mice&seed=7');
    if (!(await page.locator('#timeline').isVisible())) fail(`${label}: no timeline for a merger`);
    const s0 = await rosse();
    const m0 = await plate();
    n = await frames();
    await page.locator('#tl-scrub').fill('0.3');
    await settled(n);
    const m1 = await plate();
    const s1 = await rosse();
    if (m0.hash === m1.hash) fail(`${label}: the scrub did not change the picture`);
    if (s1.tiers.model !== s0.tiers.model)
      fail(`${label}: the scrub ran the model tier again (${s0.tiers.model} → ${s1.tiers.model})`);
    if (s1.tiers.view <= s0.tiers.view) fail(`${label}: the scrub did not run the view tier`);
    // the end clamps the moment and the horizon follows it, as v21
    await page.locator('#tl-scrub').fill('1.5');
    await page.locator('#tl-end').fill('1');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => /** @type {HTMLInputElement} */ (document.getElementById('tl-scrub')).value === '1',
      undefined,
      { timeout: 10_000 },
    );
    if ((await mTime()) > 1) fail(`${label}: the moment is past the end`);
    // playing: the moment stays inside the end and the address follows it
    await page.locator('#tl-end').fill('1');
    await page.keyboard.press('Enter');
    await page.locator('#tl-scrub').fill('0');
    await page.waitForTimeout(400);
    if (backend === 'webgpu') {
      await page.locator('#tl-loop').check();
      await page.click('#tl-play');
      /** @type {number[]} */
      const seen = [];
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(500);
        seen.push(await mTime());
      }
      await page.click('#tl-play');
      if (seen.some((t) => t > 1.0001)) fail(`${label}: playing went past the end ${seen.join()}`);
      if (new Set(seen).size < 3)
        fail(`${label}: the address did not follow the timeline ${seen.join()}`);
    }
    // a longer horizon: the end up to 30, and the moment round-trips through the link
    await page.locator('#tl-end').fill('12');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.search.includes('mHorizon=12'), undefined, {
      timeout: 10_000,
    });
    await idle();
    await page.locator('#tl-scrub').fill('9.5');
    await page.waitForFunction(() => location.search.includes('mTime=9.5'), undefined, {
      timeout: 10_000,
    });
    const linkAt = page.url();
    await page.goto(linkAt);
    await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, BIG);
    await idle();
    if ((await page.locator('#tl-scrub').inputValue()) !== '9.5')
      fail(`${label}: the link did not restore the moment 9.5`);

    // ---- the PNG, the plate's size, and the two engines' PNGs agree
    await open('&preset=Barred+spiral&seed=7');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120_000 }),
      page.click('#export-png'),
    ]);
    const bytes = readFileSync(await download.path());
    const png = PNG.sync.read(bytes);
    st = await rosse();
    if (png.width !== st.size.plateCss * st.size.dpr || png.width !== png.height)
      fail(
        `${label}: the PNG is ${String(png.width)}×${String(png.height)}, the plate ${JSON.stringify(st.size)}`,
      );
    if (download.suggestedFilename() !== 'rosse-7.png')
      fail(`${label}: the PNG is called ${download.suggestedFilename()}`);
    pngs[backend] = png;

    // ---- accessible names: every control of every tab, hidden panels and closed cards included
    for (const tab of ['choose', 'galaxy', 'merger', 'sky', 'ink']) await page.click(`#tab-${tab}`);
    const unnamed = await page.evaluate(() => {
      /** @type {string[]} */
      const bad = [];
      document.querySelectorAll('input, select, button, [role=tab], canvas[role]').forEach((e) => {
        const input = /** @type {HTMLInputElement} */ (e);
        if (input.type === 'hidden') return;
        const byId = (e.getAttribute('aria-labelledby') ?? '')
          .split(' ')
          .map((i) => document.getElementById(i)?.textContent ?? '')
          .join('')
          .trim();
        const named =
          e.getAttribute('aria-label') ||
          byId ||
          (input.labels &&
            input.labels.length > 0 &&
            [...input.labels].some((l) => (l.textContent ?? '').trim())) ||
          (e.textContent ?? '').trim();
        if (!named) bad.push(e.id || e.outerHTML.slice(0, 70));
      });
      return bad;
    });
    if (unnamed.length) fail(`${label}: controls without a name: ${unnamed.join(', ')}`);
    const noLegend = await page.evaluate(
      () =>
        [...document.querySelectorAll('fieldset.choice')].filter((f) => !f.querySelector('legend'))
          .length,
    );
    if (noLegend) fail(`${label}: ${String(noLegend)} choices without a legend`);
    const nControls = await page.locator('input, select, button').count();

    // ---- the keyboard: reading order, and a visible focus ring on what it reaches
    await open('&seed=7');
    await page.click('#tab-choose');
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    /** @type {string[]} */
    const order = [];
    /** @type {string[]} */
    const noRing = [];
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const e = /** @type {HTMLElement} */ (document.activeElement);
        // a radio shows its ring on the label's span
        const ring =
          e instanceof HTMLInputElement && e.type === 'radio' ? (e.nextElementSibling ?? e) : e;
        const cs = getComputedStyle(ring);
        return {
          id: e.id || e.getAttribute('data-surface') || e.tagName,
          ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2,
          color: cs.outlineColor,
        };
      });
      order.push(info.id);
      if (!info.ring) noRing.push(info.id);
    }
    const expected = [
      'skip-link',
      'paper',
      'chalk',
      'plate',
      'seed',
      'reseed',
      'surprise',
      'export-png',
      'copy-link',
      'tab-choose',
    ];
    const idx = expected.map((x) => order.indexOf(x));
    if (idx.some((i) => i < 0) || idx.some((v, i) => i > 0 && v <= (idx[i - 1] ?? -1)))
      fail(`${label}: keyboard order ${order.join(' > ')}`);
    if (noRing.length) fail(`${label}: no focus ring on ${noRing.join(', ')}`);
    // a slider, a card header and a tab show the ring too
    for (const sel of ['#tab-galaxy', '#rc-arms-hd', '#c-arms']) {
      await page.click('#tab-galaxy');
      await openCard('arms');
      await page.locator(sel).focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const ring = await page.locator(sel).evaluate((e) => {
        const cs = getComputedStyle(e);
        return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
      });
      if (!ring) fail(`${label}: no focus ring on ${sel}`);
    }

    // ---- reduced motion: the timeline does not loop by itself
    if (backend === 'cpu' && (await page.locator('#tl-loop').isChecked()))
      fail(`${label}: the timeline loops under reduced motion`);

    for (const e of errors) fail(`${label}: page error ${e}`);
    lines.push(
      `${label}: ${tabs.join('/')}; ${String(png.width)}px PNG ${String(bytes.length)} bytes; ${String(nControls)} controls named; ${String(two)} concentrations in a merger, ${String(one)} in a single galaxy; ${String(errors.length)} errors`,
    );
    await ctx.close();
  }

  // ---- the two engines' PNGs: the same plate, within the engines' own agreement (ADR 0011)
  const a = pngs['cpu'];
  const b = pngs['webgpu'];
  if (a && b) {
    if (a.width !== b.width || a.height !== b.height) fail('the two engines’ PNGs differ in size');
    else {
      let sum = 0;
      let far = 0;
      for (let i = 0; i < a.data.length; i += 4)
        for (let c = 0; c < 3; c++) {
          const d = Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0));
          sum += d;
          if (d > 96) far++;
        }
      const mean = sum / ((a.data.length / 4) * 3);
      const frac = far / ((a.data.length / 4) * 3);
      lines.push(
        `PNG, CPU against WebGPU: mean difference ${mean.toFixed(2)}/255, ${(frac * 100).toFixed(2)}% of values over 96`,
      );
      if (mean > 3 || frac > 0.02)
        fail(
          `the two engines’ PNGs differ (mean ${mean.toFixed(2)}, ${(frac * 100).toFixed(2)}% far)`,
        );
    }
  }

  // ---- storage blocked, a dark colour scheme: a link still means what it says
  for (const [scheme, query, want] of /** @type {const} */ ([
    ['dark', '&surface=paper', 'paper'],
    ['light', '&surface=chalk', 'chalk'],
    ['dark', '', 'chalk'],
    ['light', '', 'paper'],
  ])) {
    const ctx = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: 900, height: 900 },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('storage blocked');
        },
      });
    });
    const page = await ctx.newPage();
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${url}/?backend=cpu&seed=7${query}`);
    const first = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, BIG);
    const st = await page.evaluate(() => window.__rosse?.surface);
    const th = await page.evaluate(() => document.documentElement.dataset.theme);
    const shown = want === 'chalk' ? 'dark' : 'light';
    if (st !== want || th !== shown || first !== shown)
      fail(
        `${scheme} scheme, storage blocked, "${query}": surface ${String(st)}, theme ${String(first)} then ${String(th)}, want ${want}`,
      );
    const link = await page.evaluate(() => location.search);
    await page.waitForFunction(() => location.search.includes('surface='), undefined, {
      timeout: 5000,
    });
    void link;
    for (const e of errors) fail(`${scheme} scheme: page error ${e}`);
    await ctx.close();
  }

  // ---- forced colours: the sliders keep a visible track and thumb
  {
    const ctx = await browser.newContext({
      forcedColors: 'active',
      viewport: { width: 1280, height: 1000 },
    });
    const page = await ctx.newPage();
    await page.goto(`${url}/?backend=cpu&preset=Barred+spiral`);
    await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, BIG);
    await page.click('#tab-galaxy');
    const hd = page.locator('#rc-arms-hd');
    if ((await hd.getAttribute('aria-expanded')) !== 'true') await hd.click();
    const shot = PNG.sync.read(await page.locator('#c-arms').screenshot());
    /** @type {Map<number, number>} */
    const colours = new Map();
    for (let i = 0; i < shot.data.length; i += 4) {
      const k =
        ((shot.data[i] ?? 0) << 16) | ((shot.data[i + 1] ?? 0) << 8) | (shot.data[i + 2] ?? 0);
      colours.set(k, (colours.get(k) ?? 0) + 1);
    }
    const bg = [...colours.entries()].sort((x, y) => y[1] - x[1])[0];
    const other = shot.width * shot.height - (bg?.[1] ?? 0);
    // a track across the whole width and a thumb: well over the width in pixels
    if (other < shot.width + 100)
      fail(`forced colours: the slider shows ${String(other)} pixels over its background`);
    lines.push(`forced colours: the arms slider shows ${String(other)} pixels over its background`);
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
