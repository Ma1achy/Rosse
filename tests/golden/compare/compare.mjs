// @ts-check
/**
 * Golden comparison entry point (`npm run golden`): the metric of
 * docs/adr/0013-golden-image-metric.md as calibrated in docs/adr/0015-golden-metric-as-calibrated-in-m2.md
 * (see ../README.md).
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
 *      moment and extent test; the σ = 4 px density SSIM is reported, not gated (ADR 0015);
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
 *   --no-gpu          the CPU engine only (no browser)
 *   --only a,b        only the cases whose name contains one of these (for working on a few; the
 *                     run then checks fewer than the required set)
 *   --report-all      a report for every case, not only failing ones
 *   --update-engine   write ../engine-hashes.json from this run (the engine's own goldens)
 *   --family f        with --calibrate: measure only the configurations of family f (and f@zoom)
 *                     and merge its thresholds and numbers into the existing files, leaving the
 *                     other families as they are (a new family's calibration; M9: `lens`)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
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
  failed = flag('--calibrate') ? (await calibrate(G, node), 0) : await compareAll(G, node);
} finally {
  if (browser) await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);

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
    const parity = node.parity(rec.preset, rec.zoom ?? 1);
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
    for (const e of engines) {
      const cmp = G.compareMeasures(refM, e.measures);
      const ev = G.evaluate(
        cmp,
        refCounts,
        G.engineCounts(e.counts),
        parity,
        G.impossibleClasses(rec.params),
      );
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
  const req = results.filter((r) => r.required && !r.gate);
  const reqFails = req.filter((r) => !r.pass).length;
  console.log(
    `\n${req.length - reqFails}/${req.length} required golden cases pass; ${gates.length - gateFails}/${gates.length} drawn-star gates pass${informational.length ? ` (${results.length - req.length - gates.length} informational)` : ''}`,
  );
  return fails;
}

/**
 * ADR 0013 / 0015 calibration: thresholds per family from "same galaxy, other dots" pairs, then
 * the negative controls evaluated against them.
 *
 * @param {typeof import('./node.ts')} G
 * @param {import('./node.ts').GoldenNode} node
 */
