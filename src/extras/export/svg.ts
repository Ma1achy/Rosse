/**
 * SVG export for pen plotters: v21's `exportSVG` (app23.js:L1155–1189) rebuilt from the engine's
 * own instance, ribbon and capsule buffers. One layer per pen (a group with `inkscape:groupmode=
 * "layer"`), every line a path, every dot a circle, stars as rays, cores as nested rings a pen can
 * fill, in plate units (800 × 800, 200 mm square).
 *
 * The input is the frame's ink layers (`InkLayer`, src/render/layers.ts) in their CPU forms
 * (`SpriteLayer`, `RibbonLayer`, `CapsuleLayer`). The CPU engine already has them; the WebGPU
 * engine's buffers are copied back, on demand, by `readInkLayers` (./read-layers.ts): never on the
 * frame path. Both engines therefore export through this one function, from the same buffers they
 * draw.
 *
 * What v21 records, and what the engine's buffers hold instead:
 *   - v21 records each polyline it draws (`REC.lines`). The engine's buffers hold segments: the
 *     ribbon quads (two corners at each end) and the capsules (two ends). A path is rebuilt by
 *     chaining consecutive segments whose ends meet (`chain`): ribbons to the centre line of their
 *     corners and their mean width, capsules to their points and width. A chain breaks where the
 *     engine dropped a segment (v21 draws the dropped segment's neighbours too), so a path may be
 *     two where v21's is one; the counts are compared with v21's per layer in tests/unit/svg.test.ts.
 *   - the hatching's capsules (the first `hatch` of a capsule layer) are layer `dust`; every other
 *     capsule is `drawings`. v21 sends its drawn stars (`sstars`) to `stars` and its background
 *     drawings to `background`; the engine's single capsule buffer does not say which capsule is
 *     whose, so they stay in `drawings`. Neither appears in the golden presets' overrides (M7).
 *   - the sprite layers carry their atlas: dots, pieces (arm strokes), knots, stars, fgstars, cores.
 *     A layer with `svgLayer: 'background'` (the deep field, from M7) goes to `background`.
 *
 * Output is deterministic: layers in v21's order, marks in buffer order, numbers rounded to 0.01.
 */
import type { AtlasName } from '../../marks/atlas';
import type { Instance } from '../../marks/instance';
import { CAPSULE_WORDS, RIBBON_SEG_WORDS } from '../../model/ribbons';
import type { CapsuleLayer, InkLayer, RibbonLayer, SpriteLayer } from '../../render/layers';

/** v21's layers, in the order of its file. */
export const SVG_LAYERS = [
  'background',
  'drawings',
  'arms',
  'dust',
  'cores',
  'knots',
  'dots',
  'stars',
] as const;
export type SvgLayerName = (typeof SVG_LAYERS)[number];

/** The layers' names as the pen plotter's software shows them (v21's). */
export const SVG_LAYER_LABELS: Record<SvgLayerName, string> = {
  background: 'background: deep field and foreground stars',
  drawings: 'hand-drawn parts',
  arms: 'arm strokes',
  dust: 'dust lanes',
  cores: 'cores',
  knots: 'knots',
  dots: 'dots',
  stars: 'drawn stars',
};

/** The CPU forms of the ink layers an export reads (what `readInkLayers` returns for the GPU). */
export type ExportLayer =
  | SpriteLayer
  | RibbonLayer
  | (CapsuleLayer & {
      /** the first `hatch` capsules are the dust hatching */
      hatch: number;
      /** per capsule after the hatching, the index in `SVG_LAYERS` of its layer (default `drawings`) */
      roles?: Uint8Array;
    });

export interface SvgOptions {
  /** the drawing's seed, for the title */
  seed: number;
  /** `meta.size` of the dots atlas: the drawn size of each dot tile (v21's `AT.dots.size`) */
  dotSize: ArrayLike<number>;
  /**
   * The strokes sheet's `thick` per tile and its cell height `h` (`meta.strokes`): a ribbon quad
   * spans the cell, and the stroke inked in it only `thick / h` of that (v21: app23.js:L822).
   */
  strokes?: { thick: ArrayLike<number>; h: number };
}

export interface SvgResult {
  svg: string;
  /** elements per layer (paths, circles, ray sets and core groups), v21's `counts` */
  counts: Record<SvgLayerName, number>;
}

const INK = '#1d1b19';
const f = (v: number): number => Math.round(v * 100) / 100;
const inside = (x: number, y: number): boolean => x > -20 && x < 820 && y > -20 && y < 820;

