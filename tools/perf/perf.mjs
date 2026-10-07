// @ts-check
/**
 * `npm run perf`: the profiling harness (M10).
 *
 *   npm run perf                       # the GPU page on the chosen adapter, and the CPU engine in Node
 *   npm run perf -- --gpu              # only the WebGPU page
 *   npm run perf -- --cpu              # only the CPU engine
 *   npm run perf -- --quick            # fewer frames (a smoke run; the report is not rewritten)
 *   npm run perf -- --scenarios "Grand design;Barred spiral"   (names are separated by semicolons)
 *   npm run perf -- --later            # also the deep field, the cluster lens and a merger (M7–M9), once merged
 *   npm run perf -- --orbit 20 --model 5 --css 800 --dpr 1
 *   ROSSE_WEBGPU_ADAPTER=hardware npm run perf -- --gpu     # a real GPU (see tools/gpu-test/browser.mjs)
 *
 * Each run writes one JSON file per adapter to docs/milestones/m10/perf/ (Prettier-formatted at
 * source), keyed by the adapter's label, and `npm run perf:report` merges them into the report
 * docs/milestones/m10/perf-report.md. A file records the adapter the page really got
 * (`adapter.description`), so a number is never separated from where it was measured: SwiftShader
 * is a software rasteriser on CPU cores, and its GPU numbers are not a GPU's.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, platform, release } from 'node:os';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { ADAPTER_CHOICE, ROOT, launch, prepareAssets, startServer } from '../gpu-test/browser.mjs';
import { LATER, SINGLE_GALAXY } from './scenarios.mjs';

const args = process.argv.slice(2);
const flag = (/** @type {string} */ f) => args.includes(f);
const opt = (/** @type {string} */ k, /** @type {string} */ d) => {
  const i = args.indexOf(k);
  return i >= 0 ? (args[i + 1] ?? d) : d;
};
const quick = flag('--quick');
const onlyGpu = flag('--gpu');
const onlyCpu = flag('--cpu');
const config = {
  orbitFrames: Number(opt('--orbit', quick ? '3' : '12')),
  modelRuns: Number(opt('--model', quick ? '1' : '4')),
  plateCss: Number(opt('--css', '800')),
  dpr: Number(opt('--dpr', '1')),
};
const outDir = join(ROOT, opt('--out', 'docs/milestones/m10/perf'));
const wanted = opt('--scenarios', '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

/** @param {string} file @param {unknown} data */
async function writeJson(file, data) {
  const cfg = (await resolveConfig(file)) ?? {};
  writeFileSync(file, await format(JSON.stringify(data), { ...cfg, filepath: file }));
}

const slug = (/** @type {string} */ s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function machine() {
  const c = cpus();
  return {
    platform: `${platform()} ${release()}`,
    node: process.version,
    cpu: `${c.length} × ${c[0]?.model ?? 'unknown'}`,
    loadBefore: loadavg().map((x) => Math.round(x * 100) / 100),
  };
}

prepareAssets();
const server = await startServer();
/** @type {import('./scenarios.mjs').Scenario[]} */
let scenarios = [...SINGLE_GALAXY, ...(flag('--later') ? LATER : [])];
try {
  /** @type {typeof import('../../src/core/presets')} */
  const presets = await server.vite.ssrLoadModule('/src/core/presets.ts');
  const skipped = scenarios.filter((s) => !presets.PRESET_NAMES.includes(s.preset));
  scenarios = scenarios.filter((s) => presets.PRESET_NAMES.includes(s.preset));
  if (skipped.length)
    console.log(`not in this tree (later milestones): ${skipped.map((s) => s.name).join(', ')}`);
  if (wanted.length) scenarios = scenarios.filter((s) => wanted.includes(s.name));
  mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);

  if (!onlyCpu) {
    const browser = await launch();
    try {
      const page = await browser.newPage();
      /** @type {string[]} */
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${server.url}/tests/perf/perf.html`);
      await page.waitForFunction(() => window.__perf !== undefined || window.__perfError, null, {
        timeout: 120_000,
      });
      const err = await page.evaluate(() => window.__perfError);
      if (err) throw new Error(`perf page: ${err}`);
      const info = await page.evaluate(() => ({
        adapter: window.__perf?.adapter,
        features: window.__perf?.features,
        timestamps: window.__perf?.timestamps,
      }));
      const m = machine();
      console.log(
        `WebGPU adapter: ${info.adapter?.description || info.adapter?.vendor || '?'} (${ADAPTER_CHOICE}); timestamp-query ${info.timestamps ? 'yes' : 'no'}`,
      );
      const results = await page.evaluate(
        ({ scenarios, config }) => window.__perf?.run({ scenarios, ...config }),
        { scenarios, config },
      );
      const record = {
        kind: 'gpu',
        label: `webgpu: ${ADAPTER_CHOICE}`,
        adapterChoice: ADAPTER_CHOICE,
        ...info,
        browser: browser.version(),
        date,
        machine: { ...m, loadAfter: loadavg().map((x) => Math.round(x * 100) / 100) },
        config,
        errors,
        results,
      };
      if (!quick) await writeJson(join(outDir, `gpu-${slug(ADAPTER_CHOICE)}.json`), record);
      for (const r of results ?? []) {
        const o = r.orbit;
        console.log(
          `${r.name.padEnd(20)} orbit ${o.latencyMs.median.toFixed(0).padStart(5)} ms (cpu side ${o.cpuSideMs.median.toFixed(1)}, pipelined ${o.pipelinedMs.toFixed(0)}, gpu ${o.gpuMs ? o.gpuMs.median.toFixed(2) : 'n/a'})  first frame ${r.model.firstFrameMs.median.toFixed(0)} ms  alloc/frame buf ${o.alloc.createBuffer} bg ${o.alloc.createBindGroup}`,
        );
      }
      if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
    } finally {
      await browser.close();
    }
  }

  if (!onlyGpu) {
    /** @type {typeof import('../../tests/perf/cpu-bench')} */
    const B = await server.vite.ssrLoadModule('/tests/perf/cpu-bench.ts');
    const m = machine();
    const results = B.benchCpu(ROOT, scenarios, config);
    const record = {
      kind: 'cpu',
      label: 'CPU engine (Node, one thread)',
      date,
      machine: { ...m, loadAfter: loadavg().map((x) => Math.round(x * 100) / 100) },
      config,
      results,
    };
    if (!quick) await writeJson(join(outDir, 'cpu-engine.json'), record);
    for (const r of results)
      console.log(
        `${r.name.padEnd(20)} cpu: orbit ${r.orbitFrameMs.median.toFixed(0).padStart(5)} ms (view ${r.viewMs.median.toFixed(0)}, ink ${r.inkMs.median.toFixed(0)}, present ${r.presentMs.median.toFixed(0)}) first frame ${r.firstFrameMs.median.toFixed(0)} ms, ${r.marks} marks`,
      );
  }
} finally {
  await server.close();
}
