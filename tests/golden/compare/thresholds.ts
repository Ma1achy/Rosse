/**
 * Thresholds of the golden metric (ADR 0013 as calibrated in ADR 0015) and the pass/fail decision
 * for one case. The values live in ../thresholds.json: `parity` per preset family (the new engine
 * against v21, L2) and `strict` (the CPU engine against WebGPU, L1).
 *
 * Gated: (a) total ink, (b′) coarse density SSIM, (c) stroke widths, (d) counts, and (f) moments
 * and extent (r25, r50, r90, outer ink, axis ratio, position angle). (b), the σ = 4 px density SSIM
 * of ADR 0013, is reported but not gated (ADR 0015).
 */
import type { Comparison } from './metrics';

export interface Thresholds {
  /** |Δ total ink| / reference, at most */
  ink: number;
  /** coarse density-map SSIM (b′), at least */
  ssimCoarse: number;
  /** |Δ median stroke width| / reference, at most */
  median: number;
  /** |Δ p90 stroke width| / reference, at most */
  p90: number;
  /** |Δ r| / r for the radii holding 25%, 50% and 90% of the ink, at most */
  r25: number;
  r50: number;
  r90: number;
  /** |Δ ink fraction beyond the reference's r90|, at most */
  outer: number;
  /** |Δ axis ratio| within the reference's r90, at most */
  q: number;
  /** |Δ axis ratio| within the reference's r50, at most */
  qInner: number;
  /** |Δ position angle| in degrees, at most; gated only where the reference's axis ratio < paBelowQ */
  pa: number;
  paBelowQ: number;
  /** |Δ count| / reference per class, at most (classes of 100 marks or more) */
  counts: number;
  /** the same for classes under 100 marks */
  countsSmall: number;
  /**
   * Poisson allowance, for classes the reference counts below `poissonBelow`: a count may also
   * differ by up to `poisson` · √(reference + render), three standard deviations of the
   * difference of two Poisson counts. The reference's counts are one random draw: a class
   * expected to hold 0.5 marks holds 0, 1 or 3 of them in v21. 0 for strict. Where the reference
   * has none of a class, the render must have none.
   */
  poisson: number;
  poissonBelow: number;
}

export interface ThresholdFile {
  strict: Thresholds;
  parity: Record<string, Thresholds>;
}

export interface Evaluation {
  pass: boolean;
  failures: string[];
  /** per class: reference, render, relative difference, and the largest |Δ| allowed */
  counts: Record<string, { ref: number; render: number; rel: number; allowed: number }>;
}

/** The largest count difference allowed for a class with `ref` marks in the reference. */
export function countAllowance(ref: number, render: number, t: Thresholds): number {
  if (ref === 0) return 0;
  const relative = (ref < 100 ? t.countsSmall : t.counts) * ref;
  const poisson = ref < t.poissonBelow ? t.poisson * Math.sqrt(ref + render) : 0;
  return Math.max(relative, poisson);
}

export function evaluate(
  c: Comparison,
  refCounts: Record<string, number>,
  renderCounts: Record<string, number>,
  t: Thresholds,
): Evaluation {
  const failures: string[] = [];
  const pct = (x: number) => `${(100 * x).toFixed(2)}%`;
  const within = (name: string, x: number, limit: number, fmt = pct) => {
    if (!(Math.abs(x) <= limit)) failures.push(`${name} ${fmt(x)} (±${fmt(limit)})`);
  };
  within('ink', c.inkRel, t.ink);
  if (!(c.ssimCoarse >= t.ssimCoarse))
    failures.push(`coarse ssim ${c.ssimCoarse.toFixed(4)} (≥ ${String(t.ssimCoarse)})`);
  within('median width', c.medianRel, t.median);
  within('p90 width', c.p90Rel, t.p90);
  within('r25', c.r25Rel, t.r25);
  within('r50', c.r50Rel, t.r50);
  within('r90', c.r90Rel, t.r90);
  within('outer ink', c.outerDiff, t.outer);
  within('axis ratio', c.qDiff, t.q, (x) => x.toFixed(4));
  within('inner axis ratio', c.qInnerDiff, t.qInner, (x) => x.toFixed(4));
  if (c.ref.q < t.paBelowQ) within('position angle', c.paDiff, t.pa, (x) => `${x.toFixed(2)}°`);
  const counts: Evaluation['counts'] = {};
  for (const k of Object.keys(refCounts)) {
    const ref = refCounts[k] ?? 0;
    const render = renderCounts[k] ?? 0;
    const rel = ref === 0 ? (render === 0 ? 0 : Infinity) : (render - ref) / ref;
    const allowed = countAllowance(ref, render, t);
    counts[k] = { ref, render, rel, allowed };
    if (Math.abs(render - ref) > allowed)
      failures.push(`${k} ${String(render)} vs ${String(ref)} (±${allowed.toFixed(1)})`);
  }
  return { pass: failures.length === 0, failures, counts };
}
