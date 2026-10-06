/**
 * The lens on the CPU engine (ADR 0008, 0011): the twin of src/render/lens.ts, running the
 * kernels of ./kernels/lens.ts in the order the GPU dispatches them.
 *
 * Model tier (`new CpuLens`): the solvers' grids and bins (rebuilt when the lens changes), each
 * source galaxy sampled and projected by the engine's own stipple (its own scene, its own
 * camera), and the table of marks laid out (src/sim/lens-pack.ts).
 *
 * View tier (`view`): where each source is now (the explicit home and the camera), every mark's
 * images, κ from the fixed-point sum, the slots' counts, the deterministic scan per class, the
 * marks themselves, the quasar, v21's curve matcher and the ribbons of its branches, and the
 * warped drawings' instances through the vector expansion's `post` hook.
 */
import { penWeights, type DrawingsMeta } from '../model/variation';
import type { InkLayer } from '../render/layers';
import type { Instance } from '../marks/instance';
import type { GalaxyScene } from '../model/scene';
import { CURVE_STATE_WORDS, RIBBON_SEG_WORDS, ribUniform } from '../model/ribbons';
import { vectorInputs, runVectors } from './kernels/vector';
import { expandSegment, measureCurves, placePiece, ribbonModel } from './kernels/ribbons';
import { INSTANCE_WORDS } from './kernels/project';
import { wobbleAmplitude } from '../view/warp';
import type { Camera } from '../view/camera';
import { lensView, memberRows, type LensScene, type SolverDesc } from '../sim/lens';
import {
  LENS_BRANCH_SLOTS,
  layoutLens,
  lensRibbonDesc,
  lensVectorView,
  lensVectors,
  type LensLayers,
  type LensLayout,
  type LensVectors,
} from '../sim/lens-pack';
import {
  IMG_WORDS,
  LENS_CLASSES,
  LensCls,
  LMARK_WORDS,
  MARK_NONE,
  QUASAR_SLOTS,
  buildSolver,
  countSlot,
  emitSlot,
  gatherBranches,
  lensMarks,
  lensVecInst,
  newImageSet,
  newQueryOut,
  quasarCount,
  quasarEmit,
  quasarImages,
  queryMark,
  sampleMark,
  trackCurve,
  type ImageSet,
  type LensMarks,
  type LensSrcView,
  type QuasarImage,
  type QueryOut,
  type SolverTier,
} from './kernels/lens';
import { instanceList, vectorLayers } from './stipple';
import { MAX_IMAGES } from '../sim/lens';

const f = Math.fround;

/** What a source galaxy's own stipple gives the lens: its samples' classes and projected instances. */
export interface SourceRun {
  n: number;
  classes: Uint32Array;
  projected: Float32Array;
}

/** What one view of the lens made. */
export interface CpuLensView {
  layers: LensLayers;
  /** instances per class (LENS_CLASSES entries) */
  perClass: number[];
  /** curves' branches kept, and births the cap refused */
  branches: number;
  overflow: number;
  /** the queries, for tests and the agreement report */
  Q: QueryOut;
  quasar: QuasarImage[];
  /** the warped drawings' placed counts */
  vectorCaps: number;
  /** the slots as the scan made them, and the instances (parity tests) */
  slots: { counts: Uint32Array; at: Uint32Array; cls: Uint32Array };
  out: { f: Float32Array; u: Uint32Array };
}

export class CpuLens {
  readonly L: LensScene;
  readonly layout: LensLayout;
  readonly tiers: SolverTier[];
  readonly marks: LensMarks;
  readonly vectors: LensVectors;
  private readonly instStatic: ArrayBuffer;
  private readonly ribbons;
  private readonly model;