/** A polyline with a stroke width (plate units). */
export interface Path {
  pts: [number, number][];
  w: number;
  /** what the segments were grouped by (`chain`'s `group`) */
  group: number;
}

/**
 * Chains consecutive segments whose ends meet into polylines. `seg(i)` gives segment i's start,
 * end and width; a new path starts where a segment's start is not (within `eps`) the previous end.
 */
export function chain(
  n: number,
  seg: (i: number) => [number, number, number, number, number],
  eps = 0.02,
  group: (i: number) => number = () => 0,
): Path[] {
  const out: Path[] = [];
  let cur: Path | null = null;
  let wsum = 0;
  const close = () => {
    if (cur) cur.w = wsum / Math.max(1, cur.pts.length - 1);
    cur = null;
    wsum = 0;
  };
  let px = NaN;
  let py = NaN;
  for (let i = 0; i < n; i++) {
    const [ax, ay, bx, by, w] = seg(i);
    if (![ax, ay, bx, by].every(Number.isFinite)) {
      close();
      px = py = NaN;
      continue;
    }
    if (!cur || Math.abs(ax - px) > eps || Math.abs(ay - py) > eps || group(i) !== cur.group) {
      close();
      cur = { pts: [[ax, ay]], w: 0, group: group(i) };
      out.push(cur);
    }
    cur.pts.push([bx, by]);
    wsum += w;
    px = bx;
    py = by;
  }
  close();
  return out;
}

/** The centre lines of a ribbon layer's segments (corners a.xy, a.zw at the start; b.xy, b.zw at the end). */
export function ribbonPaths(l: RibbonLayer, strokes?: SvgOptions['strokes']): Path[] {
  const s = l.segs;
  return chain(l.count, (i) => {
    const o = i * RIBBON_SEG_WORDS;
    const g = (k: number) => s[o + k] ?? 0;
    const quad = (Math.hypot(g(0) - g(2), g(1) - g(3)) + Math.hypot(g(4) - g(6), g(5) - g(7))) / 2;
    const thick = strokes ? (strokes.thick[l.segsU[o + 10] ?? 0] ?? strokes.h) : 1;
    const width = strokes ? (quad * thick) / strokes.h : quad;
    return [(g(0) + g(2)) / 2, (g(1) + g(3)) / 2, (g(4) + g(6)) / 2, (g(5) + g(7)) / 2, width];
  });
}

/** The polylines of a run of capsules `[from, to)`. */
export function capsulePaths(
  caps: Float32Array,
  from: number,
  to: number,
  roles?: Uint8Array,
): Path[] {
  return chain(
    to - from,
    (i) => {
      const o = (from + i) * CAPSULE_WORDS;
      const g = (k: number) => caps[o + k] ?? 0;
      return [g(0), g(1), g(2), g(3), g(4) * 2];
    },
    0.02,
    (i) => roles?.[from + i] ?? 1,
  );
}

const rays = (x: number, y: number, a: number, ang: number, n: number, frac: number): string => {
  let d = '';
  for (let k = 0; k < n; k++) {
    const t = ang + ((k * Math.PI) / n) * 2;
    const L = a * (k % 2 && frac ? frac : 1);
    d += `M${String(f(x))} ${String(f(y))} L${String(f(x + Math.cos(t) * L))} ${String(f(y + Math.sin(t) * L))} `;
  }
  return d;
};

const pathD = (pts: [number, number][]): string =>
  'M' + pts.map((p) => `${String(f(p[0]))} ${String(f(p[1]))}`).join(' L');

/** Which of v21's layers a sprite layer's marks go to. */
export function spriteLayerOf(l: SpriteLayer): SvgLayerName | null {
  if (l.svgLayer) return l.svgLayer;
  const by: Partial<Record<AtlasName, SvgLayerName>> = {
    dots: 'dots',
    pieces: 'arms',
    knots: 'knots',
    stars: 'stars',
    fgstars: 'background',
    cores: 'cores',
  };
  return by[l.atlas] ?? null;
}

