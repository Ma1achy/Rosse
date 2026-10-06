// @ts-check
/**
 * Captures the reference renders (Rosse v21) as golden images.
 *
 * For every preset in the reference's PRESETS, at each seed and each camera, it saves:
 *   <name>.ink.png    the WebGL canvas read back as is: premultiplied ink on transparent, 800 × 800.
 *                     This is what the comparison works on (tests/golden/README.md).
 *   <name>.plate.jpg  the canvas as seen on the page, ink over its Paper or Chalkboard surface, for people.
 *   <name>.json       the full parameters, camera, stats and how the capture was made.
 * plus manifest.json with a SHA-256 of every ink image's pixels.
 *
 * Usage:
 *   node tools/capture-reference/capture.mjs [--out dir] [--only "Grand design,Ringed"] [--verify]
 *   node tools/capture-reference/capture.mjs --extra tests/golden/extra-cases.json [--verify]
 *   node tools/capture-reference/capture.mjs --reroll [--out dir] [--only …]
 *   --verify  capture again into a temporary folder and compare pixel hashes with the manifest.
 *   --extra   capture the cases of a file ({ cameras?, cases: [{ preset, variant, overrides,
 *             seeds?, zoom? }] }): a preset with parameter overrides set after it (and after the
 *             seed), named <preset-slug>--<variant>__s<seed>__<camera>, at its seeds (7 and 4242
 *             by default) and the file's cameras (home and orbit by default), plus the "zoom"
 *             camera (home at zoom 2, through __GEN.zoom) for the seeds a case lists in `zoom`.
 *             They are added to (or replaced in) the existing manifest, which records the file.
 *   --only    presets, comma-separated, or separated by | when a name holds a comma
 *             (--only "Grand design|Loose, open arms").
 *   --cameras capture only these cameras (comma-separated), e.g. --cameras zoom.
 *   --variants  with --extra: only the cases of these variants (comma-separated).
 *             A case with `"calibration": true` is captured and recorded as such: the golden
 *             runner calibrates on it and does not gate it (held-out seeds, ADR 0018).
 *   --reroll  for calibration (ADR 0013): every preset at the home camera and again at az + 0.3°,
 *             which in v21 re-rolls the stipple when dust lanes are on (reference notes 20.1).
 *             Written to tests/golden/actual/reroll/ by default (not committed), with no manifest.
 *
 * How it drives the page: the built page is served over http://localhost, Chromium renders WebGL
 * through SwiftShader (software, so the same on every machine), the canvas is forced to 800 CSS px
 * at device pixel ratio 1 so it matches the plate's 800-unit space (VIEW.W), and the page's own
 * hook window.__GEN sets presets and parameters. The page is reloaded for every (preset, seed)
 * because the reference remembers the camera at which lensed sources and overlays were first
 * placed (homeFor, app23.js:L445): the "home" view is captured first, then the orbited view, so
 * the orbit moves the camera round a scene placed at home, as the reference intends.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
/** @type {typeof import('playwright')} */
const { chromium } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(require.resolve('playwright', { paths: ['/opt/node22/lib/node_modules'] }));
  }
})();

const ROOT = resolve(import.meta.dirname, '../..');
const PAGE = join(ROOT, 'assets/reference/pages/rosse-v21.html');
const SOURCE = join(ROOT, 'assets/reference/rosse-source/app23.js');

export const SEEDS = [7, 4242];
/** Cameras: the preset's own view, then an orbit of 35° round the axis and 20° of tilt. */
export const CAMERAS = /** @type {const} */ (['home', 'orbit']);
export const ORBIT = { az: 35, incl: 20 };
/**
 * The zoom camera of --extra (open question Q8): the home view at zoom 2 (v21's ZOOM, so
 * VIEW.scale = 168, app23.js:L1227), set up from a fresh preset.
 */
export const ZOOM_CAMERA = 2;
/** The re-roll camera of --reroll: a 0.3° orbit (ADR 0013). */
export const REROLL = { az: 0.3 };
/** A few presets also captured on the Chalkboard surface. */
export const CHALK = ['Grand design', 'Merger: the Mice', 'Lens: Einstein ring'];
const BROWSER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const WORKERS = 4;

/** The reference's presets, read from its source so names and overrides can never drift. */
export function readPresets() {
  const src = readFileSync(SOURCE, 'utf8');
  const m = /var PRESETS = (\{[\s\S]*?\n\});/.exec(src);
  if (!m?.[1]) throw new Error('PRESETS not found in app23.js');
  return /** @type {Record<string, Record<string, unknown>>} */ (new Function(`return ${m[1]};`)());
}