async function calibrate(G, node) {
  const K = 3;
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
  /** @type {{ preset: string, base: string, family: string, params: any, zoom?: number }[]} */
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
    // the zoom camera is calibrated on its own (`<family>@zoom`)
    const family = G.goldenFamily(rec.preset);
    cases.push({
      preset: `${rec.preset} (${c.variant})`,
      base: rec.preset,
      family: zoom === 1 ? family : `${family}@zoom`,
      params: rec.params,
      zoom,
    });
  }
  const onlyFamily = opt('--family');
  if (onlyFamily) {
    const keep = cases.filter((c) => c.family === onlyFamily || c.family === `${onlyFamily}@zoom`);
    cases.length = 0;
    cases.push(...keep);
  }
  console.log(
    `calibration: ${cases.length} configurations × ${K} re-keys and the negative controls`,
  );
  // the engine pairs are measured in parallel processes (--jobs, default 4), each taking every
  // n-th configuration (--shard k/n) and writing its comparisons to test-results/
  const shard = opt('--shard');
  if (shard) {
    const [k, n] = shard.split('/').map(Number);
    const mine = cases.filter((_, i) => i % (n ?? 1) === k);
    const part = node.calibrateEngine(mine, K, (s) => console.log(`[${shard}] ${s}`));
    mkdirSync(join(ROOT, 'test-results'), { recursive: true });
    writeFileSync(join(ROOT, `test-results/calibration-shard-${k}.json`), JSON.stringify(part));
    return;
  }
  const jobs = Number(opt('--jobs') ?? 4);
  await Promise.all(
    Array.from(
      { length: jobs },
      (_, k) =>
        new Promise((ok, fail) => {
          const child = spawn(
            process.execPath,
            [import.meta.filename, '--calibrate', '--shard', `${k}/${jobs}`],
            { stdio: 'inherit' },
          );
          child.on('exit', (code) => (code ? fail(new Error(`shard ${k}: ${code}`)) : ok(code)));
        }),
    ),
  );
  /** @type {{ pairs: Record<string, any[]>, controls: Record<string, Record<string, any[]>> }} */
  const eng = { pairs: {}, controls: {} };
  for (let k = 0; k < jobs; k++) {
    const part = JSON.parse(
      readFileSync(join(ROOT, `test-results/calibration-shard-${k}.json`), 'utf8'),
    );
    for (const [f, list] of Object.entries(part.pairs)) (eng.pairs[f] ??= []).push(...list);
    for (const [f, byName] of Object.entries(part.controls))
      for (const [name, list] of Object.entries(byName))
        ((eng.controls[f] ??= {})[name] ??= []).push(...list);
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
  const families = onlyFamily
    ? Object.keys(eng.pairs)
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
    const s = stats(list);
    parity[family] = {
      ...base,
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
      ...positionAngle(list),
    };
    // per-preset axis-ratio tolerances: near-round galaxies are noisier in q than flat ones, so
    // a family-wide value would be too wide for the flat ones (ADR 0015)
    /** @type {Record<string, any>} */
    const byPreset = {};
    for (const preset of [...new Set(list.map((c) => c.preset))]) {
      const mine = list.filter((c) => c.preset === preset);
      if (mine.length < 8) continue;
      const ps = stats(mine);
      byPreset[preset] = {
        q: spread(ps, 'qAbs', 0.005),
        qInner: spread(ps, 'qInnerAbs', 0.005),
        // the preset's own noise floor of the ellipticity (a smooth Sérsic profile is far quieter
        // than a galaxy with a sparse halo); the family's paA
        paEps0: Math.max(0.01, positionAngle(mine).paEps0),
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
      engineRekey: s,
      negativeControls: ctl,
      v21Reroll: v21.pairs[family]?.length ? stats(v21.pairs[family]) : null,
    };
  }
  const thresholdsPath = join(ROOT, 'tests/golden/thresholds.json');
  const calibrationPath = join(ROOT, 'tests/golden/calibration.json');
  const previous = onlyFamily ? JSON.parse(readFileSync(thresholdsPath, 'utf8')) : null;
  const previousCal = onlyFamily ? JSON.parse(readFileSync(calibrationPath, 'utf8')) : null;
  const file = {
    about:
      'Golden thresholds (ADR 0013, as calibrated in ADR 0015). parity: the new engine against v21 (L2), per family; strict: the CPU engine against WebGPU (L1). Gated: ink, coarse SSIM (b′), widths, counts, and the moment and extent test (r25, r50, r90, outer ink, axis ratio q, position angle pa where the reference q < paBelowQ). Written by `npm run golden -- --calibrate`; the numbers behind them are in calibration.json and docs/milestones/m2/README.md. Families marked provisional have no engine yet.',
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
    parity: previous ? { ...previous.parity, ...parity } : parity,
  };
  writeFileSync(thresholdsPath, JSON.stringify(file, null, 2) + '\n');
  writeFileSync(
    calibrationPath,
    JSON.stringify(
      {
        about:
          "ADR 0013 / 0015 calibration: per family, summaries (n, min, p5, median, p95, max) of each measure. engineRekey: the new engine (CPU, equal to WebGPU at L1) drawing v21's replayed variation and re-keying its placement stream, 3 keys per configuration (a full re-draw). negativeControls: one structural or pen change per control, re-keyed, against the base, with how many applicable configurations the thresholds caught. v21Reroll: v21 at az and az + 0.3° where its stipple re-rolled (a partial re-draw).",
        keys: K,
        configurations: [
          ...(previousCal?.configurations ?? []).filter(
            (/** @type {string} */ c) => !cases.some((k) => c.startsWith(`${k.preset} s`)),
          ),
          ...cases.map((c) => `${c.preset} s${c.params.seed} incl ${c.params.incl}`),
        ],
        families: previousCal ? { ...previousCal.families, ...numbers } : numbers,
      },
      null,
      2,
    ) + '\n',
  );
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