/** Builds the SVG of a frame's ink layers (see the file comment). */
export function buildSvg(layers: readonly ExportLayer[], opts: SvgOptions): SvgResult {
  const out: Record<SvgLayerName, string[]> = {
    background: [],
    drawings: [],
    arms: [],
    dust: [],
    cores: [],
    knots: [],
    dots: [],
    stars: [],
  };
  const addPaths = (layer: SvgLayerName, paths: Path[]) => {
    for (const p of paths) {
      const pts = p.pts.filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
      if (pts.length < 2 || !pts.some((q) => inside(q[0], q[1]))) continue;
      out[layer].push(`<path d="${pathD(pts)}" stroke-width="${String(f(p.w))}"/>`);
    }
  };
  // v21 lists every line before every sprite, within a layer
  for (const l of layers) {
    if (l.kind === 'ribbons')
      addPaths(
        l.svgLayer ?? 'arms',
        ribbonPaths(l, opts.strokes).map((p) => ({ ...p, w: Math.max(0.8, p.w) })),
      );
    else if (l.kind === 'capsules' && l.svgLayer)
      // a layer that names its layer (the sky's drawings): all of it goes there
      addPaths(l.svgLayer, capsulePaths(l.caps, 0, l.count).map(minWidth));
    else if (l.kind === 'capsules') {
      const h = Math.min(l.hatch, l.count);
      addPaths('dust', capsulePaths(l.caps, 0, h).map(minWidth));
      for (const p of capsulePaths(l.caps, h, l.count, l.roles))
        addPaths(SVG_LAYERS[p.group] ?? 'drawings', [minWidth(p)]);
    }
  }
  for (const l of layers) {
    if (l.kind !== 'sprites') continue;
    const layer = spriteLayerOf(l);
    if (!layer) continue;
    for (const s of l.instances) sprite(out, layer, l.atlas, s, opts);
  }
  const counts = Object.fromEntries(SVG_LAYERS.map((k) => [k, out[k].length])) as Record<
    SvgLayerName,
    number
  >;
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 800 800" width="200mm" height="200mm">',
    `<title>A galaxy, drawn by hand · Rosse · seed ${String(opts.seed)}</title>`,
    `<g fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">`,
    ...SVG_LAYERS.filter((k) => out[k].length).map(
      (k) =>
        `<g id="${k}" inkscape:groupmode="layer" inkscape:label="${SVG_LAYER_LABELS[k]}">${out[k].join('')}</g>`,
    ),
    '</g></svg>',
  ].join('\n');
  return { svg, counts };
}

/** v21's minimum pen width for a recorded vector line (L1204: `max(0.6, 2w)`; w is already 2w here). */
const minWidth = (p: Path): Path => ({ ...p, w: Math.max(0.6, p.w) });

function sprite(
  out: Record<SvgLayerName, string[]>,
  layer: SvgLayerName,
  atlas: AtlasName,
  s: Instance,
  opts: SvgOptions,
): void {
  const { x, y, layer: tile, m } = s;
  if (!inside(x, y)) return;
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  const ang = Math.atan2(m[1], m[0]);
  const circle = (r: number) =>
    `<circle cx="${String(f(x))}" cy="${String(f(y))}" r="${String(f(r))}" fill="${INK}" stroke="none"/>`;
  if (atlas === 'dots') {
    const size = opts.dotSize[tile] || 8;
    out[layer].push(circle(Math.max(0.35, (sx * size) / 80)));
  } else if (atlas === 'pieces') out[layer].push(circle(Math.max(0.35, sx * 0.14)));
  else if (atlas === 'knots') out[layer].push(circle(Math.max(0.5, sx * 0.24)));
  else if (atlas === 'stars')
    out[layer].push(`<path d="${rays(x, y, sx * 0.42, ang, 4, 0)}" stroke-width="0.9"/>`);
  else if (atlas === 'fgstars')
    out[layer].push(`<path d="${rays(x, y, sx * 0.46, ang, 8, 0.5)}" stroke-width="0.9"/>`);
  else if (atlas === 'cores') {
    // a solid core, drawn as nested rings a pen can fill
    const rx = sx * 0.3;
    const ry = sy * 0.3;
    let g = `<g transform="translate(${String(f(x))} ${String(f(y))}) rotate(${String(f((ang * 180) / Math.PI))})">`;
    const rmax = Math.max(rx, ry);
    for (let k = 1; k <= Math.ceil(rmax / 0.9); k++) {
      const fr = (k * 0.9) / rmax;
      g += `<ellipse rx="${String(f(rx * fr))}" ry="${String(f(ry * fr))}" stroke-width="0.9"/>`;
    }
    out[layer].push(g + '</g>');
  }
}

/** The export layers of a CPU frame: its sprite, ribbon and capsule layers, with the hatching marked. */
export function cpuExportLayers(layers: readonly InkLayer[], hatchCaps: number): ExportLayer[] {
  const out: ExportLayer[] = [];
  for (const l of layers) {
    if (l.kind === 'sprites' || l.kind === 'ribbons') out.push(l);
    else if (l.kind === 'capsules') out.push({ ...l, hatch: l.svgLayer ? 0 : hatchCaps });
    else throw new Error('the CPU export reads CPU layers; read GPU buffers with readInkLayers');
  }
  return out;
}
