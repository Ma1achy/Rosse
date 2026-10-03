/**
 * The stipple on the CPU engine (ADR 0011): the model tier (./kernels/stipple.ts, cached until a
 * model parameter changes) and the view tier (./kernels/project.ts, then ./kernels/scan.ts), the
 * twins of what src/render/stipple.ts dispatches on the GPU, giving the same per-class instance
 * lists in the same order.
 */
import type { Instance } from '../marks/instance';
import type { InkLayer } from '../render/layers';
import { coreInstances } from '../model/parts';
import { STIPPLE_LAYERS, markCounts, type GalaxyScene, type MarkCounts } from '../model/scene';
import { viewDesc, type Camera } from '../view/camera';
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
}

export class CpuStipple {
  readonly samples: ReturnType<typeof runStipple>;

  constructor(readonly scene: GalaxyScene) {
    this.samples = runStipple(scene.galaxy);
  }

  view(cam: Camera): CpuStippleView {
    const n = this.samples.n;
    const V = viewDesc(cam, this.scene.galaxy.g.dust ?? 0, n, classCapacity(n));
    const p = runProject(V, this.samples);
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
    const layers: InkLayer[] = STIPPLE_LAYERS.map((l) => ({
      kind: 'sprites',
      atlas: l.atlas,
      gain: 1,
      instances: list(l.cls),
    }));
    const cores = coreInstances(this.scene.P, this.scene.meta, cam);
    if (cores.length) layers.push({ kind: 'sprites', atlas: 'cores', gain: 1, instances: cores });
    return {
      layers,
      counts: markCounts(counts),
      perClass: counts,
      classes: p.classes,
      projected: p.f32,
    };
  }
}
