/**
 * The galaxy on the CPU engine (ADR 0011): the model tier (./kernels/stipple.ts, cached until a
 * model parameter changes) and the view tier (./kernels/ribbons.ts for the line-work, whose
 * projected points the dust culls of ./kernels/project.ts read, then ./kernels/scan.ts), the twins
 * of what src/render/stipple.ts dispatches on the GPU, giving the same per-class instance lists and
 * the same ribbon, capsule and piece buffers, in the same order.
 *
 * The placed vector drawings (M5) are ./kernels/vector.ts, the twin of src/render/vectors.ts.
 *
 * Layer order follows the reference's `scene()` (app23.js:L1289–1301): stroke ribbons (line ink),
 * the hatching's and the placed parts' lines, dots and blobs (line ink), pieces (young ink), the
 * stipple by population, the streams' dots and knots (old), knots, sparkle stars, and the core
 * with the nuclear spiral.
 */
import type { Instance } from '../marks/instance';
import type { InkLayer } from '../render/layers';
import { CAPSULE_WORDS, cullsUniform, ribUniform } from '../model/ribbons';
import { ribbonModel, runRibbons, type RibbonModel, type RibbonView } from './kernels/ribbons';
import { coreInstances } from '../model/parts';
import {
  STIPPLE_LAYERS,
  buildScene,
  markCounts,
  type GalaxyScene,
  type MarkCounts,
  type SceneOptions,
} from '../model/scene';
import type { Params } from '../core/params';
import type { DrawingsMeta } from '../model/variation';
import { TierState, type TierWork } from '../render/tiers';
import { cameraOf, viewDesc, type Camera } from '../view/camera';
import { INSTANCE_WORDS, runProject } from './kernels/project';
import { breatheRoom } from './kernels/breathe';
import { dynView, rstarRows } from '../model/dynvec';
import { packStarJobs, starJobs } from '../model/stars';
import { runStarMarks } from './kernels/star-marks';
import { wobbleAmplitude } from '../view/warp';
import { runSky, skyInputs, type SkyOut } from './kernels/sky';
import type { PackedVectors } from '../marks/vector';
import { Cls } from '../model/classes';
import { classCapacity, compact } from './kernels/scan';
import { runStipple } from './kernels/stipple';
import { runVectors, vectorInputs, type VectorOut } from './kernels/vector';
import { warpCaps, warpInstances, warpRibbons, type TideData } from './kernels/tide';
import { hatchRows, vectorView, type VectorView } from '../model/vectors';
import { usedDrawings } from '../model/used';
import { CpuLens, type CpuLensView } from './lens';

export interface CpuStippleView {
  layers: InkLayer[];
  counts: MarkCounts;
  /** per-class counts, CLASS_COUNT entries */
  perClass: Uint32Array;
  /** per sample: class after the view culls, and the projected instance (debugging, parity) */
  classes: Uint32Array;
  projected: Float32Array;
  /** the line-work's view tier */
  ribbons: RibbonView;
  /** the placed vector drawings' view tier (M5) */
  vectors: VectorOut;
  vectorView: VectorView;
  /** the drawn stars (M7): their capsules, dots and blobs, and the rows they are expanded from */
  stars: VectorOut;
  starRows: number;
  /** proposals the breathing room cleared (M7) */
  cleared: number;
  /** the deep field and the foreground stars (M7): null without a sky */
  sky: SkyOut | null;
  /** the galaxies' drawings of the deep field, expanded */
  skyDrawings: VectorOut | null;
  /** the sky's layers alone: the background, then the foreground stars */
  skyLayers: InkLayer[];
  /** the lens's view tier (M9), when the scene is lensed */
  lens?: CpuLensView;
}

/** Instances from a buffer of INSTANCE_WORDS words each. */
export function instanceList(fl: Float32Array, u: Uint32Array, count: number): Instance[] {
  const res = new Array<Instance>(count);
  for (let j = 0; j < count; j++) {
    const o = j * INSTANCE_WORDS;
    res[j] = {
      x: fl[o] ?? 0,
      y: fl[o + 1] ?? 0,
      layer: u[o + 2] ?? 0,
      alpha: fl[o + 3] ?? 0,
      m: [fl[o + 4] ?? 0, fl[o + 5] ?? 0, fl[o + 6] ?? 0, fl[o + 7] ?? 0],
    };
  }
  return res;
}

