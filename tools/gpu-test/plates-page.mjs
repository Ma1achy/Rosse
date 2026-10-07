// @ts-check
/**
 * The plates check (M6): the page's Plates choice (the Ink tab's Print group), driven through Playwright, on WebGPU (SwiftShader,
 * `?present=copy`) and on the CPU engine.
 *
 * `Stellar populations` opens on the colour plates. Choosing `ink`, `slipped CMY plates` and
 * `colour by population` in turn must:
 *
 * - change the plate as v21 prints it: the colour plate has coloured ink, `ink` has none, the
 *   slipped plates have coloured fringes; going back to `colour` gives the first frame's pixels
 *   exactly;
 * - run no tier (ADR 0010): the model and view tier counters do not move;
 * - on the Chalkboard, the colour plate's inks are the lighter ones (another frame), and it comes
 *   back to the first frame on Paper.
 */

/**
 * @param {import('playwright').Browser} browser
 * @param {string} url
 */
export async function platesPageCheck(browser, url) {
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
    const q = `preset=${encodeURIComponent('Stellar populations')}&seed=7&backend=${backend}${backend === 'webgpu' ? '&present=copy' : ''}`;
    await page.goto(`${url}/?${q}`);
    await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, {
      timeout: 120_000,
    });
    // Plates are in the Print group of the Ink tab
    await page.click('#tab-ink');
    /** the plate: a hash, and how many pixels are clearly coloured (max − min of RGB > 70) */
    const look = () =>
      page.evaluate(() => {
        const c = /** @type {HTMLCanvasElement} */ (document.getElementById('plate'));
        const ctx = c.getContext('2d');
        if (!ctx) return { hash: 'no 2d context', coloured: -1 };
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let h = 2166136261;
        let coloured = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i] ?? 0;
          const g = d[i + 1] ?? 0;
          const b = d[i + 2] ?? 0;
          if (Math.max(r, g, b) - Math.min(r, g, b) > 70) coloured++;
          h = Math.imul(h ^ r, 16777619) >>> 0;
          h = Math.imul(h ^ g, 16777619) >>> 0;
          h = Math.imul(h ^ b, 16777619) >>> 0;
        }
        return { hash: h.toString(16), coloured };
      });
    /** @returns {Promise<{ frames: number, plates: string, surface: string, tiers: { model: number, view: number } }>} */
    const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__rosse)));
    /** waits for a frame, after the one counted, that shows these plates on this surface */
    const settle = async (
      /** @type {number} */ after,
      /** @type {string} */ plates,
      /** @type {string} */ surface,
    ) => {
      await page.waitForFunction(
        ({ n, plates, surface }) => {
          const r = window.__rosse;
          return !!r && r.frames > n && r.plates === plates && r.surface === surface;
        },
        { n: after, plates, surface },
        { timeout: 120_000 },
      );
    };
    let surface = 'paper';
    const choose = async (/** @type {string} */ plates) => {
      const before = (await state()).frames;
      await page.locator(`input[name="c-plates"][value="${plates}"]`).check();
      await settle(before, plates, surface);
      return look();
    };
    const first = await look();
    const s0 = await state();
    const label = `${backend}`;
    if ((await page.locator('input[name="c-plates"]:checked').inputValue()) !== 'colour')
      fail(`${label}: the menu does not show the preset's plates`);
    if (first.coloured < 300)
      fail(`${label}: the colour plate has ${String(first.coloured)} coloured pixels`);
    const ink = await choose('ink');
    if (ink.coloured > 0)
      fail(`${label}: the ink plate has ${String(ink.coloured)} coloured pixels`);
    if (ink.hash === first.hash) fail(`${label}: choosing ink changed nothing`);
    const slip = await choose('slip');
    if (slip.coloured < 300)
      fail(`${label}: the slipped plates have ${String(slip.coloured)} coloured pixels`);
    if (slip.hash === ink.hash || slip.hash === first.hash)
      fail(`${label}: slipped plates look like another plate`);
    const back = await choose('colour');
    if (back.hash !== first.hash) fail(`${label}: colour plate again is not the first frame`);
    const s1 = await state();
    if (s1.tiers.model !== s0.tiers.model || s1.tiers.view !== s0.tiers.view)
      fail(
        `${label}: switching plates ran tiers (${JSON.stringify(s0.tiers)} → ${JSON.stringify(s1.tiers)})`,
      );
    // the Chalkboard: the colour plate's lighter inks
    const before = (await state()).frames;
    surface = 'chalk';
    await page.click('button[data-surface="chalk"]');
    await settle(before, 'colour', surface);
    const chalk = await look();
    if (chalk.hash === first.hash) fail(`${label}: the Chalkboard looks like Paper`);
    const before2 = (await state()).frames;
    surface = 'paper';
    await page.click('button[data-surface="paper"]');
    await settle(before2, 'colour', surface);
    const paperAgain = await look();
    if (paperAgain.hash !== first.hash) fail(`${label}: Paper again is not the first frame`);
    const s2 = await state();
    if (s2.tiers.model !== s0.tiers.model || s2.tiers.view !== s0.tiers.view)
      fail(`${label}: switching surface ran tiers`);
    for (const e of errors) fail(`${label}: page error ${e}`);
    lines.push(
      `${label}: colour ${String(first.coloured)} coloured px; ink ${String(ink.coloured)}; slip ${String(slip.coloured)}; back to colour identical ${String(back.hash === first.hash)}; tiers ${JSON.stringify(s2.tiers)}`,
    );
    data[backend] = { first, ink, slip, back, chalk, tiers: s2.tiers };
    await page.close();
  }
  return { name: 'the Plates menu (page)', pass, lines, data };
}
