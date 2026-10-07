/**
 * The SVG export for each engine: the integration surface for M11's "Export SVG" button.
 *
 * ```ts
 * // WebGPU engine (after the frame's `GpuStipple.frame(...)`; reads buffers back on demand)
 * const { svg, counts } = await exportSvgGpu(gpuStipple, zoom);
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
import { cameraOf } from '../../view/camera';
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

/**
 * The SVG of the frame the WebGPU engine last built (a read-back of its buffers). `zoom` is the
 * camera's zoom of that frame: the placed drawings' rows, which say each capsule's sheet, are
 * laid out for it.
 */
export async function exportSvgGpu(stipple: GpuStipple, zoom = 1): Promise<SvgResult> {
  const scene = stipple.current;
  if (!scene) throw new Error('nothing to export: no frame has been built');
  const read = await readInkLayers(stipple.device, stipple.inkLayers());
  const D = scene.vectors;
  const hasCaps = read.some((l) => l.kind === 'capsules');
  const keys =
    hasCaps && D.nCapSlots ? (await stipple.vectors.readBack()).capKeys : new Uint32Array(0);
  const rows = vectorRows(scene.P, scene.variation, scene.meta, D.parts, cameraOf(scene.P, zoom));
  const layers = withRoles(read, (hatch) =>
    capsuleRoles(rows, D.capFirst, D.nCapSlots, keys, hatch),
  );
  return buildSvg(layers, svgOptions(scene.P.seed, scene.meta));
}
