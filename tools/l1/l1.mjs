// @ts-check
/**
 * `npm run l1`: the L1 measurement harness (M10, ADR 0004's levels).
 *
 * L1 is "the same structure across machines and the CPU": a WebGPU adapter and the CPU engine draw
 * the same case, and the two images must pass the strict thresholds of tests/golden/thresholds.json
 * (ink ±0.5%, coarse structure SSIM ≥ 0.98, pen widths ±2%, mark counts ±0.1%, the radii and axis
 * ratio to 0.5%). This harness renders a set of cases on the adapter the browser was started with
 * (`ROSSE_WEBGPU_ADAPTER`: `swiftshader` by default, `hardware` for a real GPU, or an explicit
 * `--use-webgpu-adapter` value) and on the CPU engine in Node, compares them, and also reports
 *
 * - L0 on this adapter: two renders in a row are bit-identical, and, on SwiftShader, identical to
 *   the engine's own goldens (tests/golden/engine-hashes.json). On another adapter the hash
 *   comparison is information, not a failure: bit-exactness across adapters is not promised (L1
 *   is);
 * - the worst value of every measure over the cases, with the strict threshold beside it, so the
 *   margin is visible on any adapter.
 *
 * The result goes into docs/milestones/m10/l1-report.json, one entry per adapter, merged: running
 * it on another machine adds or replaces that machine's entry and leaves the others. The Markdown
 * report is written from the JSON (`npm run l1 -- --markdown`, or after every run).
 *
 *   npm run l1                              # SwiftShader against the CPU engine, the default cases
 *   ROSSE_WEBGPU_ADAPTER=hardware npm run l1    # a real GPU against the CPU engine (the owner's MacBook)
 *   npm run l1 -- --all                     # every required case (long on SwiftShader)
 *   npm run l1 -- --only "grand-design--ribbons"   # cases whose names contain one of these (; separated)
 *   npm run l1 -- --cpu-only                # the CPU engine alone: hashes only, no browser
 *   npm run l1 -- --no-write                # print, do not touch the report
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { ADAPTER_CHOICE, ROOT, launch, prepareAssets, startServer } from '../gpu-test/browser.mjs';

const args = process.argv.slice(2);
const flag = (/** @type {string} */ f) => args.includes(f);
const opt = (/** @type {string} */ k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const REPORT = join(ROOT, 'docs/milestones/m10/l1-report.json');
const MD = join(ROOT, 'docs/milestones/m10/l1-report.md');

/** The default cases: one of each family at the home camera, and the orbit and zoom cameras once. */
const DEFAULT_CASES = [
  'smooth-round--stipple__s7__home',
  'cigar-shaped--stipple__s7__home',
  'disc-no-arms--stipple__s7__home',
  'grand-design--stipple-arms__s7__home',
  'grand-design--ribbons__s7__home',
  'grand-design--ribbons__s7__orbit',
  'grand-design--ribbons__s7__zoom',
  'barred-spiral--ribbons__s7__home',
  'dusty-spiral--ribbons__s7__home',
  'hand-wobble--ribbons__s7__home',
  'grand-design--lines__s7__home',
  'hand-drawn-arms--vectors__s7__home',
  'edge-on-with-dust--vectors__s7__home',
  'stellar-streams--vectors__s7__home',
  'shell-galaxy--vectors__s7__home',
  'plates-slipped--single__s7__home',
];

/** @param {string} file @param {unknown} data */
async function writeJson(file, data) {
  const cfg = (await resolveConfig(file)) ?? {};
  writeFileSync(file, await format(JSON.stringify(data), { ...cfg, filepath: file }));
}

const MEASURES = [
  ['inkRel', 'ink', 'relative'],
  ['ssimCoarse', 'ssimCoarse', 'min'],
  ['medianRel', 'median', 'relative'],
  ['p90Rel', 'p90', 'relative'],
  ['r25Rel', 'r25', 'relative'],
  ['r50Rel', 'r50', 'relative'],
  ['r90Rel', 'r90', 'relative'],
  ['outerDiff', 'outer', 'abs'],
  ['qDiff', 'q', 'abs'],
  ['paDiff', 'paA', 'abs'],
];

if (flag('--markdown')) {
  await markdown();
  process.exit(0);
}

prepareAssets();
const server = await startServer();
/** @type {any} */
let browser = null;
try {
  /** @type {typeof import('../../tests/golden/compare/node.ts')} */
  const G = await server.vite.ssrLoadModule('/tests/golden/compare/node.ts');
  const node = new G.GoldenNode(ROOT);
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'tests/golden/reference/manifest.json'), 'utf8'),
  );
  const required = manifest.captures.filter((/** @type {any} */ c) => c.variant && !c.calibration);
  const only = (opt('--only') ?? '').split(';').filter(Boolean);
  const names = flag('--all')
    ? required.map((/** @type {any} */ c) => c.name)
    : only.length
      ? required
          .map((/** @type {any} */ c) => c.name)
          .filter((/** @type {string} */ n) => only.some((o) => n.includes(o)))
      : DEFAULT_CASES.filter((n) => required.some((/** @type {any} */ c) => c.name === n));
  if (!names.length) throw new Error('no cases');

  /** @type {any} */
  let page = null;
  let adapter = 'CPU engine only';
  /** @type {string[]} */
  const errors = [];
  if (!flag('--cpu-only')) {
    browser = await launch();
    page = await browser.newPage();
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
    adapter = await page.evaluate(() => window.__golden?.adapter ?? '');
  }
  console.log(`adapter: ${ADAPTER_CHOICE}: ${adapter}`);
  const enginePath = join(ROOT, 'tests/golden/engine-hashes.json');
  const engine = existsSync(enginePath) ? JSON.parse(readFileSync(enginePath, 'utf8')) : null;
  const strict = node.thresholds.strict;
  /** @type {any[]} */
  const cases = [];
  for (const name of names) {
    const rec = node.record(name);
    const zoom = rec.zoom ?? 1;
    const opts = node.referenceOptions(rec.params, zoom);
    const cpu = node.renderCpu(rec.params, opts, zoom);
    const row = { name, cpuMs: Math.round(cpu.ms), cpuHash: G.alphaHash(cpu.alpha) };
    if (page) {
      const render = () =>
        page.evaluate(({ P, o, z }) => window.__golden?.render(P, o, z), {
          P: rec.params,
          o: opts,
          z: zoom,
        });
      const r1 = await render();
      const r2 = await render();
      const a1 = G.alphaFromBase64(r1.alpha, r1.width, r1.height);
      const hash = G.alphaHash(a1);
      const cmp = G.compareMeasures(G.measure(a1), G.measure(cpu.alpha));
      const ev = G.evaluate(cmp, G.engineCounts(r1.counts), G.engineCounts(cpu.counts), strict);
      Object.assign(row, {
        gpuMs: Math.round(r1.ms),
        gpuHash: hash,
        l0: hash === G.alphaHash(G.alphaFromBase64(r2.alpha, r2.width, r2.height)),
        sameAsSwiftShaderGolden: engine?.hashes[name] ? engine.hashes[name] === hash : null,
        strict: { ...cmp, pass: ev.pass, failures: ev.failures },
      });
    }
    cases.push(row);
    const s = /** @type {any} */ (row).strict;
    console.log(
      `${name.padEnd(46)} ${s ? (s.pass ? 'L1 pass' : `L1 FAIL ${s.failures.join('; ')}`) : 'cpu only'}  ${
        /** @type {any} */ (row).l0 === undefined
          ? ''
          : `L0 ${/** @type {any} */ (row).l0 ? 'identical' : 'DIFFERS'}`
      }  cpu ${String(row.cpuMs)} ms${/** @type {any} */ (row).gpuMs === undefined ? '' : `, gpu ${String(/** @type {any} */ (row).gpuMs)} ms`}`,
    );
  }
  if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
  const compared = cases.filter((c) => c.strict);
  /** worst value of each measure over the cases */
  /** @type {Record<string, { worst: number, threshold: number | undefined }>} */
  const worst = {};
  for (const [key, tkey, kind] of MEASURES) {
    const vals = compared
      .map((c) => c.strict[/** @type {string} */ (key)])
      .filter((/** @type {unknown} */ v) => typeof v === 'number');
    if (!vals.length) continue;
    const w = kind === 'min' ? Math.min(...vals) : Math.max(...vals.map(Math.abs));
    worst[/** @type {string} */ (key)] = {
      worst: w,
      threshold: /** @type {any} */ (strict)[/** @type {string} */ (tkey)],
    };
  }
  const entry = {
    label: `${ADAPTER_CHOICE}: ${adapter}`,
    adapterChoice: ADAPTER_CHOICE,
    adapter,
    browser: browser ? browser.version() : null,
    date: new Date().toISOString().slice(0, 10),
    against: 'CPU engine (Node)',
    cases: cases.length,
    l1Pass: compared.filter((c) => c.strict.pass).length,
    l1Compared: compared.length,
    l0Identical: compared.filter((c) => c.l0).length,
    sameAsSwiftShaderGolden: compared.filter((c) => c.sameAsSwiftShaderGolden === true).length,
    pageErrors: errors.length,
    worst,
    results: cases,
  };
  if (!flag('--no-write') && !flag('--cpu-only')) {
    const prev = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : { adapters: [] };
    const adapters = [
      ...prev.adapters.filter((/** @type {any} */ a) => a.label !== entry.label),
      entry,
    ];
    await writeJson(REPORT, {
      about:
        'L1 measurements (npm run l1): a WebGPU adapter against the CPU engine at the strict thresholds of tests/golden/thresholds.json, one entry per adapter. Written by tools/l1/l1.mjs.',
      strictThresholds: strict,
      adapters,
    });
    await markdown();
  }
  const failed = compared.filter((c) => !c.strict.pass || !c.l0).length + errors.length;
  console.log(
    `${String(compared.length - failed)}/${String(compared.length)} cases at L1 on this adapter`,
  );
  process.exitCode = failed ? 1 : 0;
} finally {
  if (browser) await browser.close();
  await server.close();
}

