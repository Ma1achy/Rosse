// @ts-check
/**
 * Golden comparison entry point (`npm run golden`), the metric of
 * docs/adr/0013-golden-image-metric.md (see ../README.md).
 *
 * 1. Checks that the reference captures in tests/golden/reference/ are complete and match their
 *    manifest (every ink image present, pixel hashes identical, no page errors).
 * 2. Renders every required case with the new engine, twice over: WebGPU on SwiftShader in
 *    Chromium (./render-gpu.ts, through tests/golden/render.html) and the CPU engine in Node
 *    (./engine-cpu.ts). The required cases are the captures with a `variant` (M2: the
 *    stipple-only captures of tests/golden/extra-cases.json); later milestones add theirs.
 * 3. For each case:
 *    - parity (L2): WebGPU against v21, and the CPU engine against v21, tests (a)–(d) at the
 *      family's parity thresholds (../thresholds.json);
 *    - strict (L1): the CPU engine against WebGPU, (a)–(d) at the strict thresholds;
 *    - L0: WebGPU rendered twice is bit-identical; (e) against the engine's own goldens
 *      (../engine-hashes.json) when they exist.
 *    The engine draws with the reference's hand (its dot pool, recorded at capture), so ink and
 *    pen weight compare the same pen; the result with the engine's own hand is printed too.
 * 4. Writes test-results/golden.json, and tests/golden/diff/<name>.html for each failing case
 *    (every case with --report-all).
 *
 * Options:
 *   --all             also compare every preset capture (informational: never fails the run)
 *   --calibrate       measure "same galaxy, other dots" pairs and write ../thresholds.json and
 *                     ../calibration.json (ADR 0013); needs tests/golden/actual/reroll/ from
 *                     `npm run capture:reference -- --reroll` for the v21 source
 *   --no-gpu          the CPU engine only (no browser)
 *   --only a,b        only the cases whose name contains one of these (for working on a few; the
 *                     run then checks fewer than the required set)
 *   --report-all      a report for every case, not only failing ones
 *   --update-engine   write ../engine-hashes.json from this run (the engine's own goldens)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { ROOT, launch, prepareAssets, startServer } from '../../../tools/gpu-test/browser.mjs';

const args = process.argv.slice(2);
const flag = (/** @type {string} */ f) => args.includes(f);
const dir = resolve(import.meta.dirname, '../reference');
const manifestPath = join(dir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('No tests/golden/reference/manifest.json: run `npm run capture:reference` first.');
  process.exit(1);
}

// 1. integrity of the reference captures
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let bad = 0;
for (const c of manifest.captures) {
  const file = join(dir, `${c.name}.ink.png`);
  try {
    const hash = createHash('sha256')
      .update(PNG.sync.read(readFileSync(file)).data)
      .digest('hex');
    if (hash !== c.inkPixelSha256) throw new Error('pixel hash differs from the manifest');
    if (c.pageErrors) throw new Error(`${c.pageErrors} page errors during capture`);
    for (const ext of ['plate.jpg', 'json'])
      if (!existsSync(join(dir, `${c.name}.${ext}`))) throw new Error(`missing .${ext}`);
  } catch (e) {
    bad++;
    console.error(`FAIL  ${c.name}: ${/** @type {Error} */ (e).message}`);
  }
}
console.log(
  `${manifest.captures.length - bad}/${manifest.captures.length} reference captures intact`,
);
if (bad) process.exit(1);

prepareAssets();
const server = await startServer();
/** @type {any} */
let browser = null;
let failed = 0;
try {
  const vite = server.vite;
  /** @type {typeof import('./node.ts')} */
  const G = await vite.ssrLoadModule('/tests/golden/compare/node.ts');
  const node = new G.GoldenNode(ROOT);

  if (flag('--calibrate')) {
    await calibrate(G, node);
  } else {
    failed = await compareAll(G, node);
  }
} finally {
  if (browser) await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);

/**
 * @param {typeof import('./node.ts')} G
 * @param {import('./node.ts').GoldenNode} node
 */