/** @param {string} s */
export const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** @param {Buffer} png */
const pixelHash = (png) => createHash('sha256').update(PNG.sync.read(png).data).digest('hex');

const sha256 = (/** @type {Buffer} */ b) => createHash('sha256').update(b).digest('hex');

function serve() {
  const html = readFileSync(PAGE);
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      ok({ server, url: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/` });
    });
  });
}

/**
 * @typedef {{ preset: string, seed: number, chalk: boolean, variant?: string,
 *   overrides?: Record<string, unknown>, calibration?: boolean, cameras: readonly string[] }} Job
 */

/**
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {Job} job
 * @param {string} out
 */
async function captureJob(browser, url, job, out) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1100 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  await context.addInitScript(
    (theme) => {
      try {
        localStorage.setItem('foundry-theme', theme);
      } catch {
        /* storage unavailable: the page defaults to light */
      }
    },
    job.chalk ? 'dark' : 'light',
  );
  const page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.addStyleTag({
    content: '#gl{width:800px!important;height:800px!important;max-width:none!important}',
  });
  await page.waitForFunction(
    () => {
      const c = /** @type {HTMLCanvasElement | null} */ (document.getElementById('gl'));
      const g = /** @type {any} */ (window).__GEN;
      return !!c && c.width === 800 && !!g && g.stats().ms != null;
    },
    null,
    { timeout: 120_000 },
  );
  const results = [];
  for (const camera of job.cameras) {
    const state = await page.evaluate(
      ({ preset, seed, camera, orbit, overrides, reroll, zoom }) => {
        const G = /** @type {any} */ (window).__GEN;
        if (camera === 'home' || camera === 'zoom') {
          G.preset(preset);
          G.set({ seed });
          if (overrides) G.set(overrides);
          if (camera === 'zoom') G.zoom(zoom);
        } else if (camera === 'reroll') {
          const P = G.P();
          G.set({ az: (P.az || 0) + reroll.az });
        } else {
          const P = G.P();
          G.set({
            az: ((((P.az || 0) + orbit.az) % 360) + 360) % 360,
            incl: Math.max(0, Math.min(180, P.incl + orbit.incl)),
          });
        }
        const c = /** @type {HTMLCanvasElement} */ (document.getElementById('gl'));
        return {
          P: JSON.parse(JSON.stringify(G.P())),
          stats: G.stats(),
          // the dot pool of this galaxy's hand (VAR.dotPool, truncated by the page at 400): a
          // cross-check of the offline replay the comparison uses (tests/unit/v21-replay.test.ts)
          hand: G.var().pool,
          canvas: [c.width, c.height],
          ink: c.toDataURL('image/png'),
        };
      },
      {
        preset: job.preset,
        seed: job.seed,
        camera,
        orbit: ORBIT,
        overrides: job.overrides ?? null,
        reroll: REROLL,
        zoom: ZOOM_CAMERA,
      },
    );
    const base = job.variant ? `${slug(job.preset)}--${slug(job.variant)}` : slug(job.preset);
    const name = `${base}__s${job.seed}__${camera}${job.chalk ? '__chalk' : ''}`;
    const ink = Buffer.from(state.ink.split(',')[1] ?? '', 'base64');
    writeFileSync(join(out, `${name}.ink.png`), ink);
    await page
      .locator('#gl')
      .screenshot({ path: join(out, `${name}.plate.jpg`), type: 'jpeg', quality: 85 });
    const record = {
      name,
      preset: job.preset,
      seed: job.seed,
      camera,
      surface: job.chalk ? 'chalkboard' : 'paper',
      ...(job.variant ? { variant: job.variant, overrides: job.overrides } : {}),
      ...(job.calibration ? { calibration: true } : {}),
      sequence:
        camera === 'home' || camera === 'zoom'
          ? [
              `load page (theme ${job.chalk ? 'dark' : 'light'})`,
              `__GEN.preset(${JSON.stringify(job.preset)})`,
              `__GEN.set({ seed: ${job.seed} })`,
              ...(job.overrides ? [`__GEN.set(${JSON.stringify(job.overrides)})`] : []),
              ...(camera === 'zoom' ? [`__GEN.zoom(${String(ZOOM_CAMERA)})`] : []),
            ]
          : camera === 'reroll'
            ? ['after home', `__GEN.set({ az: az + ${REROLL.az} })`]
            : [
                'after home',
                `__GEN.set({ az: az + ${ORBIT.az}, incl: clamp(incl + ${ORBIT.incl}, 0, 180) })`,
              ],
      zoom: camera === 'zoom' ? ZOOM_CAMERA : 1,
      canvas: state.canvas,
      stats: state.stats,
      hand: state.hand,
      params: state.P,
      pageErrors: errors.slice(),
      inkPixelSha256: pixelHash(ink),
      captured: new Date().toISOString(),
    };
    writeFileSync(join(out, `${name}.json`), JSON.stringify(record, null, 2) + '\n');
    results.push(record);
  }
  await context.close();
  return results;
}

/**
 * The manifest's record of the --extra runs: per camera, when it was last captured and with which
 * browser. A run that captures only some cameras (`--cameras zoom`) updates only theirs; each
 * capture also carries its own `captured` time. A manifest from before this record existed (one
 * `generated` for the whole file, from a run of home and orbit) is carried over as those cameras'
 * run, by this function, not by hand. An `--only` run stamps `runs[camera].generated` although it
 * re-made only some of that camera's captures: the per-capture `captured` times are authoritative.
 *
 * @param {any} previous the manifest's `extra`, if any
 * @param {string} file
 * @param {any[]} records this run's captures
 * @param {string} version the browser's version
 */
function extraProvenance(previous, file, records, version) {
  /** @type {Record<string, { generated: string, browser: unknown }>} */
  const runs = { ...(previous?.runs ?? {}) };
  if (previous?.generated && !previous.runs)
    for (const camera of CAMERAS)
      runs[camera] = { generated: previous.generated, browser: previous.browser };
  const now = new Date().toISOString();
  const browser = { name: 'chromium', version, args: BROWSER_ARGS, deviceScaleFactor: 1 };
  for (const camera of new Set(records.map((r) => String(r.camera))))
    runs[camera] = { generated: now, browser };
  return {
    file,
    cameras: {
      home: "the preset's own incl, az, pa",
      orbit: `az + ${String(ORBIT.az)}°, incl + ${String(ORBIT.incl)}° (clamped), from home`,
      zoom: `home at zoom ${String(ZOOM_CAMERA)} (__GEN.zoom)`,
    },
    runs: Object.fromEntries(Object.entries(runs).sort(([a], [b]) => a.localeCompare(b))),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (/** @type {string} */ k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const verify = args.includes('--verify');
  const reroll = args.includes('--reroll');
  const extraFile = opt('--extra');
  const goldenDir = resolve(
    ROOT,
    opt('--out') ?? (reroll ? 'tests/golden/actual/reroll' : 'tests/golden/reference'),
  );
  const out = verify ? mkdtempSync(join(tmpdir(), 'rosse-verify-')) : goldenDir;
  mkdirSync(out, { recursive: true });

  const presets = readPresets();
  const onlyArg = opt('--only');
  const only = onlyArg?.split(onlyArg.includes('|') ? '|' : ',').map((s) => s.trim());
  const onlyCameras = opt('--cameras')
    ?.split(',')
    .map((s) => s.trim());
  const names = Object.keys(presets).filter((n) => !only || only.includes(n));
  /** @type {Job[]} */
  let jobs;
  if (extraFile) {
    /**
     * @type {{ cameras?: string[], cases: { preset: string, variant: string,
     *   overrides: Record<string, unknown>, seeds?: number[], zoom?: number[],
     *   calibration?: boolean }[] }}
     */
    const extra = JSON.parse(readFileSync(resolve(ROOT, extraFile), 'utf8'));
    const fileCams = extra.cameras ?? [...CAMERAS];
    for (const c of fileCams)
      if (!['home', 'orbit'].includes(c)) throw new Error(`unknown camera ${c}`);
    /** the cameras of one (case, seed): the file's, plus zoom where the case's `zoom` lists the seed */
    const camsFor = (/** @type {number[] | undefined} */ zoomSeeds, /** @type {number} */ seed) => {
      const cams = [...fileCams, ...(zoomSeeds?.includes(seed) ? ['zoom'] : [])].filter(
        (c) => !onlyCameras || onlyCameras.includes(c),
      );
      // orbit is reached from home, so it needs home captured first in the same page
      if (cams.includes('orbit') && !cams.includes('home'))
        throw new Error('the orbit camera needs the home camera');
      return cams;
    };
    const variants = opt('--variants')?.split(',').map((s) => s.trim());
    jobs = extra.cases
      .filter((c) => !only || only.includes(c.preset))
      .filter((c) => !variants || variants.includes(c.variant))
      .flatMap((c) => {
        if (!presets[c.preset]) throw new Error(`unknown preset ${c.preset}`);
        const { seeds, zoom, ...rest } = c;
        return (seeds ?? SEEDS)
          .map((seed) => ({ ...rest, seed, chalk: false, cameras: camsFor(zoom, seed) }))
          .filter((j) => j.cameras.length);
      });
  } else if (reroll) {
    jobs = names.flatMap((preset) =>
      SEEDS.map((seed) => ({ preset, seed, chalk: false, cameras: ['home', 'reroll'] })),
    );
  } else {
    jobs = names.flatMap((preset) => [
      ...SEEDS.map((seed) => ({ preset, seed, chalk: false, cameras: CAMERAS })),
      ...(CHALK.includes(preset)
        ? [{ preset, seed: SEEDS[0] ?? 7, chalk: true, cameras: CAMERAS }]
        : []),
    ]);
  }
  const total = jobs.reduce((a, j) => a + j.cameras.length, 0);

  const { server, url } = /** @type {{ server: import('node:http').Server, url: string }} */ (
    await serve()
  );
  const browser = await chromium.launch({ args: BROWSER_ARGS });
  const t0 = Date.now();
  /** @type {any[]} */
  const records = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (next < jobs.length) {
        const job = /** @type {(typeof jobs)[number]} */ (jobs[next++]);
        const r = await captureJob(browser, url, job, out);
        records.push(...r);
        console.log(
          `${records.length}/${total}  ${job.preset}${job.variant ? ` (${job.variant})` : ''}  seed ${job.seed}${job.chalk ? '  chalk' : ''}`,
        );
      }
    }),
  );
  const version = browser.version();
  await browser.close();
  server.close();
  records.sort((a, b) => a.name.localeCompare(b.name));

  if (verify) {
    const manifest = JSON.parse(readFileSync(join(goldenDir, 'manifest.json'), 'utf8'));
    /** @type {Record<string, string>} */
    const want = Object.fromEntries(
      manifest.captures.map((/** @type {any} */ c) => [c.name, c.inkPixelSha256]),
    );
    const bad = records.filter((r) => want[r.name] !== r.inkPixelSha256);
    console.log(
      `verify: ${records.length - bad.length}/${records.length} ink images identical to the manifest`,
    );
    bad.forEach((r) => console.log(`  differs: ${r.name}`));
    process.exit(bad.length ? 1 : 0);
  }

  /** @param {any} r */
  const entry = (r) => ({
    name: r.name,
    preset: r.preset,
    ...(r.variant ? { variant: r.variant, overrides: r.overrides } : {}),
    ...(r.calibration ? { calibration: true } : {}),
    seed: r.seed,
    camera: r.camera,
    ...(r.zoom !== 1 ? { zoom: r.zoom } : {}),
    surface: r.surface,
    inkPixelSha256: r.inkPixelSha256,
    ...(r.captured ? { captured: r.captured } : {}),
    stats: r.stats,
    pageErrors: r.pageErrors.length,
  });
  const manifestPath = join(out, 'manifest.json');
  /** @param {any[]} list */
  const sorted = (list) => list.sort((a, b) => a.name.localeCompare(b.name));

  if (reroll) {
    console.log(`${records.length} re-roll captures in ${out} (no manifest)`);
    return;
  }

  if (extraFile) {
    // add to (or replace in) the existing manifest; everything else in it is kept as it is
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const names = new Set(records.map((r) => r.name));
    manifest.captures = sorted([
      ...manifest.captures.filter((/** @type {any} */ c) => !names.has(c.name)),
      ...records.map(entry),
    ]);
    manifest.extra = extraProvenance(manifest.extra, extraFile, records, version);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`${records.length} extra captures added to ${manifestPath}`);
    return;
  }

  // a full run keeps the extra captures already in the manifest (re-made with --extra)
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const kept = only ? [] : (previous?.captures ?? []).filter((/** @type {any} */ c) => c.variant);
  const manifest = {
    generated: new Date().toISOString(),
    reference: {
      page: 'assets/reference/pages/rosse-v21.html',
      pageSha256: sha256(readFileSync(PAGE)),
      sourceSha256: sha256(readFileSync(SOURCE)),
    },
    browser: { name: 'chromium', version, args: BROWSER_ARGS, deviceScaleFactor: 1 },
    seeds: SEEDS,
    cameras: { home: "the preset's own incl, az, pa", orbit: ORBIT },
    chalkboard: CHALK,
    seconds: Math.round((Date.now() - t0) / 1000),
    ...(kept.length && previous?.extra ? { extra: previous.extra } : {}),
    captures: sorted([...records.map(entry), ...kept]),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${records.length} captures in ${manifest.seconds} s → ${out}`);
}

await main();