/** The Markdown report, from the JSON. */
async function markdown() {
  if (!existsSync(REPORT)) return;
  const R = JSON.parse(readFileSync(REPORT, 'utf8'));
  const pct = (/** @type {number} */ x) => `${(100 * x).toFixed(3)}%`;
  const lines = [
    '# L1 report',
    '',
    'Generated by `npm run l1` from `l1-report.json`; do not edit by hand. Each entry compares one WebGPU adapter with the CPU engine (Node) on the same cases at the **strict** thresholds (ADR 0004 level L1, `tests/golden/thresholds.json`). L0 is two renders on the same adapter in a row.',
    '',
  ];
  for (const a of R.adapters) {
    lines.push(
      `## ${a.label}`,
      '',
      `Measured ${a.date}, ${a.browser ?? 'no browser'}, ${String(a.cases)} cases against the ${a.against}.`,
      '',
      `- L1 (strict thresholds): **${String(a.l1Pass)} of ${String(a.l1Compared)}** cases pass.`,
      `- L0 on this adapter (two renders identical): ${String(a.l0Identical)} of ${String(a.l1Compared)}.`,
      `- Bit-identical to the engine's SwiftShader goldens: ${String(a.sameAsSwiftShaderGolden)} of ${String(a.l1Compared)}${/swiftshader/i.test(a.adapterChoice) ? '' : ' (not expected on another adapter; L1 is what is promised)'}.`,
      '',
      '| measure | worst over the cases | strict threshold |',
      '| --- | --- | --- |',
    );
    for (const [k, v] of Object.entries(a.worst)) {
      const rel = /Rel$/.test(k);
      lines.push(
        `| ${k} | ${rel ? pct(/** @type {any} */ (v).worst) : /** @type {any} */ (v).worst.toFixed(4)} | ${/** @type {any} */ (v).threshold === undefined ? '' : String(/** @type {any} */ (v).threshold)} |`,
      );
    }
    lines.push(
      '',
      '| case | L1 | L0 | CPU engine ms | adapter ms |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const c of a.results)
      lines.push(
        `| ${c.name} | ${c.strict ? (c.strict.pass ? 'pass' : `FAIL: ${c.strict.failures.join('; ')}`) : '-'} | ${c.l0 === undefined ? '-' : c.l0 ? 'identical' : 'differs'} | ${String(c.cpuMs)} | ${c.gpuMs === undefined ? '-' : String(c.gpuMs)} |`,
      );
    lines.push('');
  }
  lines.push(
    '## Adapters not yet measured',
    '',
    "A real GPU (the owner's MacBook), and any other adapter: run `ROSSE_WEBGPU_ADAPTER=hardware npm run l1` and commit the changed `l1-report.json` and `l1-report.md` (docs/open-questions.md Q14).",
    '',
  );
  const file = MD;
  const cfg = (await resolveConfig(file)) ?? {};
  writeFileSync(file, await format(lines.join('\n'), { ...cfg, filepath: file }));
}
