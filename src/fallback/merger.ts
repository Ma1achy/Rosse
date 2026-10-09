/**
 * A merger on the CPU engine (ADR 0011): the twin of src/render/merger.ts, with the same tiers.
 * The model tier runs the test stars (./kernels/merger.ts), reads the framing from them, bins the
 * tidal map and builds each galaxy as a single galaxy; the view tier blends the state at `mTime`,
 * makes the debris's marks and the tidal grids, then runs each galaxy's own view tier with its tides
 * (./stipple.ts `CpuStipple`), and `mWarp`'s drawings.
 */
import { cameraOf } from '../view/camera';
import type { Params } from '../core/params';
import type { Instance } from '../marks/instance';
import { CLASS_COUNT, Cls } from '../model/classes';
import {
  buildMergerScene,
  framesFromRadii,
  mergerFraming,
  mergerViewUniform,
  mwarpDesc,
  mwarpView,
  type MergerFraming,
  type MergerScene,
  type MergerSceneOptions,
} from '../model/merger';
import { STIPPLE_LAYERS, markCounts, type MarkCounts } from '../model/scene';
import type { DrawingsMeta } from '../model/variation';
import type { InkLayer } from '../render/layers';
import { wholeFrame, snapSelect, type MergerFrame } from '../sim/merger';
import { CpuMergerStars } from './kernels/merger';
import { MERGER_SLOTS, runMergerSprites } from './kernels/merger-sprites';
import { INSTANCE_WORDS } from './kernels/project';
import { compact } from './kernels/scan';
import { TideData } from './kernels/tide';
import { runVectors, vectorInputs } from './kernels/vector';
import { CpuShellScene } from './shells';
import { CpuStipple, instanceList, vectorLayers, type CpuStippleView } from './stipple';
import { buildShellScene } from '../model/shells';

export interface CpuMergerView {
  layers: InkLayer[];
  counts: MarkCounts;
  perClass: Uint32Array;
  framing: MergerFraming;
  galaxies: [CpuStippleView, CpuStippleView];
}

export class CpuMerger {
  readonly scene: MergerScene;
  readonly stars: CpuMergerStars;
  readonly tide: TideData;
  readonly galaxies: [CpuStipple, CpuStipple];
  readonly frames: { chosen: MergerFrame; end: MergerFrame };
  /** the simulated shells, when `shellsOn` */
  readonly shells: CpuShellScene | null;
  /** the lens's host (M9): a merging pair can lens a galaxy behind it */
  readonly lensHost: CpuStipple | null;
  /** the main parameters' own sky, trails, arrow and overlays, placed by the real camera */
  readonly skyHost: CpuStipple | null;

  /** The model tier: the simulation, the framing, the bins and the two galaxies. */
  constructor(
    P: Params,
    meta: DrawingsMeta,
    opts: MergerSceneOptions = {},
    onChunk?: (phase: 'timeline' | 'future', done: number, of: number) => void,
  ) {
    this.scene = buildMergerScene(P, meta, opts);
    const D = this.scene.desc;
    this.stars = new CpuMergerStars(D);
    this.stars.run(onChunk);
    const track = D.track;
    const radii = (sel: Parameters<CpuMergerStars['blend']>[0], C: typeof track.C) =>
      CpuMergerStars.radii(this.stars.blend(sel), D.total, wholeFrame(C, track.M).c);
    this.frames = framesFromRadii(
      this.scene,
      radii(snapSelect(track, 1), track.C),
      radii(
        {
          phase: 'future',
          exact: false,
          i0: track.future.nSnaps - 1,
          i1: track.future.nSnaps - 1,
          a: 0,
          n: track.future.nSnaps,
        },
        track.Cend,
      ),
    );
    this.tide = new TideData(D.total, D.n[0]);
    this.tide.setInitial(this.stars.ic);
    this.tide.buildBins();
    this.shells = P.shellsOn
      ? new CpuShellScene(
          buildShellScene(P, meta, this.scene.variation, {
            ...opts.shells,
            ...(opts.placementKey !== undefined ? { placementKey: opts.placementKey } : {}),
          }),
        )
      : null;
    this.lensHost = this.scene.lensHost ? new CpuStipple(this.scene.lensHost) : null;
    this.skyHost = this.scene.skyHost ? new CpuStipple(this.scene.skyHost) : null;
    this.galaxies = [0, 1].map(
      (g) =>
        new CpuStipple(this.scene.galaxies[g] as MergerScene['galaxies'][number], {
          data: this.tide,
          g: g as 0 | 1,
          r2: 1,
        }),
    ) as [CpuStipple, CpuStipple];
  }