/** The line-work's layers, in the reference's order: ribbons, hatching, pieces. */
export function lineLayers(rv: RibbonView, M: RibbonModel): InkLayer[] {
  const R = M.R;
  const out: InkLayer[] = [];
  if (R.nSegs)
    out.push({
      kind: 'ribbons',
      atlas: 'strokes',
      segs: rv.segs,
      segsU: rv.segsU,
      count: R.nSegs,
      gain: 1,
    });
  if (R.nCaps) out.push({ kind: 'capsules', caps: rv.caps, count: R.nCaps, gain: 1 });
  if (R.nHDots)
    out.push({
      kind: 'sprites',
      atlas: 'dots',
      gain: 1,
      instances: instanceList(rv.hdots, rv.hdotsU, R.nHDots),
    });
  if (R.nHBlobs)
    out.push({
      kind: 'sprites',
      atlas: 'knots',
      gain: 1,
      instances: instanceList(rv.hblobs, rv.hblobsU, R.nHBlobs),
    });
  if (rv.nPieces)
    out.push({
      kind: 'sprites',
      atlas: 'pieces',
      gain: 1,
      pop: 'young',
      instances: instanceList(rv.pieces, rv.piecesU, rv.nPieces),
    });
  return out;
}

/** The sheet and tile of each of the deep field's rows (for the used-drawings count). */
function skyDrawingRows(sky: SkyOut, lib: PackedVectors): { atlas: string; tile: number }[] {
  const order = Object.entries(lib.first).sort((a, b) => a[1] - b[1]);
  const u = new Uint32Array(sky.rows);
  return Array.from({ length: sky.nRows }, (_, k) => {
    const d = u[k * 24 + 16] ?? 0;
    let at = order[0] ?? ['arms', 0];
    for (const e of order) if (e[1] <= d) at = e;
    return { atlas: at[0], tile: d - at[1] };
  });
}

/** The placed drawings' layers (line ink): capsules, dots, blobs. */
export function vectorLayers(vo: VectorOut, nDots: number, nBlobs: number): InkLayer[] {
  const out: InkLayer[] = [];
  if (vo.nCaps) out.push({ kind: 'capsules', caps: vo.caps, count: vo.nCaps, gain: 1 });
  if (nDots)
    out.push({
      kind: 'sprites',
      atlas: 'dots',
      gain: 1,
      instances: instanceList(vo.dots, vo.dotsU, nDots),
    });
  if (nBlobs)
    out.push({
      kind: 'sprites',
      atlas: 'knots',
      gain: 1,
      instances: instanceList(vo.blobs, vo.blobsU, nBlobs),
    });
  return out;
}

/** The streams' dots and knots (old ink). */
export function streamLayers(vo: VectorOut): InkLayer[] {
  return [
    {
      kind: 'sprites',
      atlas: 'dots',
      gain: 1,
      pop: 'old',
      instances: instanceList(vo.sdots, vo.sdotsU, vo.nSdots),
    },
    {
      kind: 'sprites',
      atlas: 'knots',
      gain: 1,
      pop: 'old',
      instances: instanceList(vo.sknots, vo.sknotsU, vo.nSknots),
    },
  ];
}

/** A merging galaxy's tides (M8): the tidal map, which galaxy this is, and R2 for this view. */
export interface CpuTide {
  data: TideData;
  g: 0 | 1;
  /** the plate px the map's grid spans (2 · 4.2 · s0, app23.js:L1243) */
  r2: number;
}

export class CpuStipple {
  readonly samples: ReturnType<typeof runStipple>;
  readonly lines: RibbonModel;
  /** the lens (M9): its sources are galaxies of their own, sampled and projected like this one */
  readonly lens: CpuLens | null;

  constructor(
    readonly scene: GalaxyScene,
    /** set (and `r2` updated) for a merging galaxy: its marks are carried by the tides after each kernel */
    public tide: CpuTide | null = null,
  ) {
    this.samples = runStipple(scene.galaxy);
    this.lines = ribbonModel(scene.ribbons, scene.galaxy.pool, scene.galaxy.dotBase);
    this.lens = scene.lens
      ? new CpuLens(scene, scene.meta, (s, cam) => {
          const src = new CpuStipple(s);
          const v = src.view(cam);
          return { n: src.samples.n, classes: v.classes, projected: v.projected };
        })
      : null;
  }

