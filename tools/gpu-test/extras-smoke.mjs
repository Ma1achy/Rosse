// @ts-check
/**
 * The page's M12 smoke test: the SVG and GIF exports, the real galaxies and the catalogue, driven
 * through Playwright on the CPU engine (in its worker) and on WebGPU (SwiftShader, `?present=copy`).
 *
 * - Export SVG: the file is well-formed, its layers are v21's, in v21's order, as many elements as
 *   the status line says; a Grand design has arms, dust, dots and cores; a deep field has a
 *   background layer; a merger is exported too;
 * - Export GIF (a merger): the button is offered for a merger and not for a single galaxy; the GIF
 *   has the frame count and size asked for, loops forever, and its frames differ;
 * - the real galaxies: a print draws its galaxy (`?from=real:<n>` in the address), the card shows
 *   the photograph beside the drawing and the credit, and the link draws the same pixels again;
 * - the catalogue: opening it loads it; a type's random galaxy and a search each draw a galaxy
 *   (`?from=gz2:<id>`), its card has the caption and the credit, and the link draws the same pixels;
 *   Find takes a DR7 object id;
 * - a link to a galaxy that does not exist falls back to a preset and says so.
 *
 * `SHOTS=dir node tools/gpu-test/extras-smoke.mjs` also saves screenshots there.
 * Exports `extrasSmokeCheck(browser, url)`.
 */
import { readFileSync } from 'node:fs';

const BIG = { timeout: 600_000 };
const SVG_LAYERS = ['background', 'drawings', 'arms', 'dust', 'cores', 'knots', 'dots', 'stars'];

/** The frames of a GIF: its size, the number of images, the loop count and a hash of each. */
function readGif(/** @type {Buffer} */ b) {
  const head = b.subarray(0, 6).toString('latin1');
  if (head !== 'GIF89a' && head !== 'GIF87a') throw new Error('not a GIF');
  const width = b.readUInt16LE(6);
  const height = b.readUInt16LE(8);
  const flags = b[10] ?? 0;
  let p = 13 + (flags & 0x80 ? 3 * (2 << (flags & 7)) : 0);
  let images = 0;
  let loops = -1;
  /** @type {string[]} */
  const frames = [];
  while (p < b.length) {
    const t = b[p];
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = b[p + 1];
      p += 2;
      if (label === 0xff) {
        const id = b.subarray(p + 1, p + 12).toString('latin1');
        if (id.startsWith('NETSCAPE')) loops = b.readUInt16LE(p + 13 + 1);
      }
      for (;;) {
        const n = b[p] ?? 0;
        p += 1 + n;
        if (n === 0) break;
      }
    } else if (t === 0x2c) {
      const lf = b[p + 9] ?? 0;
      const start = p;
      p += 10 + (lf & 0x80 ? 3 * (2 << (lf & 7)) : 0) + 1;
      for (;;) {
        const n = b[p] ?? 0;
        p += 1 + n;
        if (n === 0) break;
      }
      images++;
      frames.push(b.subarray(start, p).toString('base64').slice(0, 40000));
    } else throw new Error(`unknown GIF block ${String(t)}`);
  }
  return { width, height, images, loops, frames };
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} url
 */
