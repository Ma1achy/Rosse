#!/usr/bin/env node
// Profile the reference Rosse engine (rosse-v21.html / app23.js) stage by stage, for every preset.
//
// The page is patched in memory only (string replacement on the inlined app script); the asset file
// is never written. Each stage function `foo` is renamed `foo__raw` and a wrapper `foo` is declared
// in the same IIFE (function declarations hoist), which accumulates call counts, inclusive and self
// time into window.__PROF. drawSprites and drawRibbons also count instances per atlas and ribbon
// vertices per texture.
//
// Run:  node tools/profile-reference/profile.mjs [--out path] [--only "Preset name"] [--repeat n]
// (with Playwright installed locally, or globally under /opt/node22/lib/node_modules)

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PAGE = path.join(ROOT, 'assets/reference/pages/rosse-v21.html');
const APP = path.join(ROOT, 'assets/reference/rosse-source/app23.js');

// ---------- command line ----------
const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
}
const OUT = path.resolve(arg('--out', path.join(ROOT, 'docs/data/reference-profile.json')));
const ONLY = arg('--only', null);
const REPEAT = Math.max(1, parseInt(arg('--repeat', '3'), 10) || 3); // timing-only repeats of the warm render (median reported)
const SEED = 7;

// ---------- playwright: prefer a local install, fall back to the global one ----------
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    /* not installed locally */
  }
  const globalDirs = [
    '/opt/node22/lib/node_modules',
    ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
  ];
  const resolved = require.resolve('playwright', { paths: globalDirs });
  return require(resolved);
}
const { chromium } = loadPlaywright();

// ---------- the stages we time ----------
const STAGES = [
  'generate',
  'curves',
  'buildCurves',
  'parts',
  'skyParts',
  'buildSky',
  'expandVector',
  'simulateMerger',
  'mergerSprites',
  'lensSolver',
  'lensMarks',
  'lensSprites10',
  'buildSourceGalaxy',
  'starSprites',
  'overlaySprites',
  'shellSprites',
  'dustLanes',
  'makeVariation',
  'drawSprites',
  'drawRibbons',
  'render',
];

// Instrumentation injected into the app IIFE. Self time = inclusive time minus time spent in wrapped
// callees. Inclusive time is only added for the outermost activation of a name, so recursion (or a
// stage re-entered through another, e.g. render -> lensSprites10 -> buildSourceGalaxy -> generate)
// is never double counted. `edges` records caller>callee pairs so nested uses can be told apart.
function instrumentation() {
  const wrappers = STAGES.map(
    (n) =>
      `function ${n}() { return __profCall(${JSON.stringify(n)}, ${n}__raw, this, arguments); }`,
  ).join('\n');
  return `
/* ---- profile-reference instrumentation (injected in memory) ---- */
function __profState() {
  var P0 = window.__PROF;
  if (!P0) { P0 = window.__PROF = { fn: {}, edges: {}, atlas: {}, ribbons: {}, drawLog: [], stack: [] }; }
  return P0;
}
window.__PROFRESET = function () { window.__PROF = null; return __profState(); };
function __profCall(name, fn, self, args) {
  var PR = __profState(), st = PR.stack, fr = { n: name, t0: performance.now(), ch: 0 };
  if (name === 'drawSprites') { var at = args[0], rows = args[1] || []; var a = PR.atlas[at] || (PR.atlas[at] = { instances: 0, offscreen: 0, draws: 0 }); a.instances += rows.length; a.draws++; var cell = AT[at] && AT[at].cell; if (cell && !a.mip) a.mip = [0, 0, 0, 0, 0, 0, 0, 0];
    for (var q = 0; q < rows.length; q++) { var rw = rows[q], rx = rw[0], ry = rw[1]; if (!(rx > -64 && rx < VIEW.W + 64 && ry > -64 && ry < VIEW.W + 64)) a.offscreen++;
      if (cell) { var qs = Math.sqrt(Math.abs(rw[4] * rw[7] - rw[5] * rw[6])) || 1e-6, lod = Math.log2(cell / qs); a.mip[Math.max(0, Math.min(7, Math.round(lod)))]++; } } if (PR.drawLog.length < 400) PR.drawLog.push(['sprites', at, rows.length]); }
  if (name === 'drawRibbons') { var V = args[0] || [], tn = args[4] || 'strokes'; var rb = PR.ribbons[tn] || (PR.ribbons[tn] = { vertices: 0, draws: 0 }); rb.vertices += V.length / 5; rb.draws++; if (PR.drawLog.length < 400) PR.drawLog.push(['ribbons', tn, V.length / 5]); }
  st.push(fr);
  try { return fn.apply(self, args); }
  finally {
    var dt = performance.now() - fr.t0; st.pop();
    var e = PR.fn[name] || (PR.fn[name] = { calls: 0, incl: 0, self: 0 });
    e.calls++; e.self += dt - fr.ch;
    var nested = false; for (var i = 0; i < st.length; i++) if (st[i].n === name) { nested = true; break; }
    if (!nested) e.incl += dt;
    var par = st.length ? st[st.length - 1] : null; if (par) par.ch += dt;
    var ek = (par ? par.n : '(top)') + '>' + name, ed = PR.edges[ek] || (PR.edges[ek] = { calls: 0, ms: 0 }); ed.calls++; ed.ms += dt;
  }
}
${wrappers}
window.__PROBE = function () { return { RMAX: RMAX, H: H, CAM: CAM, RMIN: RMIN, ZOOM: ZOOM, VIEW: { W: VIEW.W, cx: VIEW.cx, cy: VIEW.cy, scale: VIEW.scale }, LHOME: LHOME.o, OVHOME: OVHOME.o }; };
/* ---- end instrumentation ---- */
`;
}

