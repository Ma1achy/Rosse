/**
 * Stipple sample classes and flags, shared by the kernels (WGSL and TypeScript twins), the
 * compaction and the layer list. The WGSL twin is in src/shaders/common/stipple-types.wgsl.
 */

/** Sample classes (the low byte of `cls`). Old, disc and young are the dot populations. */
export const Cls = { old: 0, disc: 1, young: 2, knot: 3, star: 4, rstar: 5, none: 255 } as const;

/** Number of classes the compaction separates. */
export const CLASS_COUNT = 6;

/** Sample flags (bits above the class byte). */
export const SampleFlag = {
  /** a Sérsic sample: 2D, turned by `pa` only (v21 parity: app23.js:L223–233) */
  sersic2d: 1 << 8,
  /** subject to the dust optical-depth cull */
  tau: 1 << 9,
  /** a disc sample: thinned under the hatched dust lanes (inLane, app23.js:L265) */
  lane: 1 << 10,
  /** a disc, bar or ring sample: carved by the dust lines (nearDust, app23.js:L264) */
  carve: 1 << 11,
} as const;
