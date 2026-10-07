// @ts-check
/**
 * Golden comparison entry point (`npm run golden`): the metric of
 * docs/adr/0013-golden-image-metric.md as calibrated in docs/adr/0015-golden-metric-as-calibrated-in-m2.md
 * and amended by docs/adr/0018-comparison-draws-and-the-mean-of-k-redraws.md (see ../README.md).
 *
 * 1. Checks that the reference captures in tests/golden/reference/ are complete and match their
 *    manifest (every ink image present, pixel hashes identical, no page errors).
 * 2. Renders every required case with the new engine, twice over: WebGPU on SwiftShader in
 *    Chromium (./render-gpu.ts, through tests/golden/render.html) and the CPU engine in Node
 *    (./engine-cpu.ts). The required cases are the captures with a `variant`
 *    (tests/golden/extra-cases.json). The engine draws v21's own variation (the hand, arms,
 *    spurs, clumps, dust patches, lopsidedness, warp), replayed offline from v21's stream
 *    (./v21.ts), so that only the dots differ; the result with the engine's own variation is
 *    printed for information.
 * 3. For each case:
 *    - parity (L2): WebGPU against v21, and the CPU engine against v21, at the family's parity
 *      thresholds (../thresholds.json): ink, coarse density SSIM, stroke widths, counts, and the
 *      moment and extent test; the σ = 4 px density SSIM is reported, not gated (ADR 0015). Each
 *      measure is the mean over K draws (ADR 0018, K = thresholds.json `keys`): the engine's
 *      canonical draw (key 0) and K − 1 re-draws of the placement stream by the CPU engine
 *      (equal to WebGPU at L1), measured first in parallel processes (--jobs); the canonical
 *      draw alone is printed for information;
 *    - strict (L1): the CPU engine against WebGPU at the strict thresholds;
 *    - L0: WebGPU rendered twice is bit-identical; (e) against the engine's own goldens
 *      (../engine-hashes.json) when they exist.
 * 4. Count gates on full presets: the drawn-star count of the full captures of the acceptance
 *    presets (v21's `STATS.rstars` does not depend on its breathing room), CPU engine.
 * 5. Writes test-results/golden.json, and tests/golden/diff/<name>.html for each failing case
 *    (every case with --report-all).
 *
 * Options:
 *   --all             also compare every preset capture (informational: never fails the run)
 *   --calibrate       measure "same galaxy, other dots" pairs and the negative controls, and write
 *                     ../thresholds.json and ../calibration.json; needs tests/golden/actual/reroll/
 *                     from `npm run capture:reference -- --reroll` for the v21 source
 *   --calibrate-counts  with --families, only re-measure the count tolerances of these families
 *                     (ADR 0035), leaving their other thresholds as they are: minutes, no rasters
 *   --families a,b    with --calibrate, only these families (and their `@zoom`): their thresholds
 *                     and numbers replace the files' own and the other families are kept as they
 *                     are (M7 calibrated the star, artefact, layered and deepfield families so)
 *     --keys K        the K of the mean (default 6, ADR 0018)
 *     --resume        keep what a stopped calibration measured (test-results/calibration-shard-*)
 *     --controls-every n  the negative controls on every n-th configuration only (default 1)
 *     --reuse-shards  only aggregate the last calibration's measurements (test-results/
 *                     calibration-shard-*.json, made with at least K keys) for this K
 *   --jobs n          parallel processes for the re-draws and the calibration (default 4)
 *   --reuse-redraws   with the comparison, the last run's re-draws as they are (a run stopped after
 *                     them); only while the engine and the cases are unchanged
 *   --no-gpu          the CPU engine only (no browser)
 *   --only a,b        only the cases whose name contains one of these (for working on a few; the
 *                     run then checks fewer than the required set)
 *   --report-all      a report for every case, not only failing ones
 *   --update-engine   write ../engine-hashes.json from this run (the engine's own goldens)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { format, resolveConfig } from 'prettier';
import { ROOT, launch, prepareAssets, startServer } from '../../../tools/gpu-test/browser.mjs';

const args = process.argv.slice(2);
const flag = (/** @type {string} */ f) => args.includes(f);
const opt = (/** @type {string} */ k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = resolve(import.meta.dirname, '../reference');
const manifestPath = join(dir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('No tests/golden/reference/manifest.json: run `npm run capture:reference` first.');
  process.exit(1);
}

/** Presets whose full captures carry the drawn-star count gate. */
const RSTAR_GATE = ['Smooth, round', 'Cigar-shaped', 'Disc, no arms'];

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
let failed;
try {
  /** @type {typeof import('./node.ts')} */
  const G = await server.vite.ssrLoadModule('/tests/golden/compare/node.ts');
  const node = new G.GoldenNode(ROOT);
  if (flag('--redraws')) {
    redrawShard(node);
    failed = 0;
  } else if (flag('--calibrate-counts')) {
    await calibrateCountsOnly(G, node);
    failed = 0;
  } else failed = flag('--calibrate') ? (await calibrate(G, node), 0) : await compareAll(G, node);
} finally {
  if (browser) await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);

/** The required cases of this run (--only narrows them). */
function requiredCases() {
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? (args[onlyIdx + 1] ?? '').split(',') : null;
  // captures marked `calibration` are held out for the calibration, never gated (ADR 0018)
  return manifest.captures.filter(
    (/** @type {any} */ c) =>
      c.variant && !c.calibration && (!only || only.some((o) => c.name.includes(o))),
  );
}

/**
 * One process's share of the comparison's re-draws (ADR 0018): every n-th required case, keys
 * 1..K − 1, CPU engine, written to test-results/redraws-shard-k.json.
 *
 * @param {import('./node.ts').GoldenNode} node
 */
function redrawShard(node) {
  const [k = 0, n = 1] = (opt('--shard') ?? '0/1').split('/').map(Number);
  const keys = node.thresholds.keys ?? 1;
  /** @type {Record<string, any>} */
  const out = {};
  requiredCases().forEach((/** @type {any} */ c, /** @type {number} */ i) => {
    if (i % n === k) out[c.name] = node.redraws(c.name, keys);
  });
  writeFileSync(join(ROOT, `test-results/redraws-shard-${k}.json`), JSON.stringify(out));
}

/**
 * Runs this script in `jobs` parallel processes with the given arguments and `--shard k/jobs`.
 *
 * @param {string[]} extra
 * @param {number} jobs
 */
function shards(extra, jobs) {
  return Promise.all(
    Array.from(
      { length: jobs },
      (_, k) =>
        new Promise((ok, fail) => {
          const child = spawn(
            process.execPath,
            [import.meta.filename, ...extra, '--shard', `${k}/${jobs}`],
            { stdio: 'inherit' },
          );
          child.on('exit', (code) => (code ? fail(new Error(`shard ${k}: ${code}`)) : ok(code)));
        }),
    ),
  );
}

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
 * Writes a generated JSON file formatted as the repository's Prettier config formats it, so that
 * a regenerated thresholds.json, calibration.json or engine-hashes.json never fails `npm run lint`.
 *
 * @param {string} file
 * @param {unknown} data
 */
async function writeJson(file, data) {
  const config = (await resolveConfig(file)) ?? {};
  writeFileSync(file, await format(JSON.stringify(data, null, 2), { ...config, filepath: file }));
}

function pct(/** @type {number} */ x) {
  return `${(100 * x).toFixed(1)}%`.padStart(7);
}
/** One line of numbers for a comparison. */
function line(/** @type {any} */ c) {
  return `${pct(c.inkRel)} ${c.ssim.toFixed(3).padStart(6)} ${c.ssimCoarse.toFixed(3).padStart(6)} ${pct(c.medianRel)} ${pct(c.p90Rel)} ${pct(c.r50Rel)} ${pct(c.r90Rel)} ${pct(c.outerDiff)} ${c.qDiff.toFixed(3).padStart(7)} ${c.paDiff.toFixed(1).padStart(6)}`;
}

/**
 * @param {typeof import('./node.ts')} G
 * @param {import('./node.ts').GoldenNode} node
 */
async function compareAll(G, node) {
  const useGpu = !flag('--no-gpu');
  const required = requiredCases();
  // ADR 0018: the re-draws of every required case first, in parallel processes (CPU engine)
  const keys = node.thresholds.keys ?? 1;
  /** @type {Record<string, { c: any, counts: Record<string, number> }[]>} */
  const redraws = {};
  const t0 = performance.now();
  if (keys > 1) {
    const jobs = Math.max(1, Math.min(Number(opt('--jobs') ?? 4), required.length));
    mkdirSync(join(ROOT, 'test-results'), { recursive: true });
    const pass = args.filter((a, i) => a === '--only' || args[i - 1] === '--only');
    // --reuse-redraws: the last run's re-draws (test-results/redraws-shard-*.json), for a run that
    // was stopped after them; only valid if nothing the engine draws has changed since
    if (!flag('--reuse-redraws')) await shards(['--redraws', ...pass], jobs);
    for (let k = 0; k < jobs; k++)
      Object.assign(
        redraws,
        JSON.parse(readFileSync(join(ROOT, `test-results/redraws-shard-${k}.json`), 'utf8')),
      );
    console.log(
      `re-draws: ${required.length} cases × ${keys - 1} keys in ${((performance.now() - t0) / 1000).toFixed(0)} s (${jobs} processes)`,
    );
  }
  const gpu = useGpu ? await gpuPage() : null;
  if (gpu) console.log(`WebGPU adapter: ${gpu.adapter}`);
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
  console.log(
    `\n${'case'.padEnd(44)} ${'engine'.padEnd(9)} ${'ink'.padStart(7)} ${'(b)'.padStart(6)} ${"(b')".padStart(6)} ${'median'.padStart(7)} ${'p90'.padStart(7)} ${'r50'.padStart(7)} ${'r90'.padStart(7)} ${'outer'.padStart(7)} ${'Δq'.padStart(7)} ${'Δpa°'.padStart(6)}  counts (dots knots stars rstars)  result`,
  );
  for (const c of [...required, ...informational]) {
    const isRequired = !!c.variant;
    const rec = node.record(c.name);
    // v21's own variation (ADR 0015) and, from M4, v21's own stroke choices (v21-curves.ts) and
    // noise field (v21-noise.ts): both engines draw the same galaxy with the same pens, strokes,
    // flocculence and wobble, and only the dots differ
    const opts = node.referenceOptions(rec.params, rec.zoom ?? 1, rec.preset);
    const ref = node.reference(c.name);
    const refM = G.measure(ref);
    const refCounts = G.countsOf(rec.stats);
    const parity = node.parity(rec.preset, rec.zoom ?? 1, rec.variant);
    const strict = node.thresholds.strict;
    /** @type {Record<string, any>} */
    const row = { name: c.name, preset: rec.preset, required: isRequired };

    const zoom = rec.zoom ?? 1;
    const cpu = node.renderCpu(rec.params, opts, zoom);
    const cpuM = G.measure(cpu.alpha);
    /** @type {{ engine: string, alpha: any, measures: any, counts: any }[]} */
    const engines = [{ engine: 'cpu', alpha: cpu.alpha, measures: cpuM, counts: cpu.counts }];
    if (gpu) {
      const render = () =>
        gpu.page.evaluate(({ P, o, z }) => window.__golden?.render(P, o, z), {
          P: rec.params,
          o: opts,
          z: zoom,
        });
      /** @type {any} */
      const r1 = await render();
      /** @type {any} */
      const r2 = await render();
      const a1 = G.alphaFromBase64(r1.alpha, r1.width, r1.height);
      const h1 = G.alphaHash(a1);
      row.l0 = h1 === G.alphaHash(G.alphaFromBase64(r2.alpha, r2.width, r2.height));
      row.gpuHash = h1;
      newHashes[c.name] = h1;
      if (engineHashes[c.name]) row.e = engineHashes[c.name] === h1;
      engines.unshift({ engine: 'webgpu', alpha: a1, measures: G.measure(a1), counts: r1.counts });
      row.gpuMs = Math.round(r1.ms);
    }
    row.cpuMs = Math.round(cpu.ms);
    let pass = true;
    // ADR 0018: the mean over the engine's canonical draw and the CPU engine's K − 1 re-draws
    const more = isRequired ? (redraws[c.name] ?? []) : [];
    if (isRequired && more.length !== keys - 1) throw new Error(`${c.name}: re-draws missing`);
    for (const e of engines) {
      const single = G.compareMeasures(refM, e.measures);
      const cmp = G.meanComparison([single, ...more.map((x) => x.c)]);
      const ev = G.evaluate(
        cmp,
        refCounts,
        G.meanCounts([G.engineCounts(e.counts), ...more.map((x) => x.counts)]),
        parity,
        G.impossibleClasses(rec.params, node.groupKnots(rec.params)),
      );
      row[`single_${e.engine}`] = single;
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
        `${c.name.padEnd(44)} ${e.engine.padEnd(9)} ${line(cmp)}  ${counts.padEnd(32)} ${ev.pass ? 'pass' : `FAIL ${ev.failures.join('; ')}`}`,
      );
      if (more.length)
        console.log(
          `${''.padEnd(44)} ${'  key 0'.padEnd(9)} ${line(single)}  (one draw, information)`,
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
          [
            `thresholds: ${JSON.stringify(parity)}`,
            `the measures are means over ${String(more.length + 1)} draws (ADR 0018); the images are the canonical draw`,
          ],
        );
    }
    // the engine's own variation, for information
    const own = node.renderCpu(rec.params, {}, zoom);
    const ownCmp = G.compareMeasures(refM, G.measure(own.alpha));
    row.ownVariation = ownCmp;
    console.log(`${''.padEnd(44)} ${'own var.'.padEnd(9)} ${line(ownCmp)}  (information only)`);
    if (gpu) {
      const [w, cp] = engines;
      if (w && cp) {
        const cmp = G.compareMeasures(w.measures, cp.measures);
        const ev = G.evaluate(cmp, G.engineCounts(w.counts), G.engineCounts(cp.counts), strict);
        row.strict = { ...cmp, pass: ev.pass, failures: ev.failures };
        console.log(
          `${''.padEnd(44)} ${'CPU=GPU'.padEnd(9)} ${line(cmp)}  ${'strict'.padEnd(32)} ${ev.pass ? 'pass' : `FAIL ${ev.failures.join('; ')}`}  L0 ${row.l0 ? 'identical' : 'DIFFERS'}${row.e === undefined ? '' : `  (e) ${row.e ? 'identical' : 'DIFFERS'}`}`,
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

  // 4. drawn-star count gate on the full captures of the acceptance presets
  console.log('\ndrawn stars (rstars) on the full presets, CPU engine with v21 variation:');
  const gates = manifest.captures.filter(
    (/** @type {any} */ c) => !c.variant && c.surface === 'paper' && RSTAR_GATE.includes(c.preset),
  );
  let gateFails = 0;
  for (const c of gates) {
    const rec = node.record(c.name);
    const r = node.renderCpu(rec.params, { variation: node.v21Variation(rec.params) });
    const ref = rec.stats.rstars;
    const ours = r.counts.rstars;
    const allowed = G.countAllowance(
      ref,
      ours,
      node.parity(rec.preset),
      G.impossibleClasses(rec.params).has('rstars'),
    );
    const ok = Math.abs(ours - ref) <= allowed;
    if (!ok) gateFails++;
    results.push({
      name: c.name,
      gate: 'rstars',
      ref,
      render: ours,
      allowed,
      pass: ok,
      required: true,
    });
    console.log(
      `${c.name.padEnd(44)} ${String(ours).padStart(5)}/${String(ref).padEnd(5)} Δ ${String(ours - ref).padStart(4)} (±${allowed.toFixed(0)})  ${ok ? 'pass' : 'FAIL'}`,
    );
  }
  fails += gateFails;

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
    await writeJson(enginePath, {
      about:
        "The new engine's own goldens (ADR 0013 test e): SHA-256 of the 8-bit ink alpha of each required case, WebGPU on SwiftShader in Chromium. Written by npm run golden -- --update-engine.",
      adapter: gpu.adapter,
      hashes: newHashes,
    });
    console.log(`wrote ${enginePath}`);
  }
  const req = results.filter((r) => r.required && !r.gate);
  const reqFails = req.filter((r) => !r.pass).length;
  console.log(
    `\n${req.length - reqFails}/${req.length} required golden cases pass (mean of ${String(keys)} draws); ${gates.length - gateFails}/${gates.length} drawn-star gates pass${informational.length ? ` (${results.length - req.length - gates.length} informational)` : ''}; ${((performance.now() - t0) / 1000).toFixed(0)} s`,
  );
  return fails;
}

/**
 * ADR 0035: the dots' count tolerance. Every other class is a count of independent proposals, which
 * the ADR's relative tolerance and the Poisson allowance cover; the dots are not: the dots round a
 * drawn star are cleared (v21's breathing room), so their number follows where the few large stars
 * fall. The tolerance is the ADR's own, or 1.5 × the 95th percentile of the engine's re-draws'
 * own spread of the dots where that is wider: for the family (eight pairs or more), and for each
 * preset of it that has eight or more.
 *
 * @param {typeof import('./node.ts')} G
 * @param {{ preset: string, spread: Record<string, number> }[]} items `countSpread` of each pair
 * @param {number} floor
 */
function countTolerances(G, items, floor) {
  const CLASSES = ['dots'];
  const tol = (/** @type {number[]} */ xs) => {
    const w = Math.ceil(1.5 * G.summary(xs).p95 * 1000) / 1000;
    return w > floor ? w : null;
  };
  /** @type {Record<string, number[]>} */
  const spreadOf = {};
  /** @type {Record<string, Record<string, number[]>>} */
  const byPresetSpread = {};
  for (const { preset, spread } of items)
    for (const k of CLASSES) {
      const v = spread[k];
      if (v === undefined) continue;
      (spreadOf[k] ??= []).push(v);
      ((byPresetSpread[preset] ??= {})[k] ??= []).push(v);
    }
  /** @type {Record<string, number>} */
  const countsBy = {};
  for (const [k, xs] of Object.entries(spreadOf)) {
    const w = xs.length >= 8 ? tol(xs) : null;
    if (w !== null) countsBy[k] = w;
  }
  /** @type {Record<string, Record<string, number>>} */
  const byPreset = {};
  for (const [preset, by] of Object.entries(byPresetSpread))
    for (const [k, xs] of Object.entries(by)) {
      // a preset the family's tolerance already covers keeps it: only a wider or a narrower
      // calibrated value of its own is recorded
      const w = xs.length >= 8 ? tol(xs) : null;
      (byPreset[preset] ??= {})[k] = w ?? floor;
    }
  return { spreadOf, countsBy, byPreset };
}

/**
 * ADR 0035, counts only: re-measure the count tolerances of some families (`--families`), leaving
 * every other threshold of theirs as it is. Draws no rasters, so it takes minutes.
 *
 * @param {typeof import('./node.ts')} G
 * @param {import('./node.ts').GoldenNode} node
 */
async function calibrateCountsOnly(G, node) {
  const K = Number(opt('--keys') ?? 6);
  const R = 3;
  const only = opt('--families')?.split(',');
  if (!only) throw new Error('--calibrate-counts needs --families');
  const cases = calibrationCases(G, node);
  console.log(`count calibration: ${cases.length} configurations × (${R} stand-ins, ${K} keys)`);
  const pairs = node.calibrateCounts(cases, K, R);
  const thresholdsPath = join(ROOT, 'tests/golden/thresholds.json');
  const calibrationPath = join(ROOT, 'tests/golden/calibration.json');
  const th = JSON.parse(readFileSync(thresholdsPath, 'utf8'));
  const cal = JSON.parse(readFileSync(calibrationPath, 'utf8'));
  for (const [family, list] of Object.entries(pairs)) {
    const { spreadOf, countsBy, byPreset } = countTolerances(
      G,
      list.map((p) => ({ preset: p.preset, spread: G.countSpread(p, K) })),
      th.parity[family]?.counts ?? 0.03,
    );
    if (!th.parity[family]) continue;
    if (Object.keys(countsBy).length) th.parity[family].countsBy = countsBy;
    else delete th.parity[family].countsBy;
    // each preset's own, kept beside its axis-ratio tolerances
    for (const [preset, by] of Object.entries(byPreset)) {
      const bp = (th.parity[family].byPreset ??= {});
      if (Object.values(by).every((w) => w === (th.parity[family].counts ?? 0.03))) {
        if (bp[preset]) delete bp[preset].countsBy;
        continue;
      }
      (bp[preset] ??= {}).countsBy = by;
    }
    cal.families[family] ??= {};
    cal.families[family].countSpread = Object.fromEntries(
      Object.entries(spreadOf).map(([k, xs]) => [k, G.summary(xs)]),
    );
    console.log(family.padEnd(14), JSON.stringify(countsBy), `(${list.length} pairs)`);
  }
  await writeJson(thresholdsPath, th);
  await writeJson(calibrationPath, cal);
}

/**
 * The configurations a calibration measures: the single-galaxy presets at home, orbit and zoom,
 * and every variant capture; with `--families`, those of these families (and their `@zoom`).
 *
 * @param {typeof import('./node.ts')} G
 * @param {import('./node.ts').GoldenNode} node
 */
function calibrationCases(G, node) {
  /** The single-galaxy presets the M2 engine draws (stipple). */
  const presets = [
    'Grand design',
    'Barred spiral',
    'Flocculent',
    'Tightly wound',
    'Ringed',
    'Disc, no arms',
    'Edge-on with dust',
    'Smooth, round',
    'Cigar-shaped',
    'Radio jet',
    'Shell galaxy',
  ];
  /** @type {import('./node.ts').CalibrationCase[]} */
  const cases = [];
  for (const preset of presets)
    for (const seed of [7, 4242])
      for (const camera of ['home', 'orbit']) {
        const rec = node.record(`${manifestSlug(preset)}__s${seed}__${camera}`);
        cases.push({ preset, base: preset, family: G.goldenFamily(preset), params: rec.params });
        // the zoom camera (M3, M4) is calibrated on the same configurations, home at zoom 2:
        // re-draw pairs need no v21 capture
        if (camera === 'home')
          cases.push({
            preset: `${preset} (zoom 2)`,
            base: preset,
            family: `${G.goldenFamily(preset)}@zoom`,
            params: rec.params,
            zoom: 2,
          });
      }
  for (const c of manifest.captures.filter((/** @type {any} */ x) => x.variant)) {
    const rec = node.record(c.name);
    const zoom = rec.zoom ?? 1;
    // the zoom camera is calibrated on its own (`<family>@zoom`), the line-work alone too
    const family = G.goldenFamily(rec.preset, c.variant);
    cases.push({
      preset: `${rec.preset} (${c.variant})`,
      base: rec.preset,
      family: zoom === 1 ? family : `${family}@zoom`,
      params: rec.params,
      zoom,
      ...(c.calibration ? { heldOut: c.name } : {}),
    });
  }
  const onlyFamilies = opt('--families')?.split(',');
  if (onlyFamilies) {
    const keep = cases.filter((c) => onlyFamilies.includes(c.family.replace('@zoom', '')));
    cases.length = 0;
    cases.push(...keep);
  }
  return cases;
}

/**
 * ADR 0013 / 0015 calibration: thresholds per family from "same galaxy, other dots" pairs, then
 * the negative controls evaluated against them.
 *
 * @param {typeof import('./node.ts')} G
 * @param {import('./node.ts').GoldenNode} node
 */
async function calibrate(G, node) {
  /** ADR 0018: the K of the mean, and the stand-ins for v21 per configuration */
  const K = Number(opt('--keys') ?? 6);
  const R = 3;
  const onlyFamilies = opt('--families')?.split(',');
  const cases = calibrationCases(G, node);
  console.log(
    `calibration: ${cases.length} configurations × (${R} stand-ins, ${K} keys) and the negative controls × ${K} keys`,
  );
  // the engine pairs are measured in parallel processes (--jobs, default 4), each taking every
  // n-th configuration (--shard k/n) and writing its comparisons to test-results/
  // the negative controls on every n-th configuration (--controls-every n, default 1): with K
  // draws each they are most of a calibration's time
  const controlsEvery = Number(opt('--controls-every') ?? 1);
  const shard = opt('--shard');
  if (shard) {
    const [k = 0, n = 1] = shard.split('/').map(Number);
    mkdirSync(join(ROOT, 'test-results'), { recursive: true });
    const file = join(ROOT, `test-results/calibration-shard-${k}.json`);
    // written after every configuration; with --resume, the configurations a stopped run
    // measured with this K are kept (a full calibration takes hours)
    /** @type {{ keys: number, standIns: number, controlsEvery: number, controlsDone: string[], pairs: Record<string, any[]>, controls: Record<string, Record<string, any[]>>, heldOut: Record<string, any[]> }} */
    let part = {
      keys: K,
      standIns: R,
      controlsEvery,
      controlsDone: [],
      pairs: {},
      controls: {},
      heldOut: {},
    };
    // with --resume, every configuration any shard has measured with this K is kept, by label: its
    // pairs, and (separately) its controls, which a later run may add
    /** @type {Set<string>} */
    const done = new Set();
    /** @type {Set<string>} */
    const controlsDone = new Set();
    if (flag('--resume'))
      for (let j = 0; existsSync(join(ROOT, `test-results/calibration-shard-${j}.json`)); j++) {
        const old = JSON.parse(
          readFileSync(join(ROOT, `test-results/calibration-shard-${j}.json`), 'utf8'),
        );
        if (old.keys !== K || old.standIns !== R) continue;
        if (j === k) part = { heldOut: {}, controlsDone: [], ...old, controlsEvery };
        for (const list of Object.values(old.pairs ?? {}))
          for (const e of /** @type {any[]} */ (list)) done.add(e.config);
        for (const label of old.controlsDone ?? []) controlsDone.add(label);
        // a shard from before `controlsDone`: the configurations whose controls it holds
        for (const byName of Object.values(old.controls ?? {}))
          for (const list of Object.values(/** @type {any} */ (byName)))
            for (const e of /** @type {any[]} */ (list)) controlsDone.add(e.config);
      }
    for (let i = k; i < cases.length; i += n) {
      const c = cases[i];
      if (!c) continue;
      const label = G.configLabel(c);
      // the controls on every n-th of each shard's own configurations, so the shards stay
      // balanced; the line-work alone has its own breaks instead (docs/milestones/m4/README.md)
      const wantControls = c.family !== 'lines' && Math.floor(i / n) % controlsEvery === 0;
      const needPairs = !done.has(label);
      const needControls = wantControls && !controlsDone.has(label);
      if (!needPairs && !needControls) continue;
      const one = node.calibrateEngine([c], K, R, (s) => console.log(`[${shard}] ${s}`), {
        pairs: needPairs,
        controls: needControls,
      });
      if (needControls) part.controlsDone.push(label);
      for (const [f, list] of Object.entries(one.pairs)) (part.pairs[f] ??= []).push(...list);
      for (const [f, list] of Object.entries(one.heldOut)) (part.heldOut[f] ??= []).push(...list);
      for (const [f, byName] of Object.entries(one.controls))
        for (const [name, list] of Object.entries(byName))
          ((part.controls[f] ??= {})[name] ??= []).push(...list);
      writeFileSync(file, JSON.stringify(part));
    }
    // a shard with nothing left to do still records how it was asked
    part.controlsEvery = controlsEvery;
    writeFileSync(file, JSON.stringify(part));
    return;
  }
  const jobs = Number(opt('--jobs') ?? 4);
  if (!flag('--reuse-shards'))
    await shards(
      [
        '--calibrate',
        '--keys',
        String(K),
        '--controls-every',
        String(controlsEvery),
        ...(flag('--resume') ? ['--resume'] : []),
      ],
      jobs,
    );
  // the mean over the first K keys of each entry (ADR 0018)
  const mean = (/** @type {any[]} */ cs) => {
    if (cs.length < K) throw new Error(`calibration shards hold ${cs.length} keys, not ${K}`);
    return G.meanComparison(cs.slice(0, K));
  };
  /** @type {{ pairs: Record<string, any[]>, controls: Record<string, Record<string, any[]>>, heldOut: Record<string, any[]>, counts: Record<string, { preset: string, spread: Record<string, number> }[]> }} */
  const eng = { pairs: {}, controls: {}, heldOut: {}, counts: {} };
  // which configurations the negative controls ran on, as the shards recorded it (a
  // re-aggregation must not write its own defaults)
  /** @type {Set<string>} */
  const withControls = new Set();
  for (let k = 0; existsSync(join(ROOT, `test-results/calibration-shard-${k}.json`)); k++) {
    if (k >= jobs && !flag('--reuse-shards')) break;
    const part = JSON.parse(
      readFileSync(join(ROOT, `test-results/calibration-shard-${k}.json`), 'utf8'),
    );
    for (const label of part.controlsDone ?? []) withControls.add(label);
    for (const byName of Object.values(part.controls ?? {}))
      for (const list of Object.values(/** @type {any} */ (byName)))
        for (const e of /** @type {any[]} */ (list)) withControls.add(e.config);
    // ADR 0035: how far a count of the stand-in for v21 is from the mean of the K draws' counts
    for (const [f, list] of Object.entries(part.pairs))
      (eng.counts[f] ??= []).push(
        ...list
          .filter((/** @type {any} */ e) => e.keys)
          .map((/** @type {any} */ e) => ({ preset: e.preset, spread: G.countSpread(e, K) })),
      );
    for (const [f, list] of Object.entries(part.pairs))
      (eng.pairs[f] ??= []).push(
        ...list.map((/** @type {any} */ e) => ({ ...mean(e.cs), preset: e.preset })),
      );
    for (const [f, byName] of Object.entries(part.controls))
      for (const [name, list] of Object.entries(byName))
        ((eng.controls[f] ??= {})[name] ??= []).push(
          ...list.map((/** @type {any} */ e) => ({ config: e.config, c: mean(e.cs) })),
        );
    for (const [f, list] of Object.entries(part.heldOut ?? {}))
      (eng.heldOut[f] ??= []).push(
        ...list.map((/** @type {any} */ e) => ({
          ...mean(e.cs),
          preset: e.preset,
          config: e.config,
        })),
      );
  }
  console.log('calibration: v21 re-roll pairs');
  const v21 = node.calibrateReroll(join(ROOT, 'tests/golden/actual/reroll'), () => {});
  console.log(`  ${v21.used} v21 pairs whose stipple re-rolled`);

  const ADR = { ink: 0.05, median: 0.1, p90: 0.1, counts: 0.03, countsSmall: 0.1, poisson: 3 };
  const KEYS = /** @type {const} */ ([
    ['ssim', (/** @type {any} */ c) => c.ssim],
    ['ssimCoarse', (/** @type {any} */ c) => c.ssimCoarse],
    ['inkAbs', (/** @type {any} */ c) => Math.abs(c.inkRel)],
    ['medianAbs', (/** @type {any} */ c) => Math.abs(c.medianRel)],
    ['p90Abs', (/** @type {any} */ c) => Math.abs(c.p90Rel)],
    ['r25Abs', (/** @type {any} */ c) => Math.abs(c.r25Rel)],
    ['r50Abs', (/** @type {any} */ c) => Math.abs(c.r50Rel)],
    ['r90Abs', (/** @type {any} */ c) => Math.abs(c.r90Rel)],
    ['outerAbs', (/** @type {any} */ c) => Math.abs(c.outerDiff)],
    ['qAbs', (/** @type {any} */ c) => Math.abs(c.qDiff)],
    ['qInnerAbs', (/** @type {any} */ c) => Math.abs(c.qInnerDiff)],
    ['paAbs', (/** @type {any} */ c) => Math.abs(c.paDiff)],
  ]);
  const stats = (/** @type {any[]} */ list) =>
    Object.fromEntries(
      KEYS.map(([k, f]) => [k, G.summary(list.map(f).filter((x) => !Number.isNaN(x)))]),
    );
  const floor2 = (/** @type {number} */ x) => Math.floor(x * 100) / 100;
  const ceil3 = (/** @type {number} */ x) => Math.ceil(x * 1000) / 1000;
  /** 1.5 × p95 of the re-draw spread, and at least `min` */
  const spread = (/** @type {any} */ s, /** @type {string} */ k, /** @type {number} */ min) =>
    Math.max(min, ceil3(1.5 * s[k].p95));
  /** @type {Record<string, any>} */
  const parity = {};
  /** @type {Record<string, any>} */
  const numbers = {};
  const families = onlyFamilies
    ? [...onlyFamilies]
    : ['spiral', 'smooth', 'merger', 'lens', 'star', 'artefact'];
  for (const f of Object.keys(eng.pairs)) if (!families.includes(f)) families.push(f);
  for (const family of families) {
    const list = eng.pairs[family] ?? [];
    const base = {
      counts: ADR.counts,
      countsSmall: ADR.countsSmall,
      poisson: ADR.poisson,
      // the drawn stars of a disc galaxy (about 1,000–1,100 of ~11,000 proposals) are a binomial
      // draw too: ±3% there is under one standard deviation of the difference of two draws
      poissonBelow: 2000,
    };
    if (!list.length) {
      parity[family] = {
        ...base,
        ink: ADR.ink,
        ssimCoarse: 0.85,
        median: ADR.median,
        p90: ADR.p90,
        r25: 0.1,
        r50: 0.1,
        r90: 0.1,
        outer: 0.03,
        q: 0.05,
        qInner: 0.05,
        paA: 2,
        paEps0: 0.05,
        provisional: true,
      };
      numbers[family] = { v21Reroll: v21.pairs[family]?.length ? stats(v21.pairs[family]) : null };
      continue;
    }
    const rule = (/** @type {any[]} */ l) => {
      const s = stats(l);
      return {
        // the ADR's ±5% and ±10% stay as floors: they also cover the renderers' deliberate
        // differences (per-drawing mipmaps, no MSAA, f16 accumulation), which re-draw pairs do not
        ink: Math.max(ADR.ink, ceil3(1.5 * s.inkAbs.p95)),
        ssimCoarse: floor2(s.ssimCoarse.p5 - 0.02),
        median: Math.max(ADR.median, ceil3(1.5 * s.medianAbs.p95)),
        p90: Math.max(ADR.p90, ceil3(1.5 * s.p90Abs.p95)),
        // the moment and extent test: 1.5 × the p95 of the re-draw spread, with small floors for
        // a quantity's resolution (half a radial bin of 0.25 px is 0.1% of a 100 px radius)
        r25: spread(s, 'r25Abs', 0.01),
        r50: spread(s, 'r50Abs', 0.01),
        r90: spread(s, 'r90Abs', 0.01),
        outer: spread(s, 'outerAbs', 0.003),
        q: spread(s, 'qAbs', 0.005),
        qInner: spread(s, 'qInnerAbs', 0.005),
        ...positionAngle(l),
      };
    };
    /** @type {Record<string, number>} */
    const t = rule(list);
    const counted = countTolerances(G, eng.counts[family] ?? [], ADR.counts);
    const { spreadOf, countsBy } = counted;
    // ADR 0018: where held-out v21 captures exist (the line-work alone, drawn the same at every
    // key), the same rule on v21 against the engine there, and the wider of the two
    const held = eng.heldOut[family] ?? [];
    if (held.length) {
      const h = /** @type {Record<string, number>} */ (rule(held));
      for (const k of Object.keys(t))
        t[k] = k === 'ssimCoarse' ? Math.min(t[k] ?? 0, h[k] ?? 0) : Math.max(t[k] ?? 0, h[k] ?? 0);
      // the held-out sample is small and its tails heavy (a sparse drawing's inner axis ratio
      // jumps when a stroke crosses the aperture): no tolerance below 1.1 × its largest value
      const hs = stats(held);
      for (const [k, m] of /** @type {const} */ ([
        ['median', 'medianAbs'],
        ['p90', 'p90Abs'],
        ['r25', 'r25Abs'],
        ['r50', 'r50Abs'],
        ['r90', 'r90Abs'],
        ['outer', 'outerAbs'],
        ['q', 'qAbs'],
        ['qInner', 'qInnerAbs'],
      ]))
        t[k] = Math.max(t[k] ?? 0, ceil3(1.1 * (hs[m]?.max ?? 0)));
    }
    parity[family] = {
      ...base,
      ...t,
      ...(Object.keys(countsBy).length ? { countsBy } : {}),
      ...(held.length ? { heldOut: held.length } : {}),
    };
    // per-preset axis-ratio tolerances: near-round galaxies are noisier in q than flat ones, so
    // a family-wide value would be too wide for the flat ones (ADR 0015)
    /** @type {Record<string, any>} */
    const byPreset = {};
    // (none where held-out captures set the family's tolerances: re-draws alone would be tighter)
    for (const preset of held.length ? [] : [...new Set(list.map((c) => c.preset))]) {
      const mine = list.filter((c) => c.preset === preset);
      if (mine.length < 8) continue;
      const ps = stats(mine);
      byPreset[preset] = {
        q: spread(ps, 'qAbs', 0.005),
        qInner: spread(ps, 'qInnerAbs', 0.005),
        // the preset's own noise floor of the ellipticity (a smooth Sérsic profile is far quieter
        // than a galaxy with a sparse halo); the family's paA
        paEps0: Math.max(0.01, positionAngle(mine).paEps0),
        // ADR 0035, where this preset's own count spread is wider than the ADR's tolerance
        ...(Object.values(counted.byPreset[preset] ?? {}).some((w) => w > ADR.counts)
          ? { countsBy: counted.byPreset[preset] }
          : {}),
      };
    }
    parity[family].byPreset = byPreset;
    // the negative controls against these thresholds
    /** @type {Record<string, any>} */
    const ctl = {};
    for (const [name, list2] of Object.entries(eng.controls[family] ?? {})) {
      const rows = list2.map((/** @type {any} */ x) => {
        const preset = /** @type {string} */ (x.config).replace(/ \(.*\)| s\d+ incl.*/g, '');
        const { byPreset: bp, ...fam } = parity[family];
        const ev = G.evaluate(x.c, {}, {}, { ...fam, ...(bp[preset] ?? {}) });
        return { config: x.config, failed: !ev.pass, by: ev.failures.map((f) => f.split(' (')[0]) };
      });
      ctl[name] = {
        applicable: rows.length,
        detected: rows.filter((r) => r.failed).length,
        missed: rows.filter((r) => !r.failed).map((r) => r.config),
        ...stats(list2.map((/** @type {any} */ x) => x.c)),
        firstFailures: rows.slice(0, 4),
      };
    }
    numbers[family] = {
      engineRekey: stats(list),
      ...(Object.keys(spreadOf).length
        ? {
            countSpread: Object.fromEntries(
              Object.entries(spreadOf).map(([k, xs]) => [k, G.summary(xs)]),
            ),
          }
        : {}),
      ...(held.length ? { heldOutV21: stats(held) } : {}),
      negativeControls: ctl,
      v21Reroll: v21.pairs[family]?.length ? stats(v21.pairs[family]) : null,
    };
  }
  const file = {
    about:
      'Golden thresholds (ADR 0013, as calibrated in ADR 0015 and amended by ADR 0018). keys: the K of the parity comparison, which sets v21 against the mean of each measure over K engine draws, and for which the parity thresholds are calibrated. parity: the new engine against v21 (L2), per family; strict: the CPU engine against WebGPU (L1), one draw each. Gated: ink, coarse SSIM (b′), widths, counts, and the moment and extent test (r25, r50, r90, outer ink, axis ratio q, position angle pa where the reference q < paBelowQ). Written by `npm run golden -- --calibrate`; the numbers behind them are in calibration.json and docs/milestones/m2/README.md. Families marked provisional have no engine yet.',
    keys: K,
    strict: {
      ink: 0.005,
      ssimCoarse: 0.98,
      median: 0.02,
      p90: 0.02,
      r25: 0.005,
      r50: 0.005,
      r90: 0.005,
      outer: 0.002,
      q: 0.003,
      qInner: 0.003,
      paA: 0.1,
      paEps0: 0,
      counts: 0.001,
      countsSmall: 0.001,
      poisson: 0,
      poissonBelow: 0,
    },
    parity,
  };
  const thresholdsPath = join(ROOT, 'tests/golden/thresholds.json');
  const calibrationPath = join(ROOT, 'tests/golden/calibration.json');
  const calibration = {
    about:
      "ADR 0013 / 0015 / 0018 calibration: per family, summaries (n, min, p5, median, p95, max) of each measure. engineRekey: the new engine (CPU, equal to WebGPU at L1) drawing v21's replayed variation and re-keying its placement stream: per configuration, each of `standIns` draws stands in for v21 against the mean of each measure over the `keys` draws of keys 0..K − 1 (a full re-draw). negativeControls: one structural or pen change per control, drawn with the same K keys, against the first stand-in, with how many applicable configurations the thresholds caught. v21Reroll: v21 at az and az + 0.3° where its stipple re-rolled (a partial re-draw, one draw against one).",
    keys: K,
    standIns: R,
    // the negative controls ran on this many of the configurations that have them (every
    // configuration but the line-work alone's): the controls' detection rates are over these
    controls: {
      configurations: withControls.size,
      ofConfigurations: cases.filter((c) => c.family !== 'lines').length,
    },
    configurations: cases.map((c) => `${c.preset} s${c.params.seed} incl ${c.params.incl}`),
    families: numbers,
  };
  if (onlyFamilies) {
    // a partial run replaces its families and keeps everything else in the files as it is
    const old = JSON.parse(readFileSync(thresholdsPath, 'utf8'));
    const oldCal = JSON.parse(readFileSync(calibrationPath, 'utf8'));
    file.parity = { ...old.parity, ...parity };
    calibration.families = { ...oldCal.families, ...numbers };
    calibration.configurations = [
      ...oldCal.configurations.filter(
        (/** @type {string} */ c) => !calibration.configurations.includes(c),
      ),
      ...calibration.configurations,
    ];
    calibration.keys = oldCal.keys;
    calibration.standIns = oldCal.standIns;
    calibration.controlsEvery = oldCal.controlsEvery;
  }
  await writeJson(thresholdsPath, file);
  await writeJson(calibrationPath, calibration);
  for (const [family, n] of Object.entries(numbers))
    if (n.negativeControls)
      for (const [name, x] of Object.entries(n.negativeControls))
        console.log(
          `${family.padEnd(7)} ${name.padEnd(16)} detected ${x.detected}/${x.applicable}${x.missed.length ? `  missed: ${x.missed.join(', ')}` : ''}`,
        );
  console.log(JSON.stringify(parity, null, 1));
}

/**
 * The position-angle tolerance's parameters (thresholds.ts `paTolerance`), fitted from re-draws:
 * paEps0 is 1.5 × the 95th percentile of the change of ellipticity ε = (1 − q²)/(1 + q²) between
 * re-draws (below it the axis is noise), and paA 1.5 × the 95th percentile of |Δpa| · (ε − paEps0)
 * over the pairs above it, so that |Δpa| ≤ paA / (ε − paEps0).
 *
 * @param {any[]} list
 */
function positionAngle(list) {
  const eps = (/** @type {number} */ q) => (1 - q * q) / (1 + q * q);
  const p95 = (/** @type {number[]} */ xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)] ?? 0;
  };
  const ceil3 = (/** @type {number} */ x) => Math.ceil(x * 1000) / 1000;
  const paEps0 = ceil3(1.5 * p95(list.map((c) => Math.abs(eps(c.render.q) - eps(c.ref.q)))));
  const above = list.filter((c) => eps(c.ref.q) > paEps0);
  const paA = ceil3(
    Math.max(0.5, 1.5 * p95(above.map((c) => Math.abs(c.paDiff) * (eps(c.ref.q) - paEps0)))),
  );
  return { paA, paEps0 };
}

/** @param {string} s */
function manifestSlug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