function patchPage(html) {
  let out = html;
  for (const n of STAGES) {
    const needle = `function ${n}(`;
    const count = out.split(needle).length - 1;
    if (count !== 1)
      throw new Error(`expected exactly one "${needle}" in the page, found ${count}`);
    out = out.replace(needle, `function ${n}__raw(`);
  }
  const anchor = 'window.__GEN = {';
  if (out.split(anchor).length - 1 !== 1) throw new Error('could not find the window.__GEN hook');
  out = out.replace(anchor, instrumentation() + anchor);
  // fix the canvas at 800 x 800 CSS px (with deviceScaleFactor 1 this makes canvas.width === 800)
  out = out.replace(
    '</head>',
    '<style id="profile-reference">#gl{width:800px!important;height:800px!important;aspect-ratio:auto!important}</style></head>',
  );
  return out;
}

function extractPresets(src) {
  const start = src.indexOf('var PRESETS = {');
  if (start < 0) throw new Error('PRESETS not found in app23.js');
  const end = src.indexOf('\n};', start);
  const literal = src.slice(start + 'var PRESETS = '.length, end + 2);
  return new Function('return ' + literal)();
}

function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}
function round(x, d = 2) {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}
function roundProf(p) {
  const fn = {};
  for (const [k, v] of Object.entries(p.fn))
    fn[k] = { calls: v.calls, inclMs: round(v.incl), selfMs: round(v.self) };
  const edges = {};
  for (const [k, v] of Object.entries(p.edges)) edges[k] = { calls: v.calls, ms: round(v.ms) };
  return { fn, edges, atlas: p.atlas, ribbons: p.ribbons, drawLog: p.drawLog };
}

// ---------- serve the patched page ----------
const html = patchPage(fs.readFileSync(PAGE, 'utf8'));
const PRESETS = extractPresets(fs.readFileSync(APP, 'utf8'));
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const PORT = server.address().port;

const FLAGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args: FLAGS });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1400 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
// the page asks Google Fonts for its type; nothing outside localhost is needed for the drawing
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(`http://127.0.0.1:${PORT}/`) || u.startsWith('data:')) route.continue();
  else route.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(
  () => window.__GEN && window.__GEN.stats && window.__GEN.stats().ms != null,
  null,
  { timeout: 120000 },
);
await page.waitForTimeout(500);

