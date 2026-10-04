/**
 * The ordered list of ink layers, the equivalent of the reference's `scene()` (app23.js:L1289):
 * deep-field dots, background drawings, envelopes and whole drawings, shells, arm ribbons, vector
 * lines, pieces, stipple by population, knots, stars, bars, rings, cores, arcs, companions,
 * penlines, front drawings, foreground stars, trails. Each layer names its atlas or segment
 * buffer, its population (for the colour plates) and its ink-edge thresholds.
 *
 * M1 has bitmap sprite layers; M2 adds sprites written by compute passes (`gpu-sprites`); M4 adds
 * textured stroke ribbons and pen-line capsules, as CPU arrays (the CPU engine) or GPU buffers
 * written by compute/ribbons.wgsl (the WebGPU engine).
 */
import type { AtlasName } from '../marks/atlas';
import type { Instance } from '../marks/instance';
import type { GpuInstances } from './sprites';

export interface SpriteLayer {
  kind: 'sprites';
  atlas: AtlasName;
  instances: readonly Instance[];
  /** the reference's uGain (1 for the key ink) */
  gain: number;
}

/** Sprites written on the GPU by a compute pass and drawn indirectly (WebGPU engine only). */
export interface GpuSpriteLayer {
  kind: 'gpu-sprites';
  atlas: AtlasName;
  source: GpuInstances;
  gain: number;
}

/** Textured ribbon segments (RIBBON_SEG_LAYOUT), CPU engine. */
export interface RibbonLayer {
  kind: 'ribbons';
  atlas: 'strokes';
  segs: Float32Array;
  segsU: Uint32Array;
  count: number;
  gain: number;
}

/** Textured ribbon segments in a GPU buffer, `count` of them (WebGPU engine). */
export interface GpuRibbonLayer {
  kind: 'gpu-ribbons';
  atlas: 'strokes';
  buffer: GPUBuffer;
  count: number;
  gain: number;
}

/** Pen-line capsules (CAPSULE_LAYOUT), CPU engine. */
export interface CapsuleLayer {
  kind: 'capsules';
  caps: Float32Array;
  count: number;
  gain: number;
}

/** Pen-line capsules in a GPU buffer (WebGPU engine). */
export interface GpuCapsuleLayer {
  kind: 'gpu-capsules';
  buffer: GPUBuffer;
  count: number;
  gain: number;
}

export type InkLayer =
  SpriteLayer | GpuSpriteLayer | RibbonLayer | GpuRibbonLayer | CapsuleLayer | GpuCapsuleLayer;
