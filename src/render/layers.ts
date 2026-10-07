/**
 * The ordered list of ink layers, the equivalent of the reference's `scene()` (app23.js:L1289):
 * deep-field dots, background drawings, envelopes and whole drawings, shells, arm ribbons, vector
 * lines, pieces, stipple by population, knots, stars, bars, rings, cores, arcs, companions,
 * penlines, front drawings, foreground stars, trails. Each layer names its atlas or segment
 * buffer, its population (for the colour plates) and its ink-edge thresholds.
 *
 * M1 has bitmap sprite layers; M2 adds sprites written by compute passes (`gpu-sprites`); M4 adds
 * textured stroke ribbons and pen-line capsules, as CPU arrays (the CPU engine) or GPU buffers
 * written by compute/ribbons.wgsl (the WebGPU engine); M5 adds the placed vector drawings' capsules
 * (compute/vector-expand.wgsl), drawn indirectly after their compaction.
 */
import type { AtlasName } from '../marks/atlas';
import type { Instance } from '../marks/instance';
import type { Pop } from './plates';
import type { GpuInstances } from './sprites';

/** What every layer carries: its weight and the population it is inked as (the plates' ink). */
interface LayerBase {
  /** the reference's uGain (1 for the key ink) */
  gain: number;
  /** the population: the colour plate's ink for the layer; the line work, when absent */
  pop?: Pop;
  /**
   * The SVG export's layer for this layer's marks (src/extras/export/svg.ts), when its atlas does
   * not say: M7's sky (the deep field's dots and drawings, the foreground stars) sets
   * `'background'`. A layer that names one sends all its marks there; a capsule layer that does not
   * is the hatching and the placed drawings (assigned by their drawings). No effect on drawing.
   */
  svgLayer?: 'background' | 'drawings' | 'arms' | 'dust' | 'cores' | 'knots' | 'dots' | 'stars';
}

export interface SpriteLayer extends LayerBase {
  kind: 'sprites';
  atlas: AtlasName;
  instances: readonly Instance[];
}

/** Sprites written on the GPU by a compute pass and drawn indirectly (WebGPU engine only). */
export interface GpuSpriteLayer extends LayerBase {
  kind: 'gpu-sprites';
  atlas: AtlasName;
  source: GpuInstances;
}

/** Textured ribbon segments (RIBBON_SEG_LAYOUT), CPU engine. */
export interface RibbonLayer extends LayerBase {
  kind: 'ribbons';
  atlas: 'strokes';
  segs: Float32Array;
  segsU: Uint32Array;
  count: number;
}

/** Textured ribbon segments in a GPU buffer, `count` of them (WebGPU engine). */
export interface GpuRibbonLayer extends LayerBase {
  kind: 'gpu-ribbons';
  atlas: 'strokes';
  buffer: GPUBuffer;
  count: number;
}

/** Pen-line capsules (CAPSULE_LAYOUT), CPU engine. */
export interface CapsuleLayer extends LayerBase {
  kind: 'capsules';
  caps: Float32Array;
  count: number;
}

/**
 * Pen-line capsules in a GPU buffer (WebGPU engine): `count` of them, or (M5) as many as the
 * indirect draw arguments `[6·n, 1, 0, 0]` at `indirect` say, written by a compaction, with
 * `count` the buffer's capacity.
 */
export interface GpuCapsuleLayer extends LayerBase {
  kind: 'gpu-capsules';
  buffer: GPUBuffer;
  count: number;
  indirect?: GPUBuffer;
  /**
   * More capsule buffers of the same layer, unioned with the first (ADR 0019): v21 expands every
   * vector drawing, the hatching and the placed parts alike, into one line buffer, so their
   * quads are one union per sample.
   */
  more?: { buffer: GPUBuffer; count: number; indirect?: GPUBuffer }[];
}

export type InkLayer =
  SpriteLayer | GpuSpriteLayer | RibbonLayer | GpuRibbonLayer | CapsuleLayer | GpuCapsuleLayer;
