/**
 * The scene description of a shell galaxy's simulated shells (ADR 0003, 0009), shared by both
 * engines: the satellite's parameters and the hand its dots are drawn with (`shellSprites`), and the
 * arcs as stroke ribbons (`shellArcs`), which v21 appends to the galaxy's curves
 * (app23.js:L1269) and which ignore the camera.
 */
import type { Params } from '../core/params';
import { packNoise, type NoiseField } from '../core/noise';
import { shellCurves, shellParamsOf, type ShellArc, type ShellParams } from '../sim/shells';
import { handArrays, type HandArrays } from './hand';
import { describeRibbons, type RibbonDesc } from './ribbons';
import type { DrawingsMeta, Variation } from './variation';

export interface ShellSceneOptions {
  /** v21's stroke rows for the arcs (replayed from `mulberry32(seed · 5 + 17)`), or the engine's draws */
  strokes?: number[];
  /** re-key the satellite's stars (the calibration of ADR 0015) */
  placementKey?: number;
  /**
   * The shells v21 found for the seed, in place of the detection's (the golden comparison draws
   * with v21's discrete choices, ADR 0018; which shells exist is structure, not marks)
   */
  arcs?: ShellArc[];
}

export interface ShellScene extends HandArrays {
  P: Params;
  p: ShellParams;
  key: number;
  meta: DrawingsMeta;
  variation: Variation;
  opts: ShellSceneOptions;
  noise: NoiseField;
}

/** The scene of the shells of `P`, drawn with `variation`'s hand. */
export function buildShellScene(
  P: Params,
  meta: DrawingsMeta,
  variation: Variation,
  opts: ShellSceneOptions = {},
): ShellScene {
  const p = shellParamsOf(P);
  return {
    P,
    p,
    key: (opts.placementKey ?? p.seed) >>> 0,
    meta,
    variation,
    opts,
    noise: packNoise(),
    ...handArrays(P, variation, meta),
  };
}

/**
 * The arcs as ribbons, drawn through a face-on camera (their points are in the plate's frame): a
 * scene with no curves of its own, `lines` 0, and no dust, whose only curves are the arcs.
 */
export function shellRibbons(scene: ShellScene, arcs: readonly ShellArc[]): RibbonDesc | null {
  if (!arcs.length || !scene.meta.strokes) return null;
  const P: Params = {
    ...scene.P,
    lines: 0,
    dust: 0,
    dustScribble: 0,
    dustLines: 0,
    incl: 0,
    az: 0,
    pa: 0,
    winding: 1,
  };
  const extra = shellCurves(arcs, scene.p, scene.meta.strokes, scene.opts.strokes);
  return describeRibbons(
    P,
    scene.variation,
    scene.meta.strokes,
    undefined,
    0,
    undefined,
    scene.noise,
    undefined,
    undefined,
    extra,
  );
}