  view(cam: Camera, mTime?: number): CpuStippleView {
    const n = this.samples.n;
    const { P, galaxy, ribbons: R } = this.scene;
    // the marks of a star or an artefact follow the stipple's samples (M7)
    const sj = this.scene.stars ? starJobs(this.scene.stars, P, cam, this.scene.home) : null;
    const nStar = sj?.nSlots ?? 0;
    const nTot = n + nStar;
    const V = viewDesc(cam, galaxy.g.dust, n, classCapacity(nTot));
    const rv = runRibbons(this.lines, V, ribUniform(R, cam, P, galaxy.g.n_dot_pool));
    const culls = {
      c: cullsUniform(R, cam, P, galaxy.g.key),
      points: rv.points,
      carve: R.carve,
      noise: galaxy.noise,
    };
    const p = runProject(V, this.samples, culls, nStar);
    if (sj && nStar) {
      const jb = packStarJobs(sj.jobs);
      runStarMarks(
        {
          jobsF: new Float32Array(jb),
          jobsU: new Uint32Array(jb),
          u: {
            n_jobs: sj.jobs.length,
            n_slots: nStar,
            key: galaxy.g.key,
            n_dot_pool: galaxy.g.n_dot_pool,
            pen_dot: galaxy.g.pen_dot,
            wobble: wobbleAmplitude(P.distort),
            out_base: n,
          },
          pool: galaxy.pool,
          dotBase: galaxy.dotBase,
          noise: galaxy.noise,
        },
        p.classes,
        p.f32,
        p.u32,
      );
    }
    // the breathing room round bright drawn stars: a pure view filter (app23.js:L275–281)
    const cleared =
      galaxy.g.star_mix > 0.01 ? breatheRoom(p.classes, galaxy.g.n, p.f32, this.samples.u32) : 0;
    const T = this.tide;
    if (T) {
      // carried by the tides: the stipple's marks before the compaction, the line-work's outputs
      warpInstances(T.data, T.g, T.r2, p.f32, n);
      warpRibbons(T.data, T.g, T.r2, rv.segs, R.nSegs);
      warpInstances(T.data, T.g, T.r2, rv.pieces, rv.nPieces);
      warpCaps(T.data, T.g, T.r2, rv.caps, R.nCaps);
      warpInstances(T.data, T.g, T.r2, rv.hdots, R.nHDots);
      warpInstances(T.data, T.g, T.r2, rv.hblobs, R.nHBlobs);
    }
    const { out, counts, cap } = compact(p.classes, nTot, p.u32);
    const outF = new Float32Array(out.buffer);
    const list = (cls: number): Instance[] => {
      const k = counts[cls] ?? 0;
      const res: Instance[] = new Array<Instance>(k);
      for (let j = 0; j < k; j++) {
        const o = (cls * cap + j) * INSTANCE_WORDS;
        res[j] = {
          x: outF[o] ?? 0,
          y: outF[o + 1] ?? 0,
          layer: out[o + 2] ?? 0,
          alpha: outF[o + 3] ?? 0,
          m: [outF[o + 4] ?? 0, outF[o + 5] ?? 0, outF[o + 6] ?? 0, outF[o + 7] ?? 0],
        };
      }
      return res;
    };
    const { variation, meta, vectors: VD } = this.scene;
    const vv = vectorView(
      VD,
      P,
      variation,
      meta,
      cam,
      galaxy.g.key,
      galaxy.g.n_dot_pool,
      T?.r2 ?? 0,
      T ? hatchRows(R, cam) : [],
    );
    const vo = runVectors(
      vectorInputs(VD.lib, vv, galaxy.pool, galaxy.dotBase, galaxy.noise, T?.data),
    );
    // the drawn stars, one `sstars` drawing per compacted `rstar` (M7)
    const spec = this.scene.rstars;
    const nStars = counts[Cls.rstar] ?? 0;
    const liveStars = Math.min(nStars, spec.rows);
    const starIn = rstarRows(
      outF,
      out,
      Cls.rstar * cap,
      nStars,
      VD.lib.first.sstars,
      spec,
      liveStars,
    );
    const starDV = dynView(P, spec, starIn, liveStars, galaxy.g.key, galaxy.g.n_dot_pool);
    const so = runVectors(vectorInputs(VD.lib, starDV, galaxy.pool, galaxy.dotBase, galaxy.noise));
    // the deep field, the foreground stars (M7): the galaxies' dots, their drawings (a dynamic set)
    const sky = this.scene.sky;
    let skyOut: SkyOut | null = null;
    let skyVec: VectorOut | null = null;
    const bgLayers: InkLayer[] = [];
    const fgLayers: InkLayer[] = [];
    if (sky) {
      skyOut = runSky(
        skyInputs(
          sky,
          {
            V,
            key: galaxy.g.key,
            wobble: wobbleAmplitude(P.distort),
            nDotPool: galaxy.g.n_dot_pool,
            massive: sky.massive,
          },
          galaxy.pool,
          galaxy.dotBase,
          galaxy.noise,
        ),
      );
      const sv = dynView(P, sky.spec, skyOut.rows, skyOut.nRows, galaxy.g.key, galaxy.g.n_dot_pool);
      skyVec = runVectors(vectorInputs(VD.lib, sv, galaxy.pool, galaxy.dotBase, galaxy.noise));
      if (skyOut.nDots)
        bgLayers.push({
          kind: 'sprites',
          atlas: 'dots',
          gain: 1,
          svgLayer: 'background',
          instances: instanceList(skyOut.dots, skyOut.dotsU, skyOut.nDots),
        });
      bgLayers.push(
        ...vectorLayers(
          skyVec,
          skyOut.nRows * sky.spec.strideDots,
          skyOut.nRows * sky.spec.strideBlobs,
        ).map((l): InkLayer => ({ ...l, svgLayer: 'background' })),
      );
      if (skyOut.nFg)
        fgLayers.push({
          kind: 'sprites',
          atlas: 'fgstars',
          gain: 1,
          svgLayer: 'background',
          instances: instanceList(skyOut.fg, skyOut.fgU, skyOut.nFg),
        });
    }
    const line = lineLayers(rv, this.lines);
    const pieces = line.filter((l) => l.kind === 'sprites' && l.atlas === 'pieces');
    const stipple = STIPPLE_LAYERS.map((l): InkLayer => ({
      kind: 'sprites',
      atlas: l.atlas,
      gain: 1,
      pop: l.pop,
      instances: list(l.cls),
    }));
    const streams = VD.parts.streams.length ? streamLayers(vo) : [];
    const lens = this.lens?.view(cam, mTime);
    const LL = lens?.layers;
    // the hatching's and the placed drawings' pen-line quads are one layer, one union per
    // sample, as on the GPU (ADR 0019)
    const placed = vectorLayers(vo, VD.nDots, VD.nBlobs);
    const hatch = line.find((l) => l.kind === 'capsules');
    const parts = placed.find((l) => l.kind === 'capsules');
    const merged: InkLayer[] = [];
    if (hatch?.kind === 'capsules' && parts?.kind === 'capsules') {
      const caps = new Float32Array((hatch.count + parts.count) * CAPSULE_WORDS);
      caps.set(hatch.caps.subarray(0, hatch.count * CAPSULE_WORDS));
      caps.set(parts.caps.subarray(0, parts.count * CAPSULE_WORDS), hatch.count * CAPSULE_WORDS);
      merged.push({ kind: 'capsules', caps, count: hatch.count + parts.count, gain: 1 });
    } else if (hatch ?? parts) merged.push((hatch ?? parts) as InkLayer);
    const layers: InkLayer[] = [
      ...bgLayers,
      ...line.filter((l) => !pieces.includes(l) && l !== hatch),
      ...merged,
      ...(LL?.line ?? []),
      ...placed.filter((l) => l !== parts),
      ...vectorLayers(so, liveStars * spec.strideDots, liveStars * spec.strideBlobs),
      ...(LL?.vectors ?? []),
      ...pieces,
      ...(LL?.pieces ?? []),
      ...stipple.slice(0, 3),
      ...(LL?.dots ?? []),
      ...streams,
      ...stipple.slice(3, 4),
      ...(LL?.knots ?? []),
      ...stipple.slice(4),
      ...(LL?.stars ?? []),
    ];
    const cores = coreInstances(P, meta, cam, galaxy.noise, VD.parts.picks.nuclear);
    if (T)
      for (const c of cores) {
        const q = T.data.post(T.g, c.x, c.y, T.r2);
        c.x = q[0];
        c.y = q[1];
      }
    if (cores.length)
      layers.push({ kind: 'sprites', atlas: 'cores', gain: 1, pop: 'old', instances: cores });
    layers.push(...(LL?.cores ?? []));
    layers.push(...fgLayers);
    const tiles = (l: InkLayer[], atlas: string) =>
      l.flatMap((x) =>
        x.kind === 'sprites' && x.atlas === atlas ? x.instances.map((i) => i.layer) : [],
      );
    const used = usedDrawings(meta, {
      dots: [
        ...tiles(stipple, 'dots'),
        ...tiles(streams, 'dots'),
        ...vo.dotsU
          .subarray(0, VD.nDots * INSTANCE_WORDS)
          .filter((_, k) => k % INSTANCE_WORDS === 2),
        ...rv.hdotsU
          .subarray(0, R.nHDots * INSTANCE_WORDS)
          .filter((_, k) => k % INSTANCE_WORDS === 2),
        ...(skyOut
          ? Array.from(
              { length: skyOut.nDots },
              (_, j) => skyOut.dotsU[j * INSTANCE_WORDS + 2] ?? 0,
            )
          : []),
      ],
      knots: [...tiles(stipple, 'knots'), ...tiles(streams, 'knots')],
      stars: tiles(stipple, 'stars'),
      cores,
      strokes: R.curves.map((c) => c.k),
      rows: vv.rows,
      extra: [
        // the drawn stars (L190) and the deep field's galaxies (L905)
        ...Array.from({ length: counts[Cls.rstar] ?? 0 }, (_, j) => ({
          atlas: 'sstars',
          tile: out[(Cls.rstar * cap + j) * INSTANCE_WORDS + 2] ?? 0,
        })),
        ...(skyOut ? skyDrawingRows(skyOut, VD.lib) : []),
      ],
      fgstars: skyOut
        ? Array.from({ length: skyOut.nFg }, (_, j) => skyOut.fgU[j * INSTANCE_WORDS + 2] ?? 0)
        : [],
      penlines: [
        ...R.lanes.hatches.map((h) => h.tile),
        ...VD.parts.picks.streams.map((s) => s.tile),
      ],
    });
    const lc = lens?.perClass ?? [];
    const withLens = Array.from(counts, (n, c) => n + (lc[c] ?? 0));
    return {
      layers,
      ...(lens ? { lens } : {}),
      counts: {
        ...markCounts(withLens),
        curves: R.nCurves,
        pieces: rv.nPieces,
        ribbonSegments: R.nSegs,
        hatches: R.nHatch,
        drawings: VD.nInst,
        vectorCaps: vo.nCaps,
        vectorDots: VD.nDots,
        vectorBlobs: VD.nBlobs,
        streamDots: vo.nSdots,
        streamKnots: vo.nSknots,
        starCaps: so.nCaps,
        used,
      },
      perClass: counts,
      classes: p.classes,
      projected: p.f32,
      ribbons: rv,
      vectors: vo,
      vectorView: vv,
      stars: so,
      starRows: liveStars,
      cleared,
      sky: skyOut,
      skyDrawings: skyVec,
      skyLayers: [...bgLayers, ...fgLayers],
    };
  }
}

/**
 * The CPU engine's stipple by tier (src/render/tiers.ts), the twin of `GpuStipple.frame`: the
 * model tier (`CpuStipple`, the samples) is kept until a model parameter changes or the structure
 * signature changes (`structureKey`, ADR 0017); a camera move re-runs only the view.
 */
export class CpuStippleTiers {
  readonly tiers = new TierState();
  stipple: CpuStipple | null = null;
  view: CpuStippleView | null = null;

  constructor(private readonly meta: DrawingsMeta) {}

  frame(
    P: Params,
    zoom: number,
    opts: SceneOptions = {},
  ): { view: CpuStippleView; work: TierWork } {
    const work = this.tiers.run(
      { P, zoom, modelKey: JSON.stringify(opts) },
      {
        model: () => {
          this.stipple = new CpuStipple(buildScene(P, this.meta, opts));
        },
        view: () => {
          if (!this.stipple) throw new Error('no model tier');
          this.view = this.stipple.view(cameraOf(P, zoom), P.mTime);
        },
      },
    );
    if (!this.view) throw new Error('no view tier');
    return { view: this.view, work };
  }
}