async function gpuPage() {
  browser = await launch();
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('console', (/** @type {any} */ m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (/** @type {any} */ e) => errors.push(String(e)));
  await page.goto(`${server.url}/tests/golden/render.html`);
  await page.waitForFunction(() => window.__golden !== undefined || window.__goldenError, null, {
    timeout: 120_000,
  });
  const err = await page.evaluate(() => window.__goldenError);
  if (err) throw new Error(`golden render page: ${err}`);
  return { page, errors, adapter: await page.evaluate(() => window.__golden?.adapter) };
}

/**
 * @param {typeof import('./node.ts')} G
 * @param {import('./node.ts').GoldenNode} node
 */
async function compareAll(G, node) {
  const useGpu = !flag('--no-gpu');
  const gpu = useGpu ? await gpuPage() : null;
  if (gpu) console.log(`WebGPU adapter: ${gpu.adapter}`);
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? (args[onlyIdx + 1] ?? '').split(',') : null;
  const required = manifest.captures.filter(
    (/** @type {any} */ c) => c.variant && (!only || only.some((o) => c.name.includes(o))),
  );
  const informational = flag('--all')
    ? manifest.captures.filter((/** @type {any} */ c) => !c.variant && c.surface === 'paper')
    : [];
  const enginePath = join(ROOT, 'tests/golden/engine-hashes.json');
  /** @type {Record<string, string>} */
  const engineHashes = existsSync(enginePath)
    ? JSON.parse(readFileSync(enginePath, 'utf8')).hashes
    : {};
  /** @type {Record<string, string>} */
  const newHashes = {};
  /** @type {any[]} */
  const results = [];
  let fails = 0;
  const pct = (/** @type {number} */ x) => `${(100 * x).toFixed(1)}%`.padStart(7);
  console.log(
    `\n${'case'.padEnd(40)} ${'engine'.padEnd(9)} ${'ink'.padStart(7)} ${'ssim'.padStart(6)} ${'coarse'.padStart(6)} ${'median'.padStart(7)} ${'p90'.padStart(7)}  counts (dots, knots, stars, rstars)  result`,
  );
  for (const c of [...required, ...informational]) {
    const isRequired = !!c.variant;
    const rec = node.record(c.name);
    // the reference's hand, and from M4 (the 'ribbons' cases) the reference's variation and stroke
    // choices: the arms' phases, spurs, clumps and strokes are discrete random choices, like the
    // hand (reference-variation.ts)
    const opts = {
      ...(rec.hand?.length ? { hand: rec.hand } : {}),
      ...(G.usesReferenceVariation(c.variant) ? node.referenceChoices(rec.params) : {}),
    };
    const ref = node.reference(c.name);
    const refM = G.measure(ref);
    const refCounts = G.countsOf(rec.stats);
    const parity = node.parity(rec.preset);
    const strict = node.thresholds.strict;
    /** @type {Record<string, any>} */
    const row = { name: c.name, preset: rec.preset, required: isRequired };

    const zoom = rec.zoom ?? 1;
    const cpu = node.renderCpu(rec.params, opts, zoom);
    const cpuM = G.measure(cpu.alpha);
    /** @type {{ engine: string, alpha: any, measures: any, counts: any }[]} */
    const engines = [{ engine: 'cpu', alpha: cpu.alpha, measures: cpuM, counts: cpu.counts }];
    if (gpu) {
      /** @type {any} */
      const r1 = await gpu.page.evaluate(({ P, o, z }) => window.__golden?.render(P, o, z), {
        P: rec.params,
        o: opts,
        z: zoom,
      });
      /** @type {any} */
      const r2 = await gpu.page.evaluate(({ P, o, z }) => window.__golden?.render(P, o, z), {
        P: rec.params,
        o: opts,
        z: zoom,
      });
      const a1 = G.alphaFromBase64(r1.alpha, r1.width, r1.height);
      const h1 = G.alphaHash(a1);
      const h2 = G.alphaHash(G.alphaFromBase64(r2.alpha, r2.width, r2.height));
      row.l0 = h1 === h2;
      row.gpuHash = h1;
      newHashes[c.name] = h1;
      if (engineHashes[c.name]) row.e = engineHashes[c.name] === h1;
      engines.unshift({ engine: 'webgpu', alpha: a1, measures: G.measure(a1), counts: r1.counts });
      row.gpuMs = Math.round(r1.ms);
    }
    row.cpuMs = Math.round(cpu.ms);
    let pass = true;
    for (const e of engines) {
      const cmp = G.compareMeasures(refM, e.measures);
      const ev = G.evaluate(cmp, refCounts, G.engineCounts(e.counts), parity);
      row[`parity_${e.engine}`] = {
        ...cmp,
        pass: ev.pass,
        failures: ev.failures,
        counts: ev.counts,
      };
      if (!ev.pass) pass = false;
      const counts = ['dots', 'knots', 'stars', 'rstars']
        .map((k) => `${ev.counts[k]?.render}/${ev.counts[k]?.ref}`)
        .join(' ');
      console.log(
        `${c.name.padEnd(40)} ${e.engine.padEnd(9)} ${pct(cmp.inkRel)} ${cmp.ssim.toFixed(3).padStart(6)} ${cmp.ssimCoarse.toFixed(3).padStart(6)} ${pct(cmp.medianRel)} ${pct(cmp.p90Rel)}  ${counts.padEnd(34)} ${ev.pass ? 'pass' : `FAIL ${ev.failures.join('; ')}`}`,
      );
      if (!ev.pass || flag('--report-all'))
        node.writeReport(
          `${c.name}__${e.engine}`,
          { label: 'v21', alpha: ref, measures: refM },
          {
            label: e.engine === 'cpu' ? 'CPU engine' : 'WebGPU',
            alpha: e.alpha,
            measures: e.measures,
          },
          cmp,
          ev,
          [`thresholds: ${JSON.stringify(parity)}`],
        );
    }
    // the engine's own hand, for information
    const own = node.renderCpu(rec.params, {}, zoom);
    const ownCmp = G.compareMeasures(refM, G.measure(own.alpha));
    row.ownHand = ownCmp;
    console.log(
      `${''.padEnd(40)} ${'own hand'.padEnd(9)} ${pct(ownCmp.inkRel)} ${ownCmp.ssim.toFixed(3).padStart(6)} ${ownCmp.ssimCoarse.toFixed(3).padStart(6)} ${pct(ownCmp.medianRel)} ${pct(ownCmp.p90Rel)}  (information only)`,
    );
    if (gpu) {
      const [w, cp] = engines;
      if (w && cp) {
        const cmp = G.compareMeasures(w.measures, cp.measures);
        const ev = G.evaluate(cmp, G.engineCounts(w.counts), G.engineCounts(cp.counts), strict);
        row.strict = { ...cmp, pass: ev.pass, failures: ev.failures };
        console.log(
          `${''.padEnd(40)} ${'CPU=GPU'.padEnd(9)} ${pct(cmp.inkRel)} ${cmp.ssim.toFixed(3).padStart(6)} ${cmp.ssimCoarse.toFixed(3).padStart(6)} ${pct(cmp.medianRel)} ${pct(cmp.p90Rel)}  ${'strict'.padEnd(34)} ${ev.pass ? 'pass' : `FAIL ${ev.failures.join('; ')}`}  L0 ${row.l0 ? 'identical' : 'DIFFERS'}${row.e === undefined ? '' : `  (e) ${row.e ? 'identical' : 'DIFFERS'}`}`,
        );
        if (!ev.pass || !row.l0 || row.e === false) pass = false;
        if (!ev.pass || flag('--report-all'))
          node.writeReport(
            `${c.name}__cpu-vs-webgpu`,
            { label: 'WebGPU', alpha: w.alpha, measures: w.measures },
            { label: 'CPU engine', alpha: cp.alpha, measures: cp.measures },
            cmp,
            ev,
            [`strict thresholds: ${JSON.stringify(strict)}`],
          );
      }
    }
    row.pass = pass;
    results.push(row);
    if (!pass && isRequired) fails++;
  }
  if (gpu?.errors.length) {
    console.log(`WebGPU errors:\n  ${gpu.errors.join('\n  ')}`);
    fails++;
  }
  mkdirSync(join(ROOT, 'test-results'), { recursive: true });
  writeFileSync(
    join(ROOT, 'test-results/golden.json'),
    JSON.stringify({ adapter: gpu?.adapter ?? null, results }, null, 2) + '\n',
  );
  if (flag('--update-engine') && gpu) {
    writeFileSync(
      enginePath,
      JSON.stringify(
        {
          about:
            "The new engine's own goldens (ADR 0013 test e): SHA-256 of the 8-bit ink alpha of each required case, WebGPU on SwiftShader in Chromium. Written by npm run golden -- --update-engine.",
          adapter: gpu.adapter,
          hashes: newHashes,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`wrote ${enginePath}`);
  }
  const req = results.filter((r) => r.required);
  console.log(
    `\n${req.length - fails}/${req.length} required golden cases pass${informational.length ? ` (${results.length - req.length} informational)` : ''}`,
  );
  return fails;
}

/**
 * ADR 0013 calibration: thresholds per family from "same galaxy, other dots" pairs.
 *
 * @param {typeof import('./node.ts')} G
 * @param {import('./node.ts').GoldenNode} node
 */
async function calibrate(G, node) {
  const K = 4;
  /** The single-galaxy presets the M2 engine draws (stipple), per family. */
  const presets = [
    'Grand design',
    'Barred spiral',
    'Flocculent',
    'Hand-drawn arms',
    'Tightly wound',
    'Loose, open arms',
    'Ringed',
    'Disc, no arms',
    'Edge-on with dust',
    'Smooth, round',
    'Cigar-shaped',
    'Deep field',
    'Radio jet',
    'Shell galaxy',
  ];
  /** @type {{ preset: string, family: string, params: any, hand?: number[] }[]} */
  const cases = [];
  for (const preset of presets)
    for (const seed of [7, 4242])
      for (const camera of ['home', 'orbit']) {
        const rec = node.record(`${manifestSlug(preset)}__s${seed}__${camera}`);
        cases.push({ preset, family: G.goldenFamily(preset), params: rec.params });
      }
  for (const c of manifest.captures.filter((/** @type {any} */ x) => x.variant)) {
    const rec = node.record(c.name);
    cases.push({
      preset: `${rec.preset} (${c.variant})`,
      family: G.goldenFamily(rec.preset),
      params: rec.params,
      ...(rec.hand ? { hand: rec.hand } : {}),
    });
  }
  console.log(`calibration: ${cases.length} configurations × ${K} re-keys (new engine)`);
  const eng = node.calibrateEngine(cases, K, (s) => console.log(s));
  console.log('calibration: v21 re-roll pairs');
  const v21 = node.calibrateReroll(join(ROOT, 'tests/golden/actual/reroll'), () => {});
  console.log(`  ${v21.used} v21 pairs whose stipple re-rolled`);

  const ADR = { ink: 0.05, median: 0.1, p90: 0.1, counts: 0.03, countsSmall: 0.1, poisson: 3 };
  /** @type {Record<string, any>} */
  const parity = {};
  /** @type {Record<string, any>} */
  const numbers = {};
  const stats = (/** @type {any[]} */ list) => ({
    ssim: G.summary(list.map((c) => c.ssim)),
    ssimCoarse: G.summary(list.map((c) => c.ssimCoarse)),
    inkAbs: G.summary(list.map((c) => Math.abs(c.inkRel))),
    medianAbs: G.summary(list.map((c) => Math.abs(c.medianRel))),
    p90Abs: G.summary(list.map((c) => Math.abs(c.p90Rel))),
  });
  const floor2 = (/** @type {number} */ x) => Math.floor(x * 100) / 100;
  const ceil3 = (/** @type {number} */ x) => Math.ceil(x * 1000) / 1000;
  for (const family of ['spiral', 'smooth', 'merger', 'lens', 'star', 'artefact']) {
    const list = eng.pairs[family] ?? [];
    numbers[family] = {
      engineRekey: list.length ? stats(list) : null,
      engineOtherStructure: eng.structure[family]?.length ? stats(eng.structure[family]) : null,
      v21Reroll: v21.pairs[family]?.length ? stats(v21.pairs[family]) : null,
    };
    if (!list.length) {
      parity[family] = { ...ADR, ssim: 0.85, ssimCoarse: 0.85, provisional: true };
      continue;
    }
    const s = numbers[family].engineRekey;
    parity[family] = {
      // the ADR's ±5% and ±10% stay as floors: they also cover the renderers' deliberate
      // differences (per-drawing mipmaps, no MSAA, f16 accumulation), which re-draw pairs do not
      ink: Math.max(ADR.ink, ceil3(1.5 * s.inkAbs.p95)),
      ssim: floor2(s.ssim.p5 - 0.02),
      ssimCoarse: floor2(s.ssimCoarse.p5 - 0.02),
      median: Math.max(ADR.median, ceil3(1.5 * s.medianAbs.p95)),
      p90: Math.max(ADR.p90, ceil3(1.5 * s.p90Abs.p95)),
      counts: ADR.counts,
      countsSmall: ADR.countsSmall,
      poisson: ADR.poisson,
    };
  }
  const file = {
    about:
      'Golden thresholds (ADR 0013). parity: the new engine against v21 (L2), per family; strict: the CPU engine against WebGPU (L1). Written by `npm run golden -- --calibrate`; the numbers behind them are in calibration.json and docs/milestones/m2/README.md. Families marked provisional have no engine yet and keep the ADR values.',
    strict: {
      ink: 0.005,
      ssim: 0.98,
      ssimCoarse: 0.98,
      median: 0.02,
      p90: 0.02,
      counts: 0.001,
      countsSmall: 0.001,
      poisson: 0,
    },
    parity,
  };
  writeFileSync(join(ROOT, 'tests/golden/thresholds.json'), JSON.stringify(file, null, 2) + '\n');
  writeFileSync(
    join(ROOT, 'tests/golden/calibration.json'),
    JSON.stringify(
      {
        about:
          'ADR 0013 calibration: per family, summaries of (a)-(c) over "same galaxy, other dots" pairs. engineRekey: the new engine (CPU, L1-equal to WebGPU) re-keying its placement stream, 4 keys per preset, seed and camera (a full re-draw). engineOtherStructure: the orbit camera (az + 35°, incl + 20°) against home, re-keyed (real change of structure, for the margin). v21Reroll: v21 at az and az + 0.3° where its stipple re-rolled (a partial re-draw).',
        keys: K,
        configurations: cases.map(
          (c) => c.preset + ' s' + c.params.seed + ' incl ' + c.params.incl,
        ),
        families: numbers,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ parity, numbers }, null, 1));
}

/** @param {string} s */
function manifestSlug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
