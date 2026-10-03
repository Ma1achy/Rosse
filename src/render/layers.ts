/**
 * The ordered list of ink layers, the equivalent of the reference's `scene()` (app23.js:L1289):
 * deep-field dots, background drawings, envelopes and whole drawings, shells, arm ribbons, vector
 * lines, pieces, stipple by population, knots, stars, bars, rings, cores, arcs, companions,
 * penlines, front drawings, foreground stars, trails. Each layer names its atlas or segment
 * buffer, its population (for the colour plates) and its ink-edge thresholds.
 *
 * M1 has bitmap sprite layers only.
 */
import type { AtlasName } from '../marks/atlas';
import type { Instance } from '../marks/instance';

export interface SpriteLayer {
  kind: 'sprites';
  atlas: AtlasName;
  instances: readonly Instance[];
  /** the reference's uGain (1 for the key ink) */
  gain: number;
}

export type InkLayer = SpriteLayer;
