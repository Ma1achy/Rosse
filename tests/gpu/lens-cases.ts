/**
 * Lens parity (ADR 0004 L1, ADR 0008, 0011, 0014, 0050): the lens tier (compute/lens-grid.wgsl,
 * lens-bin.wgsl) and the view tier (compute/lens-query.wgsl, lens-marks.wgsl) on the GPU against
 * their CPU twins (src/fallback/kernels/lens.ts), on the same scene descriptions.
 *
 * Per case it compares:
 * - the grid (every vertex's source-plane position, within 1e-4) and the bins (every bin's
 *   offset, and the triangle ids in them, which are canonical: sorted ascending);
 * - the images of every mark, index by index: the same count, the same triangle ids in the same
 *   order, positions within 1e-3 lens units and magnifications within 1e-3 relative. Caustic
 *   crossings are the risk: a source point a few ULP from a triangle's edge can sit in a
 *   different bin on the two engines, and its image list then differs. How often is reported
 *   as "image lists that differ";
 * - the instances made per class: the counts within ±0.1% (L1), and the instances slot by slot
 *   where the counts agree: positions within 0.05 plate px;
 * - the quasar's images and brightnesses, the curves' branches kept, and the warped drawings'
 *   capsules.
 * L1 passes when ≥ 99.9% of the image lists agree, every class count is within ±0.1% (or one
 * instance) and ≥ 99.9% of the instances match. On SwiftShader the structure is expected exact.
 */
import { presetParams } from '../../src/core/presets';
import type { Params } from '../../src/core/params';
import { lensHomeOf } from '../../src/core/home';
import { CpuStipple } from '../../src/fallback/stipple';
import { IMG_WORDS, LENS_CLASSES } from '../../src/fallback/kernels/lens';
import { INSTANCE_WORDS } from '../../src/fallback/kernels/project';
import { VECTOR_ATLASES, type VectorLibrary } from '../../src/marks/vector';
import { BuiltAssets } from '../../src/marks/atlas';
import { buildScene, drawingsMeta } from '../../src/model/scene';
import { MAX_IMAGES } from '../../src/sim/lens';
import { SOLVER_WORDS } from '../../src/sim/lens-layouts';
import { GpuStipple } from '../../src/render/stipple';
import { cameraOf } from '../../src/view/camera';
import { adapterName, device, run } from './harness';

const POS_TOL = 0.05;

/** v21's own overrides for the cases the engine cannot yet draw whole (M7's sky, drawn stars). */
const NO_SKY = { starMix: 0, field: 0, fgstars: 0 };

interface Case {
  name: string;
  P: Params;
  /** the home the sources are fixed at */
  home: ReturnType<typeof lensHomeOf>;
}

/** The home and orbit cameras of a preset at some seeds (the orbit is reached from the home). */
export function lensCases(preset: string, seeds: readonly number[]): Case[] {
  return seeds.flatMap((seed) => {
    const P0 = presetParams(preset, seed, NO_SKY);
    const home = lensHomeOf(P0);
    return [
      { name: `${preset} s${String(seed)} home`, P: P0, home },
      {
        name: `${preset} s${String(seed)} orbit`,
        P: { ...P0, az: (P0.az || 0) + 35, incl: Math.min(180, P0.incl + 20) },
        home,
      },
    ];
  });
}