const env = await page.evaluate(() => {
  const cv = document.getElementById('gl'),
    gl = cv.getContext('webgl2'),
    dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    canvasWidth: cv.width,
    canvasHeight: cv.height,
    clientWidth: cv.clientWidth,
    dpr: window.devicePixelRatio,
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    userAgent: navigator.userAgent,
    probe: window.__PROBE(),
  };
});
if (env.canvasWidth !== 800) throw new Error(`canvas.width is ${env.canvasWidth}, expected 800`);

// One measured render. `action` runs inside the page; the GPU is synchronised with a 1-pixel
// readPixels so that wallMs includes SwiftShader's rasterisation, while render.inclMs is CPU only.
async function measure(action, arg) {
  return page.evaluate(
    ([action, arg]) => {
      const gl = document.getElementById('gl').getContext('webgl2'),
        px = new Uint8Array(4);
      window.__PROFRESET();
      const t0 = performance.now();
      if (action === 'preset') window.__GEN.preset(arg);
      else if (action === 'set') window.__GEN.set(arg);
      else if (action === 'orbit') {
        const P = window.__GEN.P();
        window.__GEN.set({ az: ((P.az || 0) + arg) % 360 });
      }
      const t1 = performance.now();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t2 = performance.now();
      const pr = window.__PROF,
        P = window.__GEN.P();
      return {
        cpuMs: t1 - t0,
        wallMs: t2 - t0,
        prof: {
          fn: pr.fn,
          edges: pr.edges,
          atlas: pr.atlas,
          ribbons: pr.ribbons,
          drawLog: pr.drawLog,
        },
        stats: Object.assign({}, window.__GEN.stats()),
        P: { az: P.az, incl: P.incl, pa: P.pa, plates: P.plates, seed: P.seed },
      };
    },
    [action, arg],
  );
}
async function timeOnly(n) {
  return page.evaluate((n) => {
    const gl = document.getElementById('gl').getContext('webgl2'),
      px = new Uint8Array(4),
      out = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      window.__GEN.set({});
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push(performance.now() - t0);
    }
    return out;
  }, n);
}

function summarise(m) {
  const passes = m.P.plates === 'slip' ? 4 : 1; // 'slip' draws the whole scene four times (three process plates and the key)
  const atlas = {};
  let inst = 0,
    off = 0;
  for (const [k, v] of Object.entries(m.prof.atlas)) {
    atlas[k] = v.instances / passes;
    inst += v.instances / passes;
    off += v.offscreen / passes;
  }
  const ribbons = {};
  let rv = 0;
  for (const [k, v] of Object.entries(m.prof.ribbons)) {
    ribbons[k] = v.vertices / passes;
    rv += v.vertices / passes;
  }
  const f = (n) => m.prof.fn[n] || { calls: 0, incl: 0, self: 0 };
  return {
    scenePasses: passes,
    instancesPerPass: inst,
    offscreenInstancesPerPass: off,
    instancesByAtlas: atlas,
    ribbonVerticesPerPass: rv,
    ribbonVerticesByTexture: ribbons,
    renderCpuMs: round(f('render').incl),
    wallMs: round(m.wallMs),
    drawCpuMs: round(f('drawSprites').incl + f('drawRibbons').incl),
  };
}

