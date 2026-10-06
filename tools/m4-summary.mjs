// @ts-check
/**
 * The numbers M4's docs cite (docs/milestones/m4/README.md, ADR 0018, 0019, 0020), as committed
 * data in docs/data/m4-*.json, written by this script from the runs that make them:
 *
 *   node tools/m4-summary.mjs results                 test-results/golden.json (npm run golden), the
 *                                                     thresholds, and the margins per case
 *   node tools/m4-summary.mjs calibration <k1.json> [<prev-calibration.json> <prev-thresholds.json>]
 *                                                     the K spreads and the negative-control cells:
 *                                                     tests/golden/calibration.json (K = 6) against
 *                                                     <k1.json>, the same shards aggregated for K = 1
 *                                                     (`npm run golden -- --calibrate --reuse-shards
 *                                                     --keys 1`, saved before the K = 6 one)
 *   node tools/m4-summary.mjs breaks <dir>            the seven line-work breaks, from <dir>/<name>.json
 *                                                     (copies of test-results/golden.json, one per break)
 *   node tools/m4-summary.mjs hatch <dir> [<dir>…]    hatch ink, ours against v21, from v21 captures of
 *                                                     hatch-only and no-hatch variants (see `hatch` below)
 *
 * Plain Node plus Vite's SSR loader for the engine's TypeScript, as tests/golden/compare/compare.mjs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const ROOT = resolve(import.meta.dirname, '..');
const [mode, ...rest] = process.argv.slice(2);
const server = await createServer({
  root: ROOT,
  configFile: join(ROOT, 'vite.config.ts'),
  logLevel: 'warn',
  server: { middlewareMode: true, hmr: false },
});
/** @type {any} */
const G = await server.ssrLoadModule('/tests/golden/compare/node.ts');
/** @type {any} */
const T = await server.ssrLoadModule('/tests/golden/compare/thresholds.ts');
const node = new G.GoldenNode(ROOT);

