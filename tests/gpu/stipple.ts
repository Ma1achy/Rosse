/**
 * Stipple parity (ADR 0004 L1, ADR 0011, 0014): the stipple, projection and compaction kernels on
 * the GPU (compute/stipple.wgsl, project.wgsl, scan.wgsl) against their CPU twins
 * (src/fallback/kernels/), on the same scene descriptions.
 *
 * Per case it compares:
 * - samples (model tier), index by index: the same class, and positions within 0.05 plate px;
 * - projected instances (view tier), index by index: the same class after the culls, position
 *   within 0.05 px, size within 0.1%, angle within 1e-3 rad;
 * - per-class counts of the compacted lists: within ±0.1% (L1);
 * - the compacted lists themselves, slot by slot, where the counts agree.
 * L1 passes when ≥ 99.9% of instances match and every class count is within ±0.1%. On SwiftShader,
 * where it was established, the match must also be exact in structure (no class differences, every
 * compacted slot within tolerance); on other adapters only L1 is claimed (ADR 0015).
 */
import { presetParams } from '../../src/core/presets';
import type { Params } from '../../src/core/params';
import { INSTANCE_WORDS, runProject } from '../../src/fallback/kernels/project';
import { ribbonModel, runRibbons } from '../../src/fallback/kernels/ribbons';
import { cullsUniform, ribUniform } from '../../src/model/ribbons';
import { breatheRoom } from '../../src/fallback/kernels/breathe';
import { compact } from '../../src/fallback/kernels/scan';
import { SAMPLE_WORDS, runStipple } from '../../src/fallback/kernels/stipple';
import { BuiltAssets } from '../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { CLASS_COUNT } from '../../src/model/classes';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import { GpuStipple } from '../../src/render/stipple';
import { UNIT_SCALE, cameraOf, perspOf, viewDesc } from '../../src/view/camera';
import { classCapacity } from '../../src/fallback/kernels/scan';
import { adapterName, device, run } from './harness';

const POS_TOL = 0.05;
const SIZE_TOL = 1e-3;
const ANGLE_TOL = 1e-3;

const CASES: [string, Params][] = [
  ...['Smooth, round', 'Cigar-shaped', 'Disc, no arms'].flatMap((n): [string, Params][] =>
    [7, 4242].map((s) => [
      `${n} (stipple) s${String(s)}`,
      presetParams(n, s, { lines: 0, knots: 0, envelope: 0, starMix: 0, field: 0, fgstars: 0 }),
    ]),
  ),
  ...[
    'Grand design',
    'Barred spiral',
    'Flocculent',
    'Ringed',
    'Edge-on with dust',
    'Lens: Einstein ring',
    'Shell galaxy',
    'Dusty spiral',
    'Hand wobble',
    'Tightly wound',
  ].map((n): [string, Params] => [`${n} s7`, presetParams(n, 7)]),
  // the natural bulge (ADR 0076): the Sérsic radius of the bulge, its gamma sampler on both engines
  ...['Grand design', 'Barred spiral', 'Edge-on with dust'].map((n): [string, Params] => [
    `${n} s7, natural bulge`,
    presetParams(n, 7, { bulgeAuto: 1, dustAuto: 1, peanut: 1 }),
  ]),
  // the natural star spread (ADR 0077): the smooth arm weight and the outer taper, drawn stars on
  ...['Grand design', 'Ringed', 'Flocculent'].map((n): [string, Params] => [
    `${n} s7, natural star spread`,
    presetParams(n, 7, { starsAuto: 1, starMix: 1 }),
  ]),
  // the thin disc (ADR 0083): the mixed vertical layer and the shorter bulge tail
  ...['Grand design', 'Barred spiral', 'Smooth, round'].map((n): [string, Params] => [
    `${n} s7, thin disc`,
    presetParams(n, 7, { thinAuto: 1, bulgeAuto: 1 }),
  ]),
  // stellar populations (ADR 0090): clumping, globular clusters, mark character, wider star sizes
  ...['Grand design', 'Barred spiral', 'Smooth, round', 'Edge-on with dust'].map(
    (n): [string, Params] => [
      `${n} s7, stellar populations`,
      presetParams(n, 7, { popAuto: 1, starsAuto: 1, starMix: 1, thinAuto: 1, bulgeAuto: 1 }),
    ],
  ),
  // the galaxy's own perspective (ADR 0084): marks scale by depth, in both projections
  ...['Grand design', 'Barred spiral', 'Edge-on with dust'].map((n): [string, Params] => [
    `${n} s7, perspective`,
    presetParams(n, 7, { depthAuto: 2, incl: 62 }),
  ]),
  ...['Grand design', 'Barred spiral'].map((n): [string, Params] => [
    `${n} s7, marks shrink with distance`,
    presetParams(n, 7, { depthAuto: 1, incl: 62 }),
  ]),
  [
    'every branch: patchy, irregular, flocculent, dusty, ringed, barred',
    presetParams('Grand design', 99, {
      patchy: 0.6,
      irr: 0.5,
      flocc: 0.7,
      dust: 0.5,
      ring: 0.4,
      bar: 0.4,
      arms: 4,
      incl: 70,
      az: 40,
    }),
  ],
];

