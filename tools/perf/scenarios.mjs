// @ts-check
/**
 * The scenarios the profiling harness measures, and the budget of docs/architecture.md they are
 * checked against. A scenario is a preset (with overrides) at a seed; the budget rows name which
 * scenarios they cover, so a milestone that lands later (the deep field, the cluster lens, the
 * mergers) adds a scenario here and a row of the report fills in.
 */

/** @typedef {{ name: string, preset: string, seed?: number, overrides?: Record<string, unknown> }} Scenario */

/** The default presets of M1–M6, as the page draws them (no overrides). */
export const SINGLE_GALAXY = /** @type {Scenario[]} */ ([
  { name: 'Grand design', preset: 'Grand design' },
  { name: 'Smooth, round', preset: 'Smooth, round' },
  { name: 'Barred spiral', preset: 'Barred spiral' },
  { name: 'Hand-drawn arms', preset: 'Hand-drawn arms' },
  { name: 'Edge-on with dust', preset: 'Edge-on with dust' },
  { name: 'Stellar streams', preset: 'Stellar streams' },
]);

/** M8: the Mice at the default horizon, and at a horizon of 30 (the long-horizon chunking). */
export const MERGER = /** @type {Scenario[]} */ ([
  { name: 'Merger: the Mice', preset: 'Merger: the Mice' },
  {
    name: 'Merger: the Mice, horizon 30',
    preset: 'Merger: the Mice',
    overrides: { mHorizon: 30 },
  },
]);

/**
 * Scenarios of later milestones, listed when their presets exist in this tree (the harness skips
 * the ones it cannot build and says so in the report).
 */
export const LATER = /** @type {Scenario[]} */ ([
  { name: 'Deep field', preset: 'Deep field' },
  { name: 'Lens: cluster', preset: 'Lens: cluster' },
]);

/**
 * docs/architecture.md, "Performance budget". `kind` says which measurement answers the row,
 * `limitMs` is the budget, and `scenarios` the scenario names it covers ('single' = SINGLE_GALAXY).
 */
export const BUDGET = [
  {
    id: 'orbit-default',
    row: 'orbit frame (view + present), default presets',
    budget: '< 4 ms GPU, 60 fps',
    limitMs: 4,
    metric: 'GPU time of the orbit frame (timestamp-query); wall clock where there is none',
    scenarios: 'single',
  },
  {
    id: 'orbit-heavy',
    row: 'orbit frame, cluster lens or deep field 1.0',
    budget: '< 8 ms GPU',
    limitMs: 8,
    metric: 'GPU time of the orbit frame',
    scenarios: ['Deep field', 'Lens: cluster'],
  },
  {
    id: 'param-single',
    row: 'parameter change (model tier), single galaxy',
    budget: '< 30 ms to first frame',
    limitMs: 30,
    metric: 'a new seed to the frame on screen (wall clock to queue completion)',
    scenarios: 'single',
  },
  {
    id: 'param-merger',
    row: 'merger parameter change',
    budget: '< 100 ms to first frame at the default horizon',
    limitMs: 100,
    metric: 'a new seed to the frame on screen',
    scenarios: ['Merger: the Mice'],
  },
  {
    id: 'cpu-orbit',
    row: 'CPU fallback orbit frame',
    budget: '< 100 ms on one core',
    limitMs: 100,
    metric: 'view + ink + composite, Node, one thread',
    scenarios: 'single',
  },
];