  /** The view tier at a zoom (and, when given, a moment `mTime`). */
  view(zoom: number, mTime?: number): CpuMergerView {
    const scene = this.scene;
    if (mTime !== undefined) scene.P.mTime = mTime;
    const D = scene.desc;
    const fr = mergerFraming(scene, zoom, this.frames);
    const cur = this.stars.blend(fr.sel);
    const mv = mergerViewUniform(scene, fr, zoom);
    const marks = runMergerSprites(mv, cur, this.stars.ic, scene.pool, scene.dotBase, this.tide);
    this.tide.buildGrid();
    // the debris, compacted by class as the stipple's
    const n = D.total * MERGER_SLOTS;
    const { out, counts, cap } = compact(marks.classes, n, marks.u32);
    const outF = new Float32Array(out.buffer);
    const list = (cls: number): Instance[] => {
      const k = counts[cls] ?? 0;
      return instanceList(
        outF.subarray(cls * cap * INSTANCE_WORDS, (cls * cap + k) * INSTANCE_WORDS),
        out.subarray(cls * cap * INSTANCE_WORDS, (cls * cap + k) * INSTANCE_WORDS),
        k,
      );
    };
    const debris: InkLayer[] = STIPPLE_LAYERS.filter((l) => l.cls !== 0).map((l) => ({
      kind: 'sprites',
      atlas: l.atlas,
      gain: 1,
      instances: list(l.cls),
    }));
    // each galaxy with its tides
    const views = this.galaxies.map((s, g) => {
      const G = fr.galaxies[g as 0 | 1];
      if (s.tide) s.tide.r2 = G.r2;
      return s.view(G.camera);
    }) as [CpuStippleView, CpuStippleView];
    // mWarp's drawings
    const MW = mwarpDesc(scene);
    const mw: InkLayer[] = [];
    if (MW) {
      const vo = runVectors(
        vectorInputs(
          MW.lib,
          mwarpView(scene, MW, fr),
          scene.pool,
          scene.dotBase,
          scene.galaxies[0].galaxy.noise,
          this.tide,
        ),
      );
      mw.push(...vectorLayers(vo, MW.nDots, MW.nBlobs));
    }
    const sh = this.shells?.view(zoom);
    if (sh) mw.push(...sh.layers);
    // the lens, over the merged scene
    const lens = this.lensHost?.view(cameraOf(scene.P, zoom), scene.P.mTime).lens;
    if (lens) {
      const LL = lens.layers;
      mw.push(...LL.line, ...LL.vectors, ...LL.pieces, ...LL.dots, ...LL.knots, ...LL.stars);
      mw.push(...LL.cores);
    }
    // the main parameters' own sky, trails, arrow and overlays: the background goes under all
    const host = this.skyHost?.view(cameraOf(scene.P, zoom), scene.P.mTime);
    const hostBack = host?.layers.slice(0, host.nBack) ?? [];
    const hostFront = host?.layers.slice(host.nBack) ?? [];
    const perClass = new Uint32Array(CLASS_COUNT);
    for (let c = 0; c < CLASS_COUNT; c++)
      perClass[c] =
        (host?.perClass[c] ?? 0) +
        (lens?.perClass[c] ?? 0) +
        (counts[c] ?? 0) +
        views.reduce((acc, v) => acc + (v.perClass[c] ?? 0), 0) +
        (c === Cls.old ? (sh?.dots ?? 0) : 0);
    const sum = (k: keyof MarkCounts) =>
      views.reduce((acc, v) => acc + (v.counts[k] ?? 0), 0) + (host?.counts[k] ?? 0);
    const total: MarkCounts = { ...markCounts(perClass) };
    for (const k of [
      'curves',
      'pieces',
      'ribbonSegments',
      'hatches',
      'drawings',
      'vectorCaps',
      'vectorDots',
      'vectorBlobs',
      'streamDots',
      'streamKnots',
    ] as const)
      total[k] = sum(k);
    return {
      layers: [...hostBack, ...views.flatMap((v) => v.layers), ...mw, ...debris, ...hostFront],
      counts: total,
      perClass,
      framing: fr,
      galaxies: views,
    };
  }
}