  constructor(
    readonly scene: GalaxyScene,
    readonly meta: DrawingsMeta,
    runSource: (s: GalaxyScene, cam: Camera) => SourceRun,
  ) {
    if (!scene.lens) throw new Error('no lens in the scene');
    this.L = scene.lens;
    const L = this.L;
    this.tiers = L.solvers.map(buildSolver);
    const runs = L.sources.map((s) => (s.scene && s.cam ? runSource(s.scene, s.cam) : null));
    this.layout = layoutLens(
      L,
      runs.map((r) => r?.n ?? 0),
      meta,
    );
    const lo = this.layout;
    this.marks = lensMarks(lo.nMarks);
    runs.forEach((r, si) => {
      if (!r) return;
      const s = L.sources[si];
      for (let i = 0; i < r.n; i++)
        sampleMark(
          this.marks,
          (lo.stippleFirst[si] ?? 0) + i,
          r.projected,
          new Uint32Array(r.projected.buffer, r.projected.byteOffset, r.projected.length),
          i,
          r.classes[i] ?? MARK_NONE,
          s?.k ?? 1,
          si,
        );
    });
    this.marks.f.set(lo.tail.f.subarray(0, lo.tail.n * LMARK_WORDS), lo.tailFirst * LMARK_WORDS);
    const lv = lensVectors(lo, meta, scene.P);
    this.vectors = lv.V;
    this.instStatic = lv.inst;
    this.ribbons = lensRibbonDesc(scene.ribbons, lo.maxPts);
    this.model = ribbonModel(this.ribbons, scene.galaxy.pool, scene.galaxy.dotBase);
  }

  /** The solvers' diagnostics: triangles skipped, and the id table against the GPU's capacity. */
  get solverStats() {
    return this.tiers.map((t) => ({ skipped: t.skipped, ids: t.idTotal, G: t.d.G }));
  }