export async function extrasSmokeCheck(browser, url) {
  /** @type {string[]} */
  const lines = [];
  let pass = true;
  const fail = (/** @type {string} */ m) => {
    pass = false;
    lines.push(`FAIL ${m}`);
  };
  const shots = process.env.SHOTS;
  /** `PARTS=gif,real` runs only those parts; `BACKENDS=cpu` only that engine */
  const want = (/** @type {string} */ k) =>
    !process.env.PARTS || process.env.PARTS.split(',').includes(k);

  for (const backend of (process.env.BACKENDS ?? 'cpu,webgpu').split(',')) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 1200 },
      acceptDownloads: true,
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('crash', () => {
      console.error(`${backend}: the page crashed`);
    });
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const q = (/** @type {string} */ query) =>
      `${url}/?backend=${backend}${backend === 'webgpu' ? '&present=copy' : ''}&surface=paper${query}`;
    const idle = async () => {
      try {
        await page.waitForFunction(
          () => !(document.getElementById('stats')?.textContent ?? '').includes('Simulating'),
          undefined,
          BIG,
        );
      } catch (e) {
        const seen = await page
          .evaluate(
            () =>
              `${document.getElementById('stats')?.textContent ?? ''} | ${document.getElementById('status')?.textContent ?? ''} | ${document.getElementById('note')?.textContent ?? ''}`,
          )
          .catch(() => 'the page is gone');
        throw new Error(`the page never stopped simulating: ${seen}`, { cause: e });
      }
    };
    /** the link's `from`, once it is no longer `prev` (the address is written a moment after a draw) */
    const fromAfter = async (/** @type {string | null} */ prev) => {
      await page.waitForFunction(
        (p) => new URLSearchParams(location.search).get('from') !== p,
        prev,
        BIG,
      );
      return new URL(page.url()).searchParams.get('from') ?? '';
    };
    const frames = () => page.evaluate(() => window.__rosse?.frames ?? 0);
    const open = async (/** @type {string} */ query) => {
      await page.goto(q(query));
      await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, BIG);
      await idle();
    };
    const after = async (/** @type {number} */ n) => {
      await page.waitForFunction((k) => (window.__rosse?.frames ?? 0) > k, n, BIG);
      await idle();
    };
    /** a hash of the plate's pixels, and how many are ink */
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
    const save = async (/** @type {string} */ name) => {
      if (shots) await page.screenshot({ path: `${shots}/${backend}-${name}.png`, fullPage: true });
    };
    const status = () => page.locator('#status').textContent();
    const label = backend;

    // ---- the SVG
    if (want('svg')) {
      /** @param {string} query */
      const svgOf = async (query) => {
        await open(query);
        const [dl] = await Promise.all([
          page.waitForEvent('download', BIG),
          page.click('#export-svg'),
        ]);
        const text = readFileSync(/** @type {string} */ (await dl.path()), 'utf8');
        const says = (await status()) ?? '';
        return { text, name: dl.suggestedFilename(), says };
      };
      /** the layers of an SVG, in order, with the number of elements in each */
      const layersOf = (/** @type {string} */ svg) =>
        page.evaluate((s) => {
          const d = new DOMParser().parseFromString(s, 'image/svg+xml');
          return [...d.querySelectorAll('g[id]')].map((g) => ({ id: g.id, n: g.children.length }));
        }, svg);
      {
        const r = await svgOf('&preset=Grand+design&seed=7');
        const dom = await page.evaluate((s) => {
          const d = new DOMParser().parseFromString(s, 'image/svg+xml');
          return {
            error: d.querySelector('parsererror')?.textContent ?? null,
            groups: [...d.querySelectorAll('g[id]')].map((g) => g.id),
            viewBox: d.documentElement.getAttribute('viewBox'),
          };
        }, r.text);
        if (dom.error) fail(`${label}: the SVG is not well-formed: ${dom.error.slice(0, 80)}`);
        const ids = dom.groups;
        const order = ids.map((i) => SVG_LAYERS.indexOf(i));
        if (order.some((o) => o < 0) || order.some((o, i) => i && o < (order[i - 1] ?? 0)))
          fail(`${label}: the SVG layers are not v21's, in v21's order: ${ids.join(', ')}`);
        for (const need of ['arms', 'dust', 'dots', 'cores'])
          if (!ids.includes(need)) fail(`${label}: a Grand design SVG has no ${need} layer`);
        if (dom.viewBox !== '0 0 800 800') fail(`${label}: the SVG's viewBox is ${dom.viewBox}`);
        if (r.name !== 'rosse-galaxy-7.svg') fail(`${label}: the SVG is called ${r.name}`);
        const total = (await layersOf(r.text)).reduce((a, l) => a + l.n, 0);
        const said = Number(/Saved [^:]+: ([\d,]+) marks/.exec(r.says)?.[1]?.replace(/,/g, ''));
        if (!(total > 1000) || said !== total)
          fail(`${label}: the SVG has ${String(total)} marks and the page says ${r.says}`);
        lines.push(
          `${label}: SVG of Grand design, layers ${ids.join(', ')}; ${String(total)} marks`,
        );
        await save('svg-saved');

        // the same drawing is exported again after the page redrew (the queue let go cleanly)
        const again = await page.evaluate(() => window.__rosse?.frames ?? 0);
        if (again < 1) fail(`${label}: no frame after the SVG export`);
      }
      {
        const r = await svgOf('&preset=Deep+field&seed=7');
        const ls = await layersOf(r.text);
        const bg = ls.find((l) => l.id === 'background');
        if (!bg || bg.n < 100)
          fail(`${label}: a Deep field SVG has a background of ${String(bg?.n)}`);
        lines.push(`${label}: SVG of the Deep field, background ${String(bg?.n)} marks`);
      }
      {
        const r = await svgOf('&preset=Merger%3A+the+Mice&seed=7');
        const total = (await layersOf(r.text)).reduce((a, l) => a + l.n, 0);
        if (!(total > 500)) fail(`${label}: a merger's SVG has ${String(total)} marks`);
        lines.push(`${label}: SVG of the Mice, ${String(total)} marks`);
      }
    }
    // ---- the GIF
    if (want('gif')) {
      await open('&preset=Grand+design&seed=7');
      if (await page.locator('#export-gif').isVisible())
        fail(`${label}: Export GIF is offered for a single galaxy`);
      await open('&preset=Merger%3A+the+Mice&seed=7&mTime=0.4');
      if (!(await page.locator('#export-gif').isVisible()))
        fail(`${label}: Export GIF is not offered for a merger`);
      {
        await page.selectOption('#gif-frames', '24');
        await page.selectOption('#gif-size', '320');
        const before = await plate();
        const n = await frames();
        const [dl] = await Promise.all([
          page.waitForEvent('download', BIG),
          page.click('#export-gif'),
        ]);
        const bytes = readFileSync(/** @type {string} */ (await dl.path()));
        const gif = readGif(bytes);
        if (gif.images !== 24) fail(`${label}: the GIF has ${String(gif.images)} frames, not 24`);
        if (gif.width !== 320 || gif.height !== 320)
          fail(`${label}: the GIF is ${String(gif.width)} × ${String(gif.height)}`);
        if (gif.loops !== 0) fail(`${label}: the GIF does not loop forever`);
        if (new Set(gif.frames).size < 20) fail(`${label}: the GIF's frames hardly differ`);
        if (dl.suggestedFilename() !== 'rosse-merger-7.gif')
          fail(`${label}: the GIF is called ${dl.suggestedFilename()}`);
        // the page is put back: drawn again at its own size and moment
        await after(n);
        const afterwards = await plate();
        if (afterwards.hash !== before.hash)
          fail(`${label}: the plate is not what it was after the GIF`);
        const mt = new URL(page.url()).searchParams.get('mTime');
        if (mt !== '0.4') fail(`${label}: the moment is ${String(mt)} after the GIF, not 0.4`);
        lines.push(
          `${label}: GIF of the Mice: ${String(gif.images)} frames at ${String(gif.width)} px, ${String(Math.round(bytes.length / 1024))} KB, loops forever; the plate and the moment as they were`,
        );
        await save('gif-saved');
      }
      // the quasar's flare
      await open('&preset=Lens%3A+Einstein+cross+%28quasar%29&seed=7');
      if (!(await page.locator('#export-gif').isVisible()))
        fail(`${label}: Export GIF is not offered for a lensed quasar`);
      else {
        await page.selectOption('#gif-frames', '24');
        const [dl] = await Promise.all([
          page.waitForEvent('download', BIG),
          page.click('#export-gif'),
        ]);
        const gif = readGif(readFileSync(/** @type {string} */ (await dl.path())));
        if (gif.images !== 24 || new Set(gif.frames).size < 4)
          fail(
            `${label}: the quasar's GIF has ${String(gif.images)} frames, ${String(new Set(gif.frames).size)} different`,
          );
        lines.push(
          `${label}: GIF of the quasar flare: ${String(gif.images)} frames, ${String(new Set(gif.frames).size)} different`,
        );
      }
    }
    // ---- the real galaxies
    if (want('real')) {
      await open('&preset=Grand+design&seed=7');
      await page.click('#tab-choose');
      const prints = await page.locator('button.print-card').count();
      if (prints !== 42) fail(`${label}: ${String(prints)} prints, not 42`);
      {
        const n = await frames();
        await page.locator('button.print-card[data-real="6"]').click();
        await after(n);
        await page.waitForFunction(() => location.search.includes('from=real'), undefined, BIG);
        const href = new URL(page.url());
        if (href.searchParams.get('from') !== 'real:6')
          fail(`${label}: the address says from=${String(href.searchParams.get('from'))}`);
        if (href.searchParams.get('preset')) fail(`${label}: the address still names a preset`);
        const card = page.locator('#real-open');
        await card.waitFor({ state: 'visible' });
        await page.waitForFunction(
          () => !!document.querySelector('#real-open canvas.drawing'),
          undefined,
          BIG,
        );
        const text = (await card.textContent()) ?? '';
        if (!/Creative Commons|CC BY 4\.0/.test(text) || !/Galaxy Zoo/.test(text))
          fail(`${label}: the real galaxy's card does not carry its credit`);
        const drawn = await page.evaluate(() => {
          const c = /** @type {HTMLCanvasElement | null} */ (
            document.querySelector('#real-open canvas.drawing')
          );
          const d = c?.getContext('2d')?.getImageData(0, 0, 160, 160).data;
          let dark = 0;
          for (let i = 0; i < (d?.length ?? 0); i += 4) if ((d?.[i] ?? 255) < 120) dark++;
          return dark;
        });
        if (drawn < 200)
          fail(`${label}: the card's drawing is blank (${String(drawn)} dark pixels)`);
        const photoOk = await page.evaluate(() => {
          const i = /** @type {HTMLImageElement | null} */ (
            document.querySelector('#real-open .compare img')
          );
          return !!i && i.complete && i.naturalWidth > 0;
        });
        if (!photoOk) fail(`${label}: the card's photograph did not load`);
        const here = await plate();
        if (here.ink < 3000)
          fail(`${label}: the real galaxy's plate has ${String(here.ink)} ink pixels`);
        await save('real-card');
        // the link draws the same pixels
        const link = page.url();
        await page.goto(link);
        await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, BIG);
        await idle();
        const again = await plate();
        if (again.hash !== here.hash)
          fail(`${label}: the link ${link.slice(-60)} draws other pixels than the print did`);
        if ((await page.locator('#real-open').isHidden()) === true)
          fail(`${label}: the link does not open the galaxy's card`);
        lines.push(
          `${label}: real galaxy 6: from=real:6 in the address, card with photograph, drawing (${String(drawn)} dark px) and credit; the link draws the same pixels`,
        );
      }
    }
    // ---- the catalogue
    if (want('cat')) {
      await open('&preset=Grand+design&seed=7');
      await page.click('#tab-choose');
      {
        await page.click('#cat-open');
        await page.locator('#cat-type').waitFor({ state: 'visible', timeout: 600_000 });
        await page.waitForFunction(
          () => (document.getElementById('cat-open')?.hidden ?? false) === true,
          undefined,
          BIG,
        );
        await page.selectOption('#cat-type', 'barred');
        let n = await frames();
        await page.click('#cat-random');
        await after(n);
        await page.waitForFunction(() => location.search.includes('from=gz2'), undefined, BIG);
        const from1 = new URL(page.url()).searchParams.get('from') ?? '';
        if (!/^gz2:\d{15,20}$/.test(from1))
          fail(`${label}: the random galaxy's address says from=${from1}`);
        const cardText = (await page.locator('#cat-open-card').textContent()) ?? '';
        if (!/Galaxy \d{15,20} at RA/.test(cardText) || !/CC BY 4\.0/.test(cardText))
          fail(
            `${label}: the catalogue card lacks its caption or its credit: ${cardText.slice(0, 80)}`,
          );
        const first = await plate();
        if (first.ink < 1500)
          fail(`${label}: the catalogue galaxy's plate has ${String(first.ink)} ink`);
        await save('catalogue-random');
        // a search
        await page.fill('#cat-gr-min', '0.9');
        n = await frames();
        await page.click('#cat-search');
        await page.locator('#cat-results button.cat-card').first().waitFor({ timeout: 600_000 });
        const found = await page.locator('#cat-results button.cat-card').count();
        if (found < 1 || found > 12) fail(`${label}: the search listed ${String(found)} galaxies`);
        const stateText = (await page.locator('.cat-state').textContent()) ?? '';
        if (!/match/.test(stateText)) fail(`${label}: the search says "${stateText}"`);
        await page.locator('#cat-results button.cat-card').nth(1).click();
        await after(n);
        const from2 = await fromAfter(from1);
        if (!/^gz2:\d{15,20}$/.test(from2) || from2 === from1)
          fail(`${label}: the search result drew from=${from2}`);
        await save('catalogue-search');
        // Find by object id
        n = await frames();
        await page.fill('#cat-find', from1.slice(4));
        await page.click('#cat-find-go');
        await after(n);
        const foundFrom = await fromAfter(from2);
        if (foundFrom !== from1) fail(`${label}: Find ${from1.slice(4)} drew ${foundFrom}`);
        const found1 = await plate();
        if (found1.hash !== first.hash) fail(`${label}: Find drew other pixels than Random did`);
        // the link round trip, with an edit on top
        await page.goto(page.url());
        await page.waitForFunction(() => (window.__rosse?.frames ?? 0) >= 1, undefined, BIG);
        await idle();
        const back = await plate();
        if (back.hash !== first.hash) fail(`${label}: the catalogue link draws other pixels`);
        lines.push(
          `${label}: catalogue: random barred ${from1}, a search of ${String(found)} listed, Find by object id, and the link draw the same pixels; card with caption and credit`,
        );
      }
    }
    // a galaxy that does not exist
    if (want('missing')) {
      await open('&from=gz2:123456789012345678&seed=7');
      {
        const s = (await status()) ?? '';
        const r = await page.evaluate(() => window.__rosse?.preset);
        if (!/could not be found/.test(s) || !r)
          fail(`${label}: a missing galaxy says "${s}" and draws ${String(r)}`);
        await open('&from=real:99&seed=7');
        if (!/could not be found/.test((await status()) ?? ''))
          fail(`${label}: real:99 is not reported`);
      }
    }
    if (errors.length)
      fail(`${label}: ${String(errors.length)} errors: ${errors.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
  return { name: 'the extras (SVG, GIF, real galaxies, catalogue)', pass, lines };
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const { launch, prepareAssets, startServer } = await import('./browser.mjs');
  prepareAssets();
  const server = await startServer();
  const browser = await launch();
  try {
    const r = await extrasSmokeCheck(browser, server.url);
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
    for (const l of r.lines) console.log(`      ${l}`);
    process.exitCode = r.pass ? 0 : 1;
  } finally {
    await browser.close();
    await server.close();
  }
}
