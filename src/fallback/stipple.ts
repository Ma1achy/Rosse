/**
 * The galaxy on the CPU engine (ADR 0011): the model tier (./kernels/stipple.ts, cached until a
 * model parameter changes) and the view tier (./kernels/ribbons.ts for the line-work, whose
 * projected points the dust culls of ./kernels/project.ts read, then ./kernels/scan.ts), the twins
 * of what src/render/stipple.ts dispatches on the GPU, giving the same per-class instance lists and
 * the same ribbon, capsule and piece buffers, in the same order.
 *
 * Layer order follows the reference's `scene()` (app23.js:L1289–1301): stroke ribbons (line ink),
 * the hatching's lines, dots and blobs (line ink), pieces (young ink), then the stipple by
 * population, knots, sparkle stars, and the core.
 */
import type { Instance } from '../marks/instance';
import type { InkLayer } from '../render/layers';
import { cullsUniform, ribUniform } from '../model/ribbons';
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
import { classCapacity, compact } from './kernels/scan';
import { runStipple } from './kernels/stipple';

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
      instances: instanceList(rv.pieces, rv.piecesU, rv.nPieces),
    });
  return out;
}

export class CpuStipple {
  readonly samples: ReturnType<typeof runStipple>;
  readonly lines: RibbonModel;

  constructor(readonly scene: GalaxyScene) {
    this.samples = runStipple(scene.galaxy);
    this.lines = ribbonModel(scene.ribbons, scene.galaxy.pool, scene.galaxy.dotBase);
  }

  view(cam: Camera): CpuStippleView {
    const n = this.samples.n;
    const { P, galaxy, ribbons: R } = this.scene;
    const V = viewDesc(cam, galaxy.g.dust, n, classCapacity(n));
    const rv = runRibbons(this.lines, V, ribUniform(R, cam, P, galaxy.g.n_dot_pool));
    const culls = {
      c: cullsUniform(R, cam, P, galaxy.g.key),
      points: rv.points,
      carve: R.carve,
      noise: galaxy.noise,
    };
    const p = runProject(V, this.samples, culls);
    const { out, counts, cap } = compact(p.classes, n, p.u32);
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
    const layers: InkLayer[] = [
      ...lineLayers(rv, this.lines),
      ...STIPPLE_LAYERS.map((l): InkLayer => ({
        kind: 'sprites',
        atlas: l.atlas,
        gain: 1,
        instances: list(l.cls),
      })),
    ];
    const cores = coreInstances(this.scene.P, this.scene.meta, cam, galaxy.noise);
    if (cores.length) layers.push({ kind: 'sprites', atlas: 'cores', gain: 1, instances: cores });
    return {
      layers,
      counts: {
        ...markCounts(counts),
        curves: R.nCurves,
        pieces: rv.nPieces,
        ribbonSegments: R.nSegs,
        hatches: R.nHatch,
      },
      perClass: counts,
      classes: p.classes,
      projected: p.f32,
      ribbons: rv,
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
          this.view = this.stipple.view(cameraOf(P, zoom));
        },
      },
    );
    if (!this.view) throw new Error('no view tier');
    return { view: this.view, work };
  }
}