  view(cam: Camera, mTime: number = this.scene.P.mTime): CpuLensView {
    const { L, layout: lo, scene } = this;
    const P = scene.P;
    const lv = lensView(L, cam);
    const seed = scene.galaxy.g.key >>> 0;
    const srcs: LensSrcView[] = L.sources.map((s, i) => ({
      bc: lv.bc[i] as [number, number],
      k: s.k,
      dens: f(s.dens),
      solver: s.solver,
    }));
    // 1. the images of every mark
    const Q = newQueryOut(lo.nMarks, L.sources.length);
    const scratch = newImageSet();
    for (let m = 0; m < lo.nMarks; m++) queryMark(this.tiers, srcs, this.marks, m, Q, scratch);
    // 2. the quasar's images
    let quasar: QuasarImage[] = [];
    if (lo.quasarMark >= 0) {
      const set = imageSetOf(Q, lo.quasarMark);
      const bc = srcs[this.marks.u[lo.quasarMark * LMARK_WORDS + 9] ?? 0]?.bc ?? [0, 0];
      quasar = quasarImages(set, bc, L.solvers[0] as SolverDesc, f((mTime / 2) % 1));
    }
    const wobble = wobbleAmplitude(P.distort);
    const sstars = scene.meta.vectors?.sstars?.kind ?? [];
    const starPool = new Uint32Array(
      sstars.flatMap((k, i) => (k === 'outline' || k === 'burst' ? [i] : [])),
    );
    const qx = {
      seed,
      P: lv,
      penDot: f(penWeights(P.pen).dot),
      wobble,
      noise: scene.galaxy.noise,
      pool: scene.galaxy.pool,
      dotBase: scene.galaxy.dotBase,
      nDotPool: scene.galaxy.g.n_dot_pool,
      starPool,
      spike: f(scene.variation.spike || 0),
      images: quasar,
    };
    // 3. the slots' counts, and their classes
    const nTot = lo.nSlots + lo.nQSlots;
    const counts = new Uint32Array(nTot);
    const cls = new Uint32Array(nTot).fill(MARK_NONE);
    for (let s = 0; s < lo.nSlots; s++) {
      const n = countSlot(seed, srcs, this.marks, Q, s);
      counts[s] = n;
      if (n) cls[s] = this.marks.u[(s >>> 3) * LMARK_WORDS + 8] ?? MARK_NONE;
    }
    for (let q = 0; q < lo.nQSlots; q++) {
      const n = quasarCount(qx, q);
      counts[lo.nSlots + q] = n;
      if (n) cls[lo.nSlots + q] = quasarClass(q);
    }
    // 4. the scan: per class, in slot order, as the GPU's blocks give
    const at = new Uint32Array(nTot);
    const total = new Array<number>(LENS_CLASSES).fill(0);
    for (let s = 0; s < nTot; s++) {
      const c = cls[s] ?? MARK_NONE;
      if (c < LENS_CLASSES) {
        at[s] = total[c] ?? 0;
        total[c] = (total[c] ?? 0) + (counts[s] ?? 0);
      }
    }
    // 5. the marks
    const outBuf = new ArrayBuffer(lo.totalInstances * INSTANCE_WORDS * 4);
    const outF = new Float32Array(outBuf);
    const outU = new Uint32Array(outBuf);
    const plate = { U: lv.U, ca: lv.ca, sa: lv.sa };
    const scratchOut = new Float32Array(INSTANCE_WORDS);
    const scratchU = new Uint32Array(scratchOut.buffer);
    for (let s = 0; s < lo.nSlots; s++) {
      const n = counts[s] ?? 0;
      if (!n) continue;
      const c = cls[s] as number;
      emitSlot(
        seed,
        srcs,
        this.marks,
        Q,
        plate,
        s,
        n,
        outF,
        outU,
        (lo.cbase[c] ?? 0) + (at[s] ?? 0),
        (lo.cbase[c] ?? 0) + (lo.ccap[c] ?? 0),
      );
    }
    for (let q = 0; q < lo.nQSlots; q++) {
      if (!counts[lo.nSlots + q]) continue;
      const c = cls[lo.nSlots + q] as number;
      const where = (lo.cbase[c] ?? 0) + (at[lo.nSlots + q] ?? 0);
      if ((at[lo.nSlots + q] ?? 0) >= (lo.ccap[c] ?? 0)) continue;
      quasarEmit(qx, q, scratchOut, scratchU, 0);
      outF.set(scratchOut, where * INSTANCE_WORDS);
    }
    const perClass = total.map((t, c) => Math.min(t, lo.ccap[c] ?? 0));
    // 6. the curves' branches, and their ribbons
    const branches = lo.curves.map((c, i) =>
      trackCurve(Q, c.firstMark, c.n, lo.curveInF[i * 12 + 3] ?? 0),
    );
    const curveBuf = this.ribbons.curveBuf;
    const R = this.ribbons;
    const cu = new Uint32Array(curveBuf);
    const cf = new Float32Array(curveBuf);
    const points = new Float32Array(Math.max(1, R.nPoints) * 2);
    const kept = gatherBranches(
      lo.curveIn,
      lo.curveInF,
      branches.map((b) => b.branches),
      plate,
      lo.maxPts,
      LENS_BRANCH_SLOTS,
      cu,
      cf,
      points,
    );
    const rib = ribUniform(R, cam, P, scene.galaxy.g.n_dot_pool);
    const arc = new Float32Array(Math.max(1, R.nPoints));
    const st = new ArrayBuffer(Math.max(1, R.nCurves) * CURVE_STATE_WORDS * 4);
    const stateF = new Float32Array(st);
    const stateU = new Uint32Array(st);
    const nPieces = measureCurves(this.model, rib, points, arc, stateF, stateU);
    const sb = new ArrayBuffer(Math.max(1, R.nSegs) * RIBBON_SEG_WORDS * 4);
    const segs = new Float32Array(sb);
    const segsU = new Uint32Array(sb);
    for (let i = 0; i < R.nSegs; i++)
      expandSegment(i, this.model, rib, points, arc, stateF, stateU, segs, segsU);
    const pb = new ArrayBuffer(Math.max(1, nPieces) * INSTANCE_WORDS * 4);
    const pieces = new Float32Array(pb);
    const piecesU = new Uint32Array(pb);
    for (let i = 0; i < nPieces; i++)
      placePiece(i, nPieces, this.model, rib, points, arc, stateF, stateU, pieces, piecesU);
    // 7. the warped drawings
    const members = memberRows(L, cam);
    const vv = lensVectorView(
      this.vectors,
      this.instStatic,
      members,
      P,
      scene.galaxy.g.key,
      scene.galaxy.g.n_dot_pool,
    );
    const instF = new Float32Array(vv.inst);
    const instU = new Uint32Array(vv.inst);
    lensVecInst(instF, instU, lo.lvecs, new Float32Array(lo.lvecs.buffer), lo.nVec, Q, plate);
    const vo = this.vectors.D.nInst
      ? runVectors(
          vectorInputs(
            this.vectors.D.lib,
            vv,
            scene.galaxy.pool,
            scene.galaxy.dotBase,
            scene.galaxy.noise,
          ),
        )
      : null;

    const layers: LensLayers = {
      line: kept
        ? [{ kind: 'ribbons', atlas: 'strokes', segs, segsU, count: R.nSegs, gain: 1 }]
        : [],
      pieces: nPieces
        ? [
            {
              kind: 'sprites',
              atlas: 'pieces',
              gain: 1,
              instances: instanceList(pieces, piecesU, nPieces),
            },
          ]
        : [],
      vectors: vo ? vectorLayers(vo, this.vectors.D.nDots, this.vectors.D.nBlobs) : [],
      dots: [LensCls.old, LensCls.disc, LensCls.young].map((c) =>
        classLayer('dots', outF, outU, lo, c, perClass),
      ),
      knots: [classLayer('knots', outF, outU, lo, LensCls.knot, perClass)],
      stars: [classLayer('stars', outF, outU, lo, LensCls.star, perClass)],
      cores: [classLayer('cores', outF, outU, lo, LensCls.core, perClass)],
    };
    return {
      layers,
      perClass,
      branches: kept,
      overflow: branches.reduce((a, b) => a + b.overflow, 0),
      Q,
      quasar,
      vectorCaps: vo?.nCaps ?? 0,
      slots: { counts, at, cls },
      out: { f: outF, u: outU },
    };
  }
}

