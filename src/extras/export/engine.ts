/**
 * The SVG export for each engine: the integration surface for M11's "Export SVG" button.
 *
 * ```ts
 * // WebGPU engine (after the frame's `GpuStipple.frame(...)`; reads buffers back on demand)
 * const { svg, counts } = await exportSvgGpu(gpuStipple);
 * // CPU engine (the `CpuStipple` and the `view` the frame was drawn from)
 * const { svg, counts } = exportSvgCpu(cpuStipple, view);
 * // save: new Blob([svg], { type: 'image/svg+xml' }), file name svgFileName(seed)
 * ```
 *
 * The export is of the key ink on Paper whatever plates are showing, as v21 (`P.plates = 'ink'`
 * while recording): colour plates are not exported, and no pass is re-run.
 */
import type { CpuStipple, CpuStippleView } from '../../fallback/stipple';
import { vectorRows } from '../../model/parts';
import type { GpuStipple } from '../../render/stipple';
import { capsuleRoles } from './capsule-roles';
import { readInkLayers } from './read-layers';
import type { DrawingsMeta } from '../../model/variation';
import {
  buildSvg,
  cpuExportLayers,
  type ExportLayer,
  type SvgOptions,
  type SvgResult,
} from './svg';

/** The file name for a galaxy's SVG. */
export function svgFileName(seed: number): string {
  return `rosse-galaxy-${String(seed)}.svg`;
}

/** The builder's options from the scene's drawings metadata. */
function svgOptions(seed: number, meta: DrawingsMeta): SvgOptions {
  return {
    seed,
    dotSize: meta.dots.size,
    ...(meta.strokes ? { strokes: { thick: meta.strokes.thick, h: meta.strokes.h } } : {}),
  };
}

/** Gives the placed drawings' capsules their layers (see ./capsule-roles.ts). */
function withRoles(layers: ExportLayer[], roles: (hatch: number) => Uint8Array): ExportLayer[] {
  return layers.map((l) => (l.kind === 'capsules' ? { ...l, roles: roles(l.hatch) } : l));
}

/** The SVG of a frame the CPU engine drew. */
export function exportSvgCpu(stipple: CpuStipple, view: CpuStippleView): SvgResult {
  const { P, meta, vectors: D } = stipple.scene;
  const layers = withRoles(cpuExportLayers(view.layers, stipple.scene.ribbons.nCaps), (hatch) =>
    capsuleRoles(view.vectorView.rows, D.capFirst, D.nCapSlots, view.vectors.capKeys, hatch),
  );
  return buildSvg(layers, svgOptions(P.seed, meta));
}

/** Exports in flight, by engine: the read-back is several awaited copies of live buffers. */
const running = new WeakSet<GpuStipple>();

/**
 * The SVG of the frame the WebGPU engine last built (a read-back of its buffers).
 *
 * **Run it inside the frame queue**, the way the page's snapshot is: the read-back is several
 * awaited copies of buffers the next frame overwrites, so nothing may build a frame (`frame`,
 * `setScene`, `setView`) until it resolves. Two exports of one engine at once are refused, and if
 * the view tier ran while the copies were in flight the export is refused as stale (it would mix
 * two frames). The placed drawings' rows are laid out for the camera of the last view, whatever
 * zoom the page now holds.
 */
export async function exportSvgGpu(stipple: GpuStipple): Promise<SvgResult> {
  const scene = stipple.current;
  const cam = stipple.lastCamera;
  if (!scene || !cam) throw new Error('nothing to export: no frame has been built');
  if (running.has(stipple)) throw new Error('an export of this frame is already running');
  running.add(stipple);
  try {
    const views = stipple.tiers.runs.view;
    const read = await readInkLayers(stipple.device, stipple.inkLayers());
    const D = scene.vectors;
    const hasCaps = read.some((l) => l.kind === 'capsules');
    const keys =
      hasCaps && D.nCapSlots ? (await stipple.vectors.readBack()).capKeys : new Uint32Array(0);
    if (
      stipple.tiers.runs.view !== views ||
      stipple.current !== scene ||
      stipple.lastCamera !== cam
    )
      throw new Error('the frame changed during the export: run it inside the frame queue');
    const rows = vectorRows(scene.P, scene.variation, scene.meta, D.parts, cam);
    const layers = withRoles(read, (hatch) =>
      capsuleRoles(rows, D.capFirst, D.nCapSlots, keys, hatch),
    );
    return buildSvg(layers, svgOptions(scene.P.seed, scene.meta));
  } finally {
    running.delete(stipple);
  }
}