run('stipple kernels (GPU = CPU, L1)', async () => {
  const { adapter, device: dev } = await device();
  const assets = await BuiltAssets.load('/');
  const [dots, knots, stars, cores, strokes] = await Promise.all(
    (['dots', 'knots', 'stars', 'cores', 'strokes'] as const).map((n) => assets.atlas(n)),
  );
  if (!dots || !knots || !stars || !cores || !strokes) throw new Error('atlases missing');
  // every sheet: the drawn stars (M7) need `sstars`
  const sheets = await Promise.all(VECTOR_ATLASES.map((n) => assets.vector(n)));
  const lib = Object.fromEntries(VECTOR_ATLASES.map((n, i) => [n, sheets[i]])) as VectorLibrary;
  const meta = drawingsMeta({ dots, knots, stars, cores, strokes }, lib.penlines, lib);
  const gpu = GpuStipple.create(dev);
  const swiftShader = /swiftshader/i.test(adapterName(adapter));
  const lines = [
    `adapter: ${adapterName(adapter)} (${swiftShader ? 'SwiftShader: exact structure required' : 'L1 tolerances'})`,
  ];
  let pass = true;
  const data: Record<string, unknown> = {};
  let worstMatch = 1;
  let worstCount = 0;
  let worstPos = 0;

  for (const [name, P] of CASES) {
    const scene = buildScene(P, meta);
    const cam = cameraOf(P);
    gpu.setScene(scene);
    gpu.setView(cam);
    const gS = new Float32Array(await gpu.readSamples());
    const gSu = new Uint32Array(gS.buffer);
    const gP = await gpu.readProjected();
    const gPf = new Float32Array(gP.instances);
    // the galaxy's own marks: the lens's are compared in tests/gpu/lens*.ts
    const gCounts = await gpu.readCounts(false);
    const gOut = await gpu.readInstances();

    const cS = runStipple(scene.galaxy);
    const n = cS.n;
    const V = viewDesc(cam, scene.galaxy.g.dust, n, classCapacity(n), perspOf(scene.P));
    // the dust culls read the line-work's projected points (M4)
    const G = scene.galaxy;
    const rv = runRibbons(
      ribbonModel(scene.ribbons, G.pool, G.dotBase),
      V,
      ribUniform(scene.ribbons, cam, P, G.g.n_dot_pool),
    );
    const cP = runProject(V, cS, {
      c: cullsUniform(scene.ribbons, cam, P, G.g.key),
      points: rv.points,
      carve: scene.ribbons.carve,
      noise: G.noise,
    });
    // the breathing room round bright drawn stars (M7)
    const cleared = G.g.star_mix > 0.01 ? breatheRoom(cP.classes, G.g.n, cP.f32, cS.u32) : 0;
    const cC = compact(cP.classes, n, cP.u32);

    // samples, model tier
    let sClassDiff = 0;
    let sPosBad = 0;
    let sPosMax = 0;
    for (let i = 0; i < n; i++) {
      const o = i * SAMPLE_WORDS;
      if ((gSu[o + 3] ?? 0) !== (cS.u32[o + 3] ?? 0)) {
        sClassDiff++;
        continue;
      }
      const d =
        Math.hypot(
          (gS[o] ?? 0) - (cS.f32[o] ?? 0),
          (gS[o + 1] ?? 0) - (cS.f32[o + 1] ?? 0),
          (gS[o + 2] ?? 0) - (cS.f32[o + 2] ?? 0),
        ) * UNIT_SCALE;
      sPosMax = Math.max(sPosMax, d);
      if (d > POS_TOL) sPosBad++;
    }
    // projected instances, view tier
    let pClassDiff = 0;
    let pBad = 0;
    let pPosMax = 0;
    let kept = 0;
    for (let i = 0; i < n; i++) {
      const gc = gP.classes[i] ?? 255;
      const cc = cP.classes[i] ?? 255;
      if (gc !== cc) {
        pClassDiff++;
        continue;
      }
      if (gc >= CLASS_COUNT) continue;
      kept++;
      const o = i * INSTANCE_WORDS;
      const g = (k: number) => gPf[o + k] ?? 0;
      const c = (k: number) => cP.f32[o + k] ?? 0;
      const dpos = Math.hypot(g(0) - c(0), g(1) - c(1));
      const gs = Math.hypot(g(4), g(5));
      const cs = Math.hypot(c(4), c(5));
      const dsize = cs > 0 ? Math.abs(gs - cs) / cs : 0;
      const dang = Math.abs(
        Math.atan2(
          Math.sin(Math.atan2(g(5), g(4)) - Math.atan2(c(5), c(4))),
          Math.cos(Math.atan2(g(5), g(4)) - Math.atan2(c(5), c(4))),
        ),
      );
      pPosMax = Math.max(pPosMax, dpos);
      if (dpos > POS_TOL || dsize > SIZE_TOL || dang > ANGLE_TOL) pBad++;
    }
    const match = kept ? (kept - pBad) / (kept + pClassDiff) : 1;
    // counts and compacted lists
    let countWorst = 0;
    let slotsBad = 0;
    let slots = 0;
    const gOutF = new Float32Array(gOut.out);
    const cOutF = new Float32Array(cC.out.buffer);
    for (let c = 0; c < CLASS_COUNT; c++) {
      const gk = gCounts.perClass[c] ?? 0;
      const ck = cC.counts[c] ?? 0;
      const rel = ck ? Math.abs(gk - ck) / ck : gk ? 1 : 0;
      countWorst = Math.max(countWorst, rel);
      if (gk !== ck) continue;
      for (let j = 0; j < ck; j++) {
        const og = (c * gOut.cap + j) * INSTANCE_WORDS;
        const oc = (c * cC.cap + j) * INSTANCE_WORDS;
        slots++;
        const d = Math.hypot(
          (gOutF[og] ?? 0) - (cOutF[oc] ?? 0),
          (gOutF[og + 1] ?? 0) - (cOutF[oc + 1] ?? 0),
        );
        if (d > POS_TOL) slotsBad++;
      }
    }
    // On SwiftShader, where it was established, the match is exact in structure: no class
    // differences and every compacted slot within tolerance. Elsewhere (FMA contraction, other
    // log, exp, pow and sqrt) only L1 is claimed: ≥ 99.9% of instances, counts within 0.1%.
    const l1 = match >= 0.999 && countWorst <= 0.001;
    // a globular cluster's stars are placed with Gaussian draws, which the GPU computes within a
    // tolerance (ADR 0004), so one sample in some thousands may land on the other side of a cull
    const allow = name.includes('stellar populations') ? 3 : 0;
    const ok = swiftShader
      ? l1 && sClassDiff <= allow && pClassDiff <= allow && slotsBad === 0
      : l1;
    if (!ok) pass = false;
    worstMatch = Math.min(worstMatch, match);
    worstCount = Math.max(worstCount, countWorst);
    worstPos = Math.max(worstPos, pPosMax);
    lines.push(
      `${ok ? 'ok  ' : 'FAIL'} ${name}: n ${String(n)}; ${String(cleared)} cleared by the breathing room; samples: ${String(sClassDiff)} class differences, max |Δp| ${sPosMax.toExponential(2)} px; ` +
        `instances: ${String(pClassDiff)} class differences, ${(100 * match).toFixed(3)}% within tolerance, max |Δp| ${pPosMax.toExponential(2)} px; ` +
        `counts GPU [${Array.from(gCounts.perClass).join(', ')}] CPU [${Array.from(cC.counts).join(', ')}] (worst ${(100 * countWorst).toFixed(3)}%); ` +
        `compacted slots ${String(slots - slotsBad)}/${String(slots)} match`,
    );
    data[name] = {
      n,
      sampleClassDiff: sClassDiff,
      samplePosMax: sPosMax,
      samplePosOver: sPosBad,
      instanceClassDiff: pClassDiff,
      instanceMatch: match,
      instancePosMax: pPosMax,
      countsGpu: Array.from(gCounts.perClass),
      countsCpu: Array.from(cC.counts),
      countWorst,
      slots,
      slotsBad,
    };
  }
  lines.push(
    `worst: ${(100 * worstMatch).toFixed(3)}% instances within tolerance (≥ 99.9%), count difference ${(100 * worstCount).toFixed(3)}% (≤ 0.1%), max |Δp| ${worstPos.toExponential(2)} px`,
  );
  gpu.destroy();
  return { pass, lines, data: { cases: data, worstMatch, worstCount, worstPos } };
});