/** A mark's images as an image set (the quasar's). */
function imageSetOf(Q: QueryOut, m: number): ImageSet {
  const set = newImageSet();
  const n = Q.imgN[m] ?? 0;
  set.n = n;
  for (let j = 0; j < n; j++) {
    const w = (m * MAX_IMAGES + j) * IMG_WORDS;
    set.p[2 * j] = Q.imgF[w] ?? 0;
    set.p[2 * j + 1] = Q.imgF[w + 1] ?? 0;
    set.mu[j] = Q.imgF[w + 2] ?? 0;
    set.tri[j] = Q.imgU[w + 3] ?? 0;
    for (let c = 0; c < 4; c++) set.J[4 * j + c] = Q.imgF[w + 4 + c] ?? 0;
  }
  return set;
}

/** The class a quasar slot emits into: knots, halo dots (the disc's), the drawn star. */
function quasarClass(q: number): number {
  const k = q % QUASAR_SLOTS;
  if (k < 72) return LensCls.knot;
  if (k < 72 + 2520) return LensCls.disc;
  return LensCls.rstar;
}

function classLayer(
  atlas: 'dots' | 'knots' | 'stars' | 'cores',
  outF: Float32Array,
  outU: Uint32Array,
  lo: LensLayout,
  c: number,
  perClass: readonly number[],
): InkLayer {
  const n = perClass[c] ?? 0;
  const list: Instance[] = new Array<Instance>(n);
  const base = lo.cbase[c] ?? 0;
  for (let j = 0; j < n; j++) {
    const o = (base + j) * INSTANCE_WORDS;
    list[j] = {
      x: outF[o] ?? 0,
      y: outF[o + 1] ?? 0,
      layer: outU[o + 2] ?? 0,
      alpha: outF[o + 3] ?? 0,
      m: [outF[o + 4] ?? 0, outF[o + 5] ?? 0, outF[o + 6] ?? 0, outF[o + 7] ?? 0],
    };
  }
  return { kind: 'sprites', atlas, gain: 1, instances: list };
}
