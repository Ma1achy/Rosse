// @ts-check
/**
 * `npm run vectors:camera`: test vectors for src/view/camera.ts, computed by v21's own camera
 * functions. The functions are cut out of assets/reference/rosse-source/app23.js by name and
 * evaluated as they are, with v21's globals (`P`, `VIEW`, `LHOME`, `OVHOME`) set per case, so the
 * numbers are the reference's, not a port's. Writes tests/vectors/camera.json.
 *
 * Covered: incE (L856), discM (L126), project (L153), rotFwd and rotInv (L440–441), toView and
 * toScreen with the deep-field perspective CAM / (CAM − z) (L859–860, L884), basis and orient
 * (L861–866), scenePoint and srcNow through homeFor (L445–450), at zooms 0.15–12 (VIEW.scale =
 * 84 · ZOOM, L1227).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = resolve(ROOT, 'assets/reference/rosse-source/app23.js');
const OUT = resolve(ROOT, 'tests/vectors/camera.json');
const src = readFileSync(SOURCE, 'utf8');

/** The source of `function name(…) { … }`, braces matched (none of these has braces in strings). */
function fn(name) {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in app23.js`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start + 1, i + 1);
}

const constants =
  /var SKY = \{ key: null \}, (CAM = 30, RMIN = 40, RMAX = 240, R_FG = 42), ZOOM = 1;/.exec(src);
if (!constants) throw new Error('CAM, RMIN, RMAX, R_FG not found');
const NAMES = [
  'clamp',
  'Rm',
  'Sm',
  'mul',
  'chain',
  'ci',
  'paR',
  'azR',
  'discM',
  'project',
  'rotFwd',
  'rotInv',
  'orientNow',
  'homeFor',
  'scenePoint',
  'srcNow',
  'incE',
  'toView',
  'toScreen',
  'basis',
  'orient',
];
const body = `
var P = {}, VIEW = { W: 800, cx: 400, cy: 400, scale: 84 }, ${constants[1]};
var OVHOME = { key: null, o: null }, LHOME = { key: null, o: null };
${NAMES.map(fn).join('\n')}
return { setP: function (o) { P = o; }, VIEW: VIEW, LHOME: LHOME, CAM: CAM,
  ${NAMES.map((n) => `${n}: ${n}`).join(', ')} };`;
/** @type {any} */
const V = new Function(body)();

// a small deterministic generator for the cases (not the engine's RNG)
let state = 0x2545f491;
const rnd = () => {
  state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
  state ^= state >>> 12;
  return (state >>> 0) / 4294967296;
};
const pick = (/** @type {number[]} */ a) => a[Math.floor(rnd() * a.length)] ?? 0;
const round = (/** @type {number} */ x, /** @type {number} */ k) => Math.round(x * k) / k;

/** Cameras: the corners (0, 90, 180°, mirrored, extreme zooms) and random ones. */
const cameras = [
  { incl: 0, az: 0, pa: 0, winding: 1, zoom: 1 },
  { incl: 30, az: 0, pa: 0, winding: 1, zoom: 1 },
  { incl: 90, az: 0, pa: 0, winding: 1, zoom: 1 },
  { incl: 180, az: 0, pa: 0, winding: -1, zoom: 1 },
  { incl: 62, az: 35, pa: 47, winding: -1, zoom: 2 },
  { incl: 75, az: 290, pa: 359, winding: 1, zoom: 0.15 },
  { incl: 120, az: 180, pa: 90, winding: 1, zoom: 12 },
  { incl: 200, az: 10, pa: 200, winding: -1, zoom: 1.15 },
  { incl: -10, az: 359.55, pa: 3, winding: 1, zoom: 0.5 },
];
for (let k = 0; k < 31; k++)
  cameras.push({
    incl: round(rnd() * 180, 20),
    az: round(rnd() * 360, 20),
    pa: round(rnd() * 360, 4),
    winding: pick([1, -1]),
    zoom: pick([0.15, 0.5, 1, 1.15, 2, 3.7, 12]),
  });

const points = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [2.3, -1.1, 0.07],
  [-3.9, 2.2, -0.4],
];
for (let k = 0; k < 4; k++) points.push([(rnd() - 0.5) * 8, (rnd() - 0.5) * 8, (rnd() - 0.5) * 1]);
const worlds = [
  [12, -30, 25],
  [-140, 60, 90],
  [5, 5, 41],
  [0, 0, -200],
];
const normals = [
  [0, 0, 1],
  [0.6, 0, 0.8],
  [-0.3, 0.9, 0.316],
  [0.1, 0.05, -0.99],
];

const cases = cameras.map((cam) => {
  const Pnow = { incl: cam.incl, az: cam.az, pa: cam.pa, winding: cam.winding, seed: 7 };
  V.setP(Pnow);
  V.VIEW.scale = 84 * cam.zoom; // render(), L1227
  const o = V.orientNow();
  const home = {
    incl: round(rnd() * 180, 2),
    az: round(rnd() * 360, 2),
    pa: round(rnd() * 360, 2),
    winding: pick([1, -1]),
  };
  const view = worlds.map((w) => {
    const v = V.toView(w);
    const k = V.CAM / (V.CAM - v[2]);
    return { w, v, k, screen: V.toScreen(v, k) };
  });
  const orient = normals.map((n, j) => ({
    n,
    size: 10 + 7 * j,
    spin: 0.3 * j,
    flat: j === 2 ? 0.3 : undefined,
    m: V.orient(n, 10 + 7 * j, 0.3 * j, j === 2 ? 0.3 : undefined),
  }));
  // scenePoint and srcNow remember the first orientation they see for a key (homeFor): see the
  // home first, then the current camera
  const ovKey = 'k';
  const H = { key: null, o: null };
  V.setP({ ...Pnow, ...home });
  V.scenePoint(H, ovKey, 0, 0, 0);
  const homeLensKey = [7, 0, 0, 0, 0, 0, 0, 0, 0, 0].join('|');
  V.LHOME.key = null;
  V.setP({
    ...Pnow,
    ...home,
    lensSrc: 0,
    lensSrcA: 0,
    lensR: 0,
    lensQ: 0,
    lensCluster: 0,
    lensDouble: 0,
    lensSource: 0,
    lensSize: 0,
    merger: 0,
  });
  V.srcNow(0, 0, 1);
  if (V.LHOME.key !== homeLensKey) throw new Error('srcNow key');
  V.setP({
    ...Pnow,
    lensSrc: 0,
    lensSrcA: 0,
    lensR: 0,
    lensQ: 0,
    lensCluster: 0,
    lensDouble: 0,
    lensSource: 0,
    lensSize: 0,
    merger: 0,
  });
  const scene = [
    [30, -12, 0.5],
    [-80, 44, -2],
    [0, 0, 3],
  ].map(([sx, sy, d]) => ({ sx, sy, depth: d, xy: V.scenePoint(H, ovKey, sx, sy, d) }));
  const src = [
    [0.4, 0.2, 2.5],
    [-1.1, 0.7, 1],
  ].map(([bx, by, D]) => ({ bx, by, D, xy: V.srcNow(bx, by, D) }));
  V.setP(Pnow);
  return {
    camera: cam,
    incE: V.incE(),
    discM: V.discM(),
    project: points.map((p) => ({ p, xy: V.project(p) })),
    rotFwd: points.map((p) => ({ p, v: V.rotFwd(p, o) })),
    rotInv: points.map((p) => ({ v: p, p: V.rotInv(p, o) })),
    view,
    orient,
    home: { incl: home.incl, az: home.az, w: home.winding, pa: home.pa },
    scenePoint: scene,
    srcNow: src,
  };
});

// incE on its own, including every threshold exactly and the folds
const incE = [];
for (const incl of [
  -370, -190, -90, -10, 0, 69.99, 70, 70.01, 72, 74, 78, 79.99, 80, 80.01, 88, 90, 100, 108, 110,
  180, 200, 270, 359.5, 360, 725,
]) {
  V.setP({ incl });
  incE.push([incl, V.incE()]);
}
const basis = normals.map((n) => ({ n, e: V.basis(n) }));

// one camera per line, so a change shows in a diff
const head = {
  about:
    "Camera vectors computed by v21's own functions (app23.js, cut out by name and evaluated as they are) by tools/camera-vectors.mjs. Checked by tests/unit/camera.test.ts.",
  constants: { CAM: V.CAM, RMIN: 40, RMAX: 240, R_FG: 42, scale: 84 },
  incE,
  basis,
};
writeFileSync(
  OUT,
  `${JSON.stringify(head).slice(0, -1)},\n"cases":[\n${cases.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`,
);
console.log(`${cases.length} cameras → ${OUT}`);