/** Runs the parity test of one preset at some seeds, as a browser test page. */
export function runLensParity(title: string, preset: string, seeds: readonly number[]): void {
  run(title, async () => {
    const { adapter, device: dev } = await device();
    const assets = await BuiltAssets.load('/');
    const names = ['dots', 'knots', 'stars', 'cores', 'strokes'] as const;
    const atlases = await Promise.all(names.map((n) => assets.atlas(n)));
    const [dots, knots, stars, cores, strokes] = atlases;
    if (!dots || !knots || !stars || !cores || !strokes) throw new Error('atlases missing');
    const sheets = await Promise.all(VECTOR_ATLASES.map((n) => assets.vector(n)));
    const vectors = Object.fromEntries(
      VECTOR_ATLASES.map((n, i) => [n, sheets[i]]),
    ) as VectorLibrary;
    const meta = drawingsMeta({ dots, knots, stars, cores, strokes }, vectors.penlines, vectors);
    const gpu = GpuStipple.create(dev);
    const swiftShader = /swiftshader/i.test(adapterName(adapter));
    const lines = [
      `adapter: ${adapterName(adapter)} (${swiftShader ? 'SwiftShader: exact structure expected' : 'L1 tolerances'})`,
    ];
    let pass = true;
    const data: Record<string, unknown> = {};
    let listsTotal = 0;
    let listsDiffer = 0;

    for (const c of lensCases(preset, seeds)) {
      const t0 = performance.now();
      const scene = buildScene(c.P, meta, { lens: { home: c.home } });
      const cam = cameraOf(c.P);
      const cpu = new CpuStipple(scene);
      const cv = cpu.view(cam);
      const cl = cpu.lens;
      const lv = cv.lens;
      if (!cl || !lv) throw new Error('no lens on the CPU');
      gpu.setScene(scene);
      gpu.setView(cam);
      const gl = gpu.lensTier;
      if (!gl) throw new Error('no lens on the GPU');
      const lo = cl.layout;

      // ---- the lens tier
      const gs = await gl.readSolvers();
      let vertWorst = 0;
      let offDiff = 0;
      let idDiff = 0;
      let idTotal = 0;
      cl.tiers.forEach((T, s) => {
        const o = s * SOLVER_WORDS;
        const vbase = gs.solvers[o + 4] ?? 0;
        const obase = gs.solvers[o + 5] ?? 0;
        const ibase = gs.solvers[o + 6] ?? 0;
        const n = T.n * T.n;
        for (let i = 0; i < n * 4; i++)
          vertWorst = Math.max(
            vertWorst,
            Math.abs((gs.verts[vbase * 4 + i] ?? 0) - (T.verts[i] ?? 0)),
          );
        for (let b = 0; b <= T.H * T.H; b++)
          if ((gs.bins[obase + b] ?? 0) !== (T.offsets[b] ?? 0)) offDiff++;
        for (let k = 0; k < T.idTotal; k++)
          if ((gs.bins[ibase + k] ?? 0) !== (T.ids[k] ?? 0)) idDiff++;
        idTotal += T.idTotal;
      });

      // ---- the view tier
      const q = await gl.readQuery();
      const gImgF = new Float32Array(q.imgs);
      const gImgU = new Uint32Array(q.imgs);
      let differ = 0;
      let solved = 0;
      let posWorst = 0;
      let muWorst = 0;
      for (let m = 0; m < lo.nMarks; m++) {
        const cn = lv.Q.imgN[m] ?? 0;
        const gn = q.qmeta[cl.L.sources.length + m] ?? 0;
        if (cn === 0 && gn === 0) continue;
        solved++;
        let same = cn === gn;
        if (same)
          for (let j = 0; j < cn; j++) {
            const cw = (m * MAX_IMAGES + j) * IMG_WORDS;
            if ((gImgU[cw + 3] ?? 0) !== (lv.Q.imgU[cw + 3] ?? 0)) same = false;
            else {
              posWorst = Math.max(
                posWorst,
                Math.hypot(
                  (gImgF[cw] ?? 0) - (lv.Q.imgF[cw] ?? 0),
                  (gImgF[cw + 1] ?? 0) - (lv.Q.imgF[cw + 1] ?? 0),
                ),
              );
              const a = gImgF[cw + 2] ?? 0;
              const b = lv.Q.imgF[cw + 2] ?? 0;
              muWorst = Math.max(muWorst, Math.abs(a - b) / Math.max(1, Math.abs(b)));
            }
          }
        if (!same) differ++;
      }
      listsTotal += solved;
      listsDiffer += differ;

      // ---- what is made of them
      const gCounts = await gl.readCounts();
      const out = new Float32Array(q.out);
      const outU = new Uint32Array(q.out);
      let worstCount = 0;
      let instTotal = 0;
      let instBad = 0;
      let instPosWorst = 0;
      const perClass: string[] = [];
      for (let k = 0; k < LENS_CLASSES; k++) {
        const a = gCounts[k] ?? 0;
        const b = lv.perClass[k] ?? 0;
        perClass.push(`${String(a)}/${String(b)}`);
        worstCount = Math.max(
          worstCount,
          Math.abs(a - b) <= 1 ? 0 : Math.abs(a - b) / Math.max(1, b),
        );
        // the instances, slot by slot: the CPU engine's layers carry them as lists
        const list = cpuClass(lv.layers, k);
        const base = lo.cbase[k] ?? 0;
        for (let j = 0; j < Math.min(a, b); j++) {
          const o = (base + j) * INSTANCE_WORDS;
          const inst = list[j];
          if (!inst) continue;
          instTotal++;
          const d = Math.hypot((out[o] ?? 0) - inst.x, (out[o + 1] ?? 0) - inst.y);
          instPosWorst = Math.max(instPosWorst, d);
          if (d > POS_TOL || (outU[o + 2] ?? 0) !== inst.layer) instBad++;
        }
      }
      const gBranches = countBranches(q.curves);
      const gCaps = await gl.readVectorCaps();
      const cBranches = lv.branches;
      // the quasar
      let quasarDiff = 0;
      const nq = new Uint32Array(q.qimgs.buffer)[32] ?? 0;
      if (nq !== lv.quasar.length) quasarDiff = Math.abs(nq - lv.quasar.length);
      else
        lv.quasar.forEach((im, i) => {
          quasarDiff += Math.abs((q.qimgs[i * 4 + 2] ?? 0) - im.B) > 2e-3 * im.B ? 1 : 0;
        });

      const matchFrac = instTotal ? 1 - instBad / instTotal : 1;
      const listFrac = solved ? 1 - differ / solved : 1;
      const ok =
        listFrac >= 0.999 &&
        worstCount <= 0.001 &&
        matchFrac >= 0.999 &&
        Math.abs(gBranches - cBranches) <= 1 &&
        quasarDiff === 0 &&
        Math.abs(gCaps - lv.vectorCaps) <= Math.max(1, 0.001 * lv.vectorCaps);
      if (!ok) pass = false;
      if (swiftShader && (differ > 0 || instBad > 0)) pass = false;
      lines.push(
        `${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${String(lo.nMarks)} marks, ${String(solved)} solved, ${String(differ)} image lists differ; ` +
          `grid max |Δ| ${vertWorst.toExponential(1)}, bins ${String(offDiff)} offsets and ${String(idDiff)}/${String(idTotal)} ids differ; ` +
          `images max |Δp| ${posWorst.toExponential(1)}, |Δμ| ${muWorst.toExponential(1)}; ` +
          `instances per class (GPU/CPU) ${perClass.join(' ')}, worst count ${(100 * worstCount).toFixed(3)}%, ` +
          `${String(instBad)}/${String(instTotal)} out of tolerance (max ${instPosWorst.toExponential(1)} px); ` +
          `branches ${String(gBranches)}/${String(cBranches)}, drawn capsules ${String(gCaps)}/${String(lv.vectorCaps)}, quasar images ${String(nq)}/${String(lv.quasar.length)} (${String(quasarDiff)} off); ` +
          `${(performance.now() - t0).toFixed(0)} ms`,
      );
      data[c.name] = { differ, solved, instBad, instTotal, worstCount };
    }
    lines.push(
      `image lists that differ: ${String(listsDiffer)} of ${String(listsTotal)} (${((100 * listsDiffer) / Math.max(1, listsTotal)).toFixed(4)}%)`,
    );
    return { pass, lines, data };
  });
}

import type { Instance } from '../../src/marks/instance';
import type { LensLayers } from '../../src/sim/lens-pack';

/** The CPU engine's instances of one lens class, from its layer lists. */
function cpuClass(L: LensLayers, c: number): readonly Instance[] {
  const pick = (l: LensLayers[keyof LensLayers], i: number) => {
    const x = l[i];
    return x && x.kind === 'sprites' ? x.instances : [];
  };
  if (c <= 2) return pick(L.dots, c);
  if (c === 3) return pick(L.knots, 0);
  if (c === 4) return pick(L.stars, 0);
  if (c === 6) return pick(L.cores, 0);
  return [];
}

/** Branches in the ribbons' curve table: curves with points (n > 0, word 1 of 12). */
function countBranches(curves: ArrayBuffer): number {
  const u = new Uint32Array(curves);
  let n = 0;
  for (let k = 0; k < u.length / 12; k++) if ((u[k * 12 + 1] ?? 0) > 0) n++;
  return n;
}