// ---------- the run ----------
await page.evaluate((s) => window.__GEN.set({ seed: s }), SEED);
const names = Object.keys(PRESETS).filter((n) => !ONLY || n === ONLY);
const results = [];
for (const name of names) {
  const cold = await measure('preset', name); // first render of this preset (merger/shell simulations not cached yet)
  const warm = await measure('set', {}); // the same parameters again: caches warm
  const reps = await timeOnly(REPEAT);
  const orbit = await measure('orbit', 5); // orbit 5 degrees round the axis: a full rebuild
  const entry = {
    name,
    overrides: PRESETS[name],
    seed: SEED,
    stats: warm.stats,
    summary: {
      cold: summarise(cold),
      warm: summarise(warm),
      orbit: summarise(orbit),
      warmWallMsMedian: round(median(reps.concat([warm.wallMs]))),
    },
    orbitChangesCounts: ['dots', 'knots', 'stars', 'rstars']
      .filter((k) => warm.stats[k] !== orbit.stats[k])
      .map((k) => `${k} ${warm.stats[k]} -> ${orbit.stats[k]}`),
    cold: {
      cpuMs: round(cold.cpuMs),
      wallMs: round(cold.wallMs),
      stats: cold.stats,
      prof: roundProf(cold.prof),
    },
    warm: {
      cpuMs: round(warm.cpuMs),
      wallMs: round(warm.wallMs),
      repeatsWallMs: reps.map((x) => round(x)),
      stats: warm.stats,
      prof: roundProf(warm.prof),
    },
    orbit: {
      azDelta: 5,
      P: orbit.P,
      cpuMs: round(orbit.cpuMs),
      wallMs: round(orbit.wallMs),
      stats: orbit.stats,
      prof: roundProf(orbit.prof),
    },
  };
  results.push(entry);
  const s = entry.summary.warm;
  console.log(
    `${name.padEnd(42)} dots ${String(warm.stats.dots).padStart(6)}  inst ${String(Math.round(s.instancesPerPass)).padStart(6)}  rib ${String(Math.round(s.ribbonVerticesPerPass)).padStart(6)}  cold ${String(entry.summary.cold.wallMs).padStart(7)} ms  warm ${String(entry.summary.warmWallMsMedian).padStart(7)} ms  orbit ${String(s && entry.summary.orbit.wallMs).padStart(7)} ms`,
  );
}

// ---------- determinism checks (the orbit stipple re-roll; navigation history) ----------
async function statsAfter(steps) {
  return page.evaluate((steps) => {
    for (const [k, a] of steps) {
      if (k === 'preset') window.__GEN.preset(a);
      else window.__GEN.set(a);
    }
    return Object.assign({}, window.__GEN.stats(), { probe: window.__PROBE() });
  }, steps);
}
const checks = {};
if (!ONLY) {
  const gd = (az, scrib) =>
    statsAfter([
      ['set', { seed: SEED }],
      ['preset', 'Grand design'],
      ['set', { dustScribble: scrib, az }],
    ]);
  checks.orbitRerollsStipple = {
    note: "Grand design, seed 7: az 0 vs az 0.3 degrees. With dust lanes (dustScribble 0.5, the default) the inLane() rejection is view-dependent and shifts generate()'s single RNG stream.",
    dustScribble05: { az0: await gd(0, 0.5), az03: await gd(0.3, 0.5) },
    dustScribble0: { az0: await gd(0, 0), az03: await gd(0.3, 0) },
  };
  for (const v of Object.values(checks.orbitRerollsStipple))
    if (v && v.az0) {
      delete v.az0.probe;
      delete v.az03.probe;
    }
  // homeFor(): the lensed source is fixed in 3D using the camera at the moment its key was first seen
  const pathA = await statsAfter([
    ['preset', 'Lens: giant arc'],
    ['set', { az: 40 }],
  ]);
  const pathB = await statsAfter([
    ['preset', 'Lens: giant arc'],
    ['set', { az: 40 }],
    ['set', { lensSrc: 0.21 }],
    ['set', { lensSrc: 0.2 }],
  ]);
  const pathC = await statsAfter([
    ['preset', 'Lens: giant arc'],
    ['set', { az: 40 }],
  ]);
  checks.historyDependence = {
    note: 'Same final P (Lens: giant arc, az 40). A: preset then orbit. B: preset, orbit, nudge lensSrc and put it back (LHOME re-keyed at az 40). C: A again.',
    A: pathA,
    B: pathB,
    C: pathC,
    differs:
      ['dots', 'knots', 'stars', 'rstars', 'curves'].some((k) => pathA[k] !== pathB[k]) ||
      JSON.stringify(pathA.probe.LHOME) !== JSON.stringify(pathB.probe.LHOME),
  };
}

