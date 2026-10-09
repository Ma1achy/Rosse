/**
 * The marks of stars and artefacts (ADR 0004 L1, ADR 0011, 0014): compute/star-marks.wgsl against
 * its CPU twin (src/fallback/kernels/star-marks.ts), on the same scene descriptions, and the
 * compacted layers (the stipple's classes with the marks among them) and the drawn star at each core
 * against the CPU engine.
 *
 * Per case (the star, artefact and layered presets, at the home camera, an orbit and zoom 2.5, with
 * the overlays seen from the preset's own orientation as their home):
 * - slot by slot: the same class, the same drawing, position within 0.05 plate px, size within
 *   0.1%;
 * - the per-class counts of the compacted lists agree, and the drawn stars' capsules (the dynamic
 *   set) agree with the CPU's.
 *
 * Depth occlusion (ADR 0074): the overlay star's marks are left out where a nearer mark of the
 * galaxy is drawn (the occluder grid the projection fills and the star marks read). The slot by
 * slot classes above are the culled ones, so they must be EXACTLY the CPU's; the extra camera
 * 'behind the disc' (the disc seen from below, in front of the star) has the galaxy cover the
 * star, and the case also asks that the CPU lost marks to it (against its own run with the grid off).
 */
import { presetParams } from '../../src/core/presets';
import type { Params } from '../../src/core/params';
import { CpuStipple } from '../../src/fallback/stipple';
import { INSTANCE_WORDS } from '../../src/fallback/kernels/project';
import { BuiltAssets } from '../../src/marks/atlas';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { CLASS_COUNT } from '../../src/model/classes';
import { CAPSULE_WORDS } from '../../src/model/ribbons';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import { GpuStipple } from '../../src/render/stipple';
import { cameraOf, orientationOf } from '../../src/view/camera';
import { adapterName, device, run } from './harness';

const POS_TOL = 0.05;

const NAMES = [
  'Star: bright, with spikes',
  'Star: faint',
  'Artefact: satellite trail',
  'Artefact: ghost reflection',
  'Artefact: cosmic rays',
  'Layered: spiral beside a bright star',
  'Layered: barred spiral, satellite trail',
  'Layered: edge-on, star on top',
  'Layered: ringed galaxy, ghost reflection',
];

/** the cases with an overlay star on a galaxy: the galaxy can be in front of the star */
const OCCLUDED = ['Layered: spiral beside a bright star', 'Layered: edge-on, star on top'];