/** @param {string} file @param {unknown} data */
function write(file, data) {
  writeFileSync(join(ROOT, 'docs/data', file), JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote docs/data/${file}`);
}
const r4 = (/** @type {number} */ x) => Math.round(x * 1e4) / 1e4;

try {
  if (mode === 'results') results();
  else if (mode === 'calibration') calibration(rest[0] ?? '', rest[1], rest[2]);
  else if (mode === 'breaks') breaks(rest[0] ?? '');
  else if (mode === 'hatch') await hatch(rest);
  else
    throw new Error(
      'usage: node tools/m4-summary.mjs results | calibration <k1.json> | breaks <dir> | hatch <dir>…',
    );
} finally {
  await server.close();
}

/**
 * Every required case's mean-of-K measures against its limits: the margin of a measure is
 * |value| / limit (1 = at the limit), the coarse SSIM's the value minus its floor.
 */
function results() {
  const file = JSON.parse(readFileSync(join(ROOT, 'test-results/golden.json'), 'utf8'));
  const thresholds = JSON.parse(readFileSync(join(ROOT, 'tests/golden/thresholds.json'), 'utf8'));
  /** @type {any[]} */
  const rows = [];
  for (const r of file.results) {
    if (!r.required || r.gate) continue;
    const rec = node.record(r.name);
    const t = node.parity(rec.preset, rec.zoom ?? 1, rec.variant);
    const c = r.parity_cpu;
    /** @type {Record<string, number>} */
    const use = {
      ink: Math.abs(c.inkRel) / t.ink,
      'median width': Math.abs(c.medianRel) / t.median,
      'p90 width': Math.abs(c.p90Rel) / t.p90,
      r25: Math.abs(c.r25Rel) / t.r25,
      r50: Math.abs(c.r50Rel) / t.r50,
      r90: Math.abs(c.r90Rel) / t.r90,
      'outer ink': Math.abs(c.outerDiff) / t.outer,
      q: Math.abs(c.qDiff) / t.q,
      'inner q': Math.abs(c.qInnerDiff) / t.qInner,
    };
    const paTol = T.paTolerance(c.ref.q, t);
    if (Number.isFinite(paTol)) use['position angle'] = Math.abs(c.paDiff) / paTol;
    const [worst, margin] = Object.entries(use).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    const counts = Object.fromEntries(
      Object.entries(c.counts).map(([k, v]) => [
        k,
        { engine: r4(/** @type {any} */ (v).render), v21: /** @type {any} */ (v).ref },
      ]),
    );
    rows.push({
      case: r.name,
      pass: r.pass,
      measures: {
        ink: r4(c.inkRel),
        coarseSsim: r4(c.ssimCoarse),
        medianWidth: r4(c.medianRel),
        p90Width: r4(c.p90Rel),
        r25: r4(c.r25Rel),
        r50: r4(c.r50Rel),
        r90: r4(c.r90Rel),
        outer: r4(c.outerDiff),
        q: r4(c.qDiff),
        qInner: r4(c.qInnerDiff),
        paDeg: r4(c.paDiff),
      },
      coarseSsimHeadroom: r4(c.ssimCoarse - t.ssimCoarse),
      worstMeasure: worst,
      worstUse: r4(margin ?? 0),
      oneDraw: r.single_cpu
        ? { r50: r4(r.single_cpu.r50Rel), qInner: r4(r.single_cpu.qInnerDiff) }
        : null,
      counts,
      strictCpuVsGpu: r.strict
        ? { ink: r4(r.strict.inkRel), coarseSsim: r4(r.strict.ssimCoarse), pass: r.strict.pass }
        : null,
      l0: r.l0,
      engineHash: r.e ?? null,
      cpuMs: r.cpuMs,
      gpuMs: r.gpuMs,
    });
  }
  const worst = rows
    .slice()
    .sort((a, b) => b.worstUse - a.worstUse)
    .slice(0, 12);
  write('m4-golden-results.json', {
    about:
      'M4 required golden cases, parity against v21 as the mean of K engine draws (ADR 0018). Per case: the mean measures, the limit use of the worst measure (|value| / limit; 1 is at the limit), the coarse SSIM headroom over its floor, and the strict CPU = WebGPU comparison. Written by tools/m4-summary.mjs results from test-results/golden.json (npm run golden).',
    keys: thresholds.keys,
    cases: rows.length,
    passing: rows.filter((r) => r.pass).length,
    adapter: file.adapter,
    worstCases: worst.map((r) => ({ case: r.case, worstMeasure: r.worstMeasure, use: r.worstUse })),
    strictWorst: {
      ink: Math.max(...rows.map((r) => Math.abs(r.strictCpuVsGpu?.ink ?? 0))),
      coarseSsimMin: Math.min(...rows.map((r) => r.strictCpuVsGpu?.coarseSsim ?? 1)),
    },
    l0Identical: rows.filter((r) => r.l0 === true).length,
    engineHashesIdentical: rows.filter((r) => r.engineHash === true).length,
    results: rows,
  });
  for (const r of worst)
    console.log(`${r.case.padEnd(42)} ${r.worstMeasure.padEnd(14)} ${r.worstUse}`);
}

/**
 * ADR 0018's evidence: the spread of the K-mean statistic by K, and the negative controls' cells
 * for K = 6 (the committed calibration.json) against K = 1 (the same shards, one draw each).
 *
 * @param {string} k1Path
 * @param {string} [prevCalibration] the calibration this one replaces (K = 3 single-draw pairs)
 * @param {string} [prevThresholds]
 */
function calibration(k1Path, prevCalibration, prevThresholds) {
  if (!existsSync(k1Path)) throw new Error(`no K = 1 aggregate at ${k1Path}`);
  const k6 = JSON.parse(readFileSync(join(ROOT, 'tests/golden/calibration.json'), 'utf8'));
  const k1 = JSON.parse(readFileSync(k1Path, 'utf8'));
  /** @type {any[]} */
  const parts = [];
  for (let k = 0; existsSync(join(ROOT, `test-results/calibration-shard-${k}.json`)); k++)
    parts.push(
      JSON.parse(readFileSync(join(ROOT, `test-results/calibration-shard-${k}.json`), 'utf8')),
    );
  const p95 = (/** @type {number[]} */ xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)] ?? NaN;
  };
  /** @type {Record<string, any>} */
  const spread = {};
  const families = [...new Set(parts.flatMap((p) => Object.keys(p.pairs)))];
  for (const f of families) {
    const entries = parts.flatMap((p) => p.pairs[f] ?? []);
    spread[f] = { configurations: entries.length, byK: {} };
    const base = p95(entries.map((e) => Math.abs(G.meanComparison(e.cs.slice(0, 1)).r50Rel)));
    for (const K of [1, 2, 3, 4, 5, 6]) {
      const m = entries.map((e) => G.meanComparison(e.cs.slice(0, K)));
      const r50 = p95(m.map((c) => Math.abs(c.r50Rel)));
      spread[f].byK[K] = {
        p95AbsR50: r4(r50),
        p95AbsR25: r4(p95(m.map((c) => Math.abs(c.r25Rel)))),
        p95AbsInk: r4(p95(m.map((c) => Math.abs(c.inkRel)))),
        ratioR50ToK1: r4(r50 / base),
        theory: r4(Math.sqrt(1 + 1 / K) / Math.SQRT2),
      };
    }
  }
  /** @type {any[]} */
  const cells = [];
  for (const [f, n] of Object.entries(k6.families)) {
    const ctl = /** @type {any} */ (n).negativeControls;
    if (!ctl) continue;
    for (const [name, y] of Object.entries(ctl)) {
      const x = k1.families[f]?.negativeControls?.[name];
      cells.push({
        family: f,
        control: name,
        applicable: /** @type {any} */ (y).applicable,
        detectedK1: x?.detected ?? null,
        detectedK6: /** @type {any} */ (y).detected,
      });
    }
  }
  const thresholds = JSON.parse(readFileSync(join(ROOT, 'tests/golden/thresholds.json'), 'utf8'));
  /** the earlier calibration (before the K-mean): cells that detect less now, and thresholds that rose */
  let vsPrevious = null;
  if (prevCalibration && prevThresholds) {
    const pc = JSON.parse(readFileSync(prevCalibration, 'utf8'));
    const pt = JSON.parse(readFileSync(prevThresholds, 'utf8'));
    const lower = [];
    for (const c of cells) {
      const x = pc.families[c.family]?.negativeControls?.[c.control];
      if (x && c.detectedK6 / c.applicable < x.detected / x.applicable - 1e-9)
        lower.push({
          family: c.family,
          control: c.control,
          before: `${String(x.detected)}/${String(x.applicable)}`,
          now: `${String(c.detectedK6)}/${String(c.applicable)}`,
        });
    }
    const rose = [];
    for (const [f, t] of Object.entries(thresholds.parity)) {
      for (const k of ['ink', 'median', 'p90', 'r25', 'r50', 'r90', 'outer', 'q', 'qInner']) {
        const before = pt.parity[f]?.[k];
        const now = /** @type {any} */ (t)[k];
        if (typeof before === 'number' && now > before + 1e-9)
          rose.push({ family: f, measure: k, before, now });
      }
    }
    vsPrevious = { lowerDetection: lower, thresholdsRaised: rose };
  }
  write('m4-calibration-k.json', {
    about:
      "ADR 0018's evidence, from the calibration's shards (test-results/calibration-shard-*.json): spread, per family and K, of the mean-of-K statistic of a re-draw against a stand-in for v21 (the 95th percentile of |Δ| of r50, r25 and ink; the ratio of r50's to K = 1 and its theoretical value √((1 + 1/K)/2)); and the negative controls' detection cells with the K = 6 thresholds against the same measurements as single draws (K = 1). Written by tools/m4-summary.mjs calibration.",
    keys: k6.keys,
    standIns: k6.standIns,
    controls: k6.controls,
    configurations: k6.configurations?.length ?? null,
    spread,
    controlCells: cells,
    vsPrevious,
    totals: {
      cells: cells.length,
      cellsNotWorse: cells.filter((c) => c.detectedK6 >= (c.detectedK1 ?? 0)).length,
      detectedK1: cells.reduce((a, c) => a + (c.detectedK1 ?? 0), 0),
      detectedK6: cells.reduce((a, c) => a + c.detectedK6, 0),
      applicable: cells.reduce((a, c) => a + c.applicable, 0),
    },
    thresholdsK6: Object.fromEntries(
      Object.entries(thresholds.parity).map(([f, t]) => [
        f,
        Object.fromEntries(
          ['ink', 'ssimCoarse', 'median', 'p90', 'r25', 'r50', 'r90', 'outer', 'q', 'qInner'].map(
            (k) => [k, /** @type {any} */ (t)[k]],
          ),
        ),
      ]),
    ),
  });
}

/**
 * The seven line-work breaks (docs/milestones/m4/README.md): per break, family and camera, how many
 * of the 14 cases fail, from the golden.json copies in <dir>.
 *
 * @param {string} dir
 */
function breaks(dir) {
  const descriptions = JSON.parse(readFileSync(join(dir, 'descriptions.json'), 'utf8'));
  /** @type {Record<string, any>} */
  const out = {};
  for (const name of ['base', ...Object.keys(descriptions)]) {
    const file = join(dir, `${name}.json`);
    if (!existsSync(file)) continue;
    const res = JSON.parse(readFileSync(file, 'utf8')).results.filter(
      (/** @type {any} */ r) => r.required && !r.gate,
    );
    /** @type {Record<string, { cases: number, fail: number }>} */
    const cells = {};
    for (const r of res) {
      const variant = r.name.includes('--lines__') ? 'lines' : 'ribbons';
      const camera = r.name.slice(r.name.lastIndexOf('__') + 2);
      const cell = (cells[`${variant}/${camera}`] ??= { cases: 0, fail: 0 });
      cell.cases++;
      if (!r.parity_cpu.pass) cell.fail++;
    }
    out[name] = { edit: descriptions[name] ?? null, cells };
  }
  write('m4-breaks.json', {
    about:
      "The seven line-work breaks, each one source edit (as in QA's break table), run through the CPU golden on the `lines` (stipple off) and `ribbons` (stipple on) cases at the final thresholds: per family and camera, the number of cases (of 14 each) that fail. `base` is the unbroken source. Written by tools/m4-summary.mjs breaks from copies of test-results/golden.json.",
    breaks: out,
  });
  for (const [n, b] of Object.entries(out))
    console.log(
      n.padEnd(8),
      Object.entries(b.cells)
        .map(([k, c]) => `${k} ${String(c.fail)}/${String(c.cases)}`)
        .join('  '),
    );
}

/**
 * Hatch ink, ours against v21's: for each <dir> (a capture folder with `<preset>--hatch__s<seed>__home`
 * and `<preset>--nohatch__s<seed>__home` v21 captures, stipple, lines, knots and sparkle off, and
 * `dustScribble: 0` on the nohatch ones), the ink the hatching adds (hatch − nohatch, Σα) in v21 and in
 * the engine drawn with v21's choices, and the ratio. The engine side is drawn on the CPU.
 *
 * @param {string[]} dirs
 */
async function hatch(dirs) {
  /** @type {any[]} */
  const rows = [];
  for (const d of dirs) {
    const dir = resolve(d);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const names = manifest.captures
      .filter((/** @type {any} */ c) => c.variant === 'hatch')
      .map((/** @type {any} */ c) => c.name);
    for (const nh of names) {
      const nn = nh.replace('--hatch__', '--nohatch__');
      const rh = JSON.parse(readFileSync(join(dir, `${nh}.json`), 'utf8'));
      const rn = JSON.parse(readFileSync(join(dir, `${nn}.json`), 'utf8'));
      const ink = (/** @type {any} */ a, /** @type {any} */ b) => {
        let s = 0;
        let cover = 0;
        let n = 0;
        for (let i = 0; i < a.data.length; i++) {
          const x = a.data[i] - b.data[i];
          s += x;
          if (x > 0.02) {
            cover += a.data[i];
            n++;
          }
        }
        return { ink: s, meanAlpha: n ? cover / n : 0, pixels: n };
      };
      const v = ink(
        G.readPngAlpha(join(dir, `${nh}.ink.png`)),
        G.readPngAlpha(join(dir, `${nn}.ink.png`)),
      );
      const o = ink(
        node.renderCpu(rh.params, node.referenceOptions(rh.params)).alpha,
        node.renderCpu(rn.params, node.referenceOptions(rn.params)).alpha,
      );
      rows.push({
        case: nh,
        pen: rh.params.pen,
        halfWidthPx: r4((rh.params.pen / 2) * 0.38),
        ratio: r4(o.ink / v.ink),
        meanAlphaEngine: r4(o.meanAlpha),
        meanAlphaV21: r4(v.meanAlpha),
        pixelsEngine: o.pixels,
        pixelsV21: v.pixels,
      });
    }
  }
  const ratios = rows.map((r) => r.ratio);
  write('m4-hatch-ink.json', {
    about:
      "Ink the dust hatching adds, engine against v21 (ADR 0019): (hatch − no hatch) of Σα on v21 captures with the stipple, lines, knots and sparkle off, against the CPU engine drawn with v21's choices (ADR 0018). `before` is the first build (capsule coverage, composited per pixel), measured the same way on the ten pen 2.4 cases before ADR 0019 (the engine as of commit 6eb2e8e); `rows` are the final build (v21's quads unioned at its four sample positions). Written by tools/m4-summary.mjs hatch.",
    before: {
      pen: 2.4,
      about: 'the first build: capsule coverage composited per pixel (engine as of commit 6eb2e8e)',
      ratios: Object.fromEntries([
        ['grand-design--hatch__s7__home', 1.196],
        ['grand-design--hatch__s4242__home', 1.244],
        ['flocculent--hatch__s7__home', 1.19],
        ['flocculent--hatch__s4242__home', 1.195],
        ['hand-wobble--hatch__s7__home', 1.19],
        ['hand-wobble--hatch__s4242__home', 1.207],
        ['tightly-wound--hatch__s7__home', 1.196],
        ['tightly-wound--hatch__s4242__home', 1.212],
        ['dusty-spiral--hatch__s7__home', 1.167],
        ['dusty-spiral--hatch__s4242__home', 1.205],
      ]),
      mean: 1.2,
    },
    summary: {
      min: Math.min(...ratios),
      max: Math.max(...ratios),
      mean: r4(ratios.reduce((a, b) => a + b, 0) / ratios.length),
    },
    rows,
  });
  for (const r of rows) console.log(r.case.padEnd(38), `pen ${String(r.pen)}`, r.ratio);
}