// ---------- headline numbers ----------
const W = results.map((r) => ({
  name: r.name,
  dots: r.stats.dots,
  inst: r.summary.warm.instancesPerPass,
  rib: r.summary.warm.ribbonVerticesPerPass,
  cold: r.summary.cold.wallMs,
  warm: r.summary.warmWallMsMedian,
  orbit: r.summary.orbit.wallMs,
  renderCpu: r.summary.warm.renderCpuMs,
}));
function mmm(key) {
  const v = W.map((w) => w[key]);
  return { min: Math.min(...v), median: median(v), max: Math.max(...v) };
}
const headline = {
  dots: mmm('dots'),
  instancesPerPass: mmm('inst'),
  ribbonVerticesPerPass: mmm('rib'),
  coldWallMs: mmm('cold'),
  warmWallMs: mmm('warm'),
  orbitWallMs: mmm('orbit'),
  warmRenderCpuMs: mmm('renderCpu'),
  slowestCold: W.slice()
    .sort((a, b) => b.cold - a.cold)
    .slice(0, 6)
    .map((w) => [w.name, w.cold]),
  slowestWarm: W.slice()
    .sort((a, b) => b.warm - a.warm)
    .slice(0, 6)
    .map((w) => [w.name, w.warm]),
  mostInstances: W.slice()
    .sort((a, b) => b.inst - a.inst)
    .slice(0, 6)
    .map((w) => [w.name, w.inst]),
  mostRibbonVertices: W.slice()
    .sort((a, b) => b.rib - a.rib)
    .slice(0, 6)
    .map((w) => [w.name, w.rib]),
};

const browserVersion = browser.version();
const out = {
  meta: {
    tool: 'tools/profile-reference/profile.mjs',
    date: new Date().toISOString(),
    page: 'assets/reference/pages/rosse-v21.html (inlined app23.js, patched in memory only)',
    browser: `chromium ${browserVersion}`,
    playwright: (() => {
      try {
        return createRequire(import.meta.url)('playwright/package.json').version;
      } catch {
        return null;
      }
    })(),
    launchArgs: FLAGS,
    viewport: { width: 1600, height: 1400 },
    deviceScaleFactor: 1,
    canvas: env,
    seed: SEED,
    warmRepeats: REPEAT,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    note:
      'All timings are from headless Chromium with SwiftShader (software WebGL) on a shared container CPU. ' +
      'CPU stage times (prof.fn, *.inclMs/selfMs) are meaningful relative to each other; wallMs includes a 1-pixel readPixels to wait for SwiftShader to rasterise, ' +
      'so draw cost is far higher than on a real GPU. render() also includes some DOM work (stats text, cards).',
    definitions: {
      cold: 'the render done by __GEN.preset(name): first render with these parameters (merger/shell simulations computed unless cached by an earlier identical key; sky cache may carry over from the previous preset)',
      warm: '__GEN.set({}) straight after: identical parameters, simulation caches warm',
      orbit:
        '__GEN.set({ az: az + 5 }) after the warm render: everything is rebuilt except the cached simulations',
      instancesPerPass:
        'sum of rows passed to drawSprites, divided by the number of scene passes (4 for plates "slip")',
      'prof.atlas[*].mip':
        "histogram of each instance's approximate mip level, round(log2(cell px / quad side px)), index 0..7 (7 = 7 or more); counts summed over all scene passes",
      offscreenInstancesPerPass:
        'of those, rows whose centre lies more than 64 px outside the 800 x 800 view (wasted work)',
      ribbonVerticesPerPass:
        'sum of V.length / 5 passed to drawRibbons per pass; texture "strokes" is arm ribbons, "solid" is expanded vector line-work',
      'prof.fn':
        'per stage: calls, inclMs (outermost activations only), selfMs (minus wrapped callees)',
      'prof.edges':
        'caller>callee: calls and inclusive ms, to tell e.g. render>generate from buildSourceGalaxy>generate',
    },
    pageErrors,
  },
  headline,
  checks,
  presets: results,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(
  `\nwrote ${path.relative(process.cwd(), OUT)}  (${results.length} presets, chromium ${browserVersion})`,
);
if (pageErrors.length) console.log('page errors:', pageErrors);
await browser.close();
server.close();