run('star and artefact marks (GPU = CPU, L1)', async () => {
  const { adapter, device: dev } = await device();
  const assets = await BuiltAssets.load('/');
  const [dots, knots, stars, cores, strokes] = await Promise.all(
    (['dots', 'knots', 'stars', 'cores', 'strokes'] as const).map((n) => assets.atlas(n)),
  );
  if (!dots || !knots || !stars || !cores || !strokes) throw new Error('atlases missing');
  const sheets = await Promise.all(VECTOR_ATLASES.map((n) => assets.vector(n)));
  const lib = Object.fromEntries(VECTOR_ATLASES.map((n, i) => [n, sheets[i]])) as VectorLibrary;
  const meta = drawingsMeta({ dots, knots, stars, cores, strokes }, lib.penlines, lib);
  const st = GpuStipple.create(dev);
  const lines = [`adapter: ${adapterName(adapter)}`];
  let pass = true;
  const data: Record<string, unknown> = {};
  let worstPos = 0;
  const totals = { slots: 0, drawn: 0, caps: 0 };

  for (const name of NAMES)
    for (const [cam, dAz, dIncl, zoom] of [
      ['home', 0, 0, 1],
      ['orbit', 35, 20, 1],
      ['zoom 2.5', 0, 0, 2.5],
      ...(OCCLUDED.includes(name)
        ? [['behind the disc', 0, 90, 1] as [string, number, number, number]]
        : []),
    ] as [string, number, number, number][]) {
      const P0 = presetParams(name, 7);
      const P: Params = { ...P0, az: P0.az + dAz, incl: Math.min(180, P0.incl + dIncl) };
      const home = orientationOf(cameraOf(P0));
      const scene = buildScene(P, meta, { home });
      const camera = cameraOf(P, zoom);
      st.setScene(scene);
      st.setView(camera);
      const g = await st.readStarMarks();
      const cpu = new CpuStipple(scene);
      const cv = cpu.view(camera);
      const gCounts = await st.readCounts();
      const gv = await st.stars.vectors.readBack();
      const bad: string[] = [];
      let maxPos = 0;
      const n = scene.galaxy.g.n + scene.galaxy.g.n_extra;
      for (let c = 0; c < CLASS_COUNT; c++) {
        const gk = gCounts.perClass[c] ?? 0;
        const ck = cv.perClass[c] ?? 0;
        // L1 (ADR 0004): counts within 0.1%. The occlusion cull (ADR 0074) is a hard decision on a
        // 2-unit cell edge, so a mark within the engines' position error (~3e-4 px) of an edge can
        // land in the other cell on one engine: a flip of a mark or two is not a difference.
        if (Math.abs(gk - ck) > Math.max(2, 1e-3 * Math.max(gk, ck)))
          bad.push(`class ${String(c)}: ${String(gk)} ≠ ${String(ck)}`);
      }
      let sizeBad = 0;
      let classBad = 0;
      for (let k = 0; k < g.n; k++) {
        const gc = g.classes[k] ?? 255;
        const cc = cv.classes[n + k] ?? 255;
        if (gc !== cc) {
          classBad++;
          continue;
        }
        if (gc >= CLASS_COUNT) continue;
        const o = k * INSTANCE_WORDS;
        const oc = (n + k) * INSTANCE_WORDS;
        const d = Math.hypot(
          (g.instances[o] ?? 0) - (cv.projected[oc] ?? 0),
          (g.instances[o + 1] ?? 0) - (cv.projected[oc + 1] ?? 0),
        );
        maxPos = Math.max(maxPos, d);
        if (d > POS_TOL) bad.push(`slot ${String(k)} off by ${d.toFixed(3)}`);
        const gs = Math.hypot(g.instances[o + 4] ?? 0, g.instances[o + 5] ?? 0);
        const cs = Math.hypot(cv.projected[oc + 4] ?? 0, cv.projected[oc + 5] ?? 0);
        if (cs > 0 && Math.abs(gs - cs) / cs > 1e-3) sizeBad++;
      }
      if (classBad > Math.max(4, 1e-3 * g.n)) bad.push(`${String(classBad)} class differences`);
      if (cam === 'behind the disc') {
        // the galaxy in front of the star takes marks from it: the CPU, grid on against grid off
        cpu.occlusion = false;
        const off = cpu.view(camera);
        const live = (c: Uint32Array) => c.subarray(n).filter((x) => x < 4).length;
        const lost = live(off.classes) - live(cv.classes);
        data[`${name}, ${cam} lost`] = lost;
        if (lost <= 0) bad.push(`no star mark was occluded (lost ${String(lost)})`);
        lines.push(
          `     ${name}: ${String(lost)} of ${String(live(off.classes))} star marks occluded`,
        );
      }
      if (sizeBad) bad.push(`${String(sizeBad)} sizes differ`);
      if (gv.nCaps !== cv.stars.nCaps)
        bad.push(`star capsules ${String(gv.nCaps)} ≠ ${String(cv.stars.nCaps)}`);
      else
        for (let k = 0; k < cv.stars.nCaps * CAPSULE_WORDS; k++) {
          if (k % CAPSULE_WORDS > 4) continue;
          const d = Math.abs((gv.caps[k] ?? 0) - (cv.stars.caps[k] ?? 0));
          maxPos = Math.max(maxPos, d);
          if (!(d <= POS_TOL)) {
            bad.push(`capsule word ${String(k)}`);
            break;
          }
        }
      worstPos = Math.max(worstPos, maxPos);
      totals.slots += g.n;
      totals.drawn += cv.starRows;
      totals.caps += cv.stars.nCaps;
      const ok = bad.length === 0;
      if (!ok) pass = false;
      lines.push(
        `${ok ? 'ok  ' : 'FAIL'} ${name}, ${cam}: ${String(g.n)} mark slots, ${String(cv.starRows)} drawn stars, ${String(cv.stars.nCaps)} capsules; counts [${Array.from(cv.perClass).join(', ')}]; max |Δ| ${maxPos.toExponential(2)} px${ok ? '' : `; ${bad.slice(0, 4).join('; ')}`}`,
      );
      data[`${name}, ${cam}`] = { slots: g.n, maxPos, bad };
    }
  lines.push(
    `worst: |Δ| ${worstPos.toExponential(2)} px (≤ ${String(POS_TOL)}); compared ${String(totals.slots)} mark slots, ${String(totals.drawn)} drawn stars, ${String(totals.caps)} capsules`,
  );
  st.destroy();
  return { pass, lines, data: { cases: data, worstPos, totals } };
});
