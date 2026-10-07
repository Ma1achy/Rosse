/**
 * The SVG export for each engine: the integration surface for M11's "Export SVG" button.
 *
 * ```ts
 * // WebGPU engine (after the frame's `GpuStipple.frame(...)`; reads buffers back on demand)
 * const { svg, counts } = await exportSvgGpu(gpuStipple);
 * // CPU engine (the `CpuStipple` and the `view` the frame was drawn from)
 * const { svg, counts } = exportSvgCpu(cpuStipple, view);
 * // the page (src/ui/export.ts `ExportSource`: the layers, and what the layers do not carry)
 * const { svg, counts } = await exportSvgOf(source);
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
import { exportLayersOf, readInkLayers, type LayerSource } from './read-layers';
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

/**
 * What an export needs besides the ink layers (the page's `ExportSource.exportInfo`,
 * src/ui/export.ts): the drawing's seed and pen metadata (`dotSize`, `strokes`), and, for a single
 * galaxy, the roles of its placed drawings' capsules. `roles` is a function of the hatching's
 * capsule count because the WebGPU layer reads that back with the capsules; a CPU engine in a
 * worker sends the array it computed for its own count (`ExportInfoData`).
 */
export interface ExportInfo extends SvgOptions {
  /** the dust hatching's capsules at the front of a CPU capsule layer (`scene.ribbons.nCaps`) */
  hatchCaps: number;
  /** per capsule of the unnamed capsule layer, its SVG layer (absent: every placed capsule is `drawings`) */
  roles?: (hatch: number) => Uint8Array;
}

/** What crosses the CPU worker's boundary: `ExportInfo` with the roles as an array. */
export interface ExportInfoData extends SvgOptions {
  hatchCaps: number;
  roles?: Uint8Array;
}

/** Info for a frame with no placed-drawing roles (a merger, simulated shells). */
export function plainExportInfo(seed: number, meta: DrawingsMeta): ExportInfo {
  return { ...svgOptions(seed, meta), hatchCaps: 0 };
}

/** The page's side of `ExportInfoData`. */
export function infoOfData(d: ExportInfoData): ExportInfo {
  const roles = d.roles;
  return {
    seed: d.seed,
    dotSize: d.dotSize,
    ...(d.strokes ? { strokes: d.strokes } : {}),
    hatchCaps: d.hatchCaps,
    ...(roles ? { roles: () => roles } : {}),
  };
}

/** The CPU engine's info for the frame it last drew (the worker sends this). */
export function cpuExportInfoData(stipple: CpuStipple, view: CpuStippleView): ExportInfoData {
  const { P, meta, vectors: D } = stipple.scene;
  const hatchCaps = stipple.scene.ribbons.nCaps;
  return {
    ...svgOptions(P.seed, meta),
    hatchCaps,
    roles: capsuleRoles(
      view.vectorView.rows,
      D.capFirst,
      D.nCapSlots,
      view.vectors.capKeys,
      hatchCaps,
    ),
  };
}

/** Gives the placed drawings' capsules their layers (see ./capsule-roles.ts). */
function withRoles(layers: ExportLayer[], roles: (hatch: number) => Uint8Array): ExportLayer[] {
  // a layer that names its SVG layer (the sky's) is not the hatching and the placed drawings
  return layers.map((l) =>
    l.kind === 'capsules' && !l.svgLayer ? { ...l, roles: roles(l.hatch) } : l,
  );
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

/** What `exportSvgGpu` needs of the frame, read back (the capsule keys) and checked for staleness. */
export async function gpuExportInfo(stipple: GpuStipple): Promise<ExportInfo> {
  const scene = stipple.current;
  const cam = stipple.lastCamera;
  if (!scene || !cam) throw new Error('nothing to export: no frame has been built');
  const views = stipple.tiers.runs.view;
  const D = scene.vectors;
  const keys = D.nCapSlots ? (await stipple.vectors.readBack()).capKeys : new Uint32Array(0);
  if (stipple.tiers.runs.view !== views || stipple.current !== scene || stipple.lastCamera !== cam)
    throw new Error('the frame changed during the export: run it inside the frame queue');
  const rows = vectorRows(scene.P, scene.variation, scene.meta, D.parts, cam);
  return {
    ...svgOptions(scene.P.seed, scene.meta),
    hatchCaps: 0,
    roles: (hatch) => capsuleRoles(rows, D.capFirst, D.nCapSlots, keys, hatch),
  };
}

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

/** The page's `ExportSource`, as the SVG export reads it. */
export interface SvgSource extends LayerSource {
  exportInfo(): Promise<ExportInfo>;
}

/**
 * The SVG of what the page drew last, from its `ExportSource` alone: the layers (awaited: the CPU
 * engine's are in a worker), read back on the WebGPU engine, and the drawing's metadata and
 * capsule roles. Run it inside the source's `exclusive` (the frame queue).
 */
export async function exportSvgOf(source: SvgSource): Promise<SvgResult> {
  const info = await source.exportInfo();
  const layers = await exportLayersOf(source, info.hatchCaps);
  return buildSvg(info.roles ? withRoles(layers, info.roles) : layers, info);
}
