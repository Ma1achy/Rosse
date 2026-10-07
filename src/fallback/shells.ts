/**
 * A shell galaxy's simulated shells on the CPU engine (ADR 0011): the twin of
 * src/render/shells.ts. The satellite's stars and their shells (./kernels/shells.ts, the model
 * tier), then, for a view, the stars as dots and the arcs as stroke ribbons through a face-on camera
 * (`shellArcs` ignore the camera, v21 parity).
 */
import { ribUniform } from '../model/ribbons';
import { shellRibbons, type ShellScene } from '../model/shells';
import type { InkLayer } from '../render/layers';
import { UNIT_SCALE, viewDesc, type Camera } from '../view/camera';
import { CpuShells } from './kernels/shells';
import { ribbonModel, runRibbons, type RibbonModel } from './kernels/ribbons';
import { instanceList, lineLayers } from './stipple';

export class CpuShellScene {
  readonly sim: CpuShells;
  private readonly lines: RibbonModel | null;

  constructor(readonly scene: ShellScene) {
    this.sim = new CpuShells(scene.p, scene.key);
    this.sim.run();
    const R = shellRibbons(scene, this.arcs);
    this.lines = R ? ribbonModel(R, scene.pool, scene.dotBase) : null;
  }

  get arcs() {
    return this.scene.opts.arcs ?? this.sim.arcs;
  }

  /** The arcs' ribbons, then the dots, for a zoom. */
  view(zoom: number): { layers: InkLayer[]; dots: number } {
    const { scene, sim } = this;
    const out: InkLayer[] = [];
    if (this.lines) {
      const cam: Camera = { incl: 0, az: 0, pa: 0, winding: 1, zoom };
      const R = this.lines.R;
      const rv = runRibbons(
        this.lines,
        viewDesc(cam, 0, 0, 0),
        ribUniform(R, cam, scene.P, scene.variation.dotPool.length),
      );
      out.push(...lineLayers(rv, this.lines));
    }
    const f = sim.dots(scene.pool, scene.dotBase, UNIT_SCALE * zoom);
    out.push({
      kind: 'sprites',
      atlas: 'dots',
      gain: 1,
      instances: instanceList(f, new Uint32Array(f.buffer), sim.n),
    });
    return { layers: out, dots: sim.n };
  }
}
