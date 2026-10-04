/**
 * Thresholds of the golden metric (ADR 0013) and the pass/fail decision for one case. The values
 * live in ../thresholds.json: `parity` per preset family (the new engine against v21, L2),
 * calibrated in M2, and `strict` (the CPU engine against WebGPU, L1).
 */
import type { Comparison } from './metrics';

export interface Thresholds {
  /** |Δ total ink| / reference, at most */
  ink: number;
  /** density-map SSIM, at least */
  ssim: number;
  /** coarse density-map SSIM (b′), at least */
  ssimCoarse: number;
  /** |Δ median stroke width| / reference, at most */
  median: number;
  /** |Δ p90 stroke width| / reference, at most */
  p90: number;
  /** |Δ count| / reference per class, at most (classes of 100 marks or more) */
  counts: number;
  /** the same for classes under 100 marks */
  countsSmall: number;
  /**
   * Poisson allowance: a count may also differ by up to `poisson` · √reference. The reference's
   * counts are one random draw: a class expected to hold 0.5 marks holds 0, 1 or 3 of them in v21
   * (sparkle stars of `Disc, no arms`), which no relative tolerance covers. 0 for strict.
   */
  poisson: number;
}

export interface ThresholdFile {
  strict: Thresholds;
  parity: Record<string, Thresholds>;
}

export interface Evaluation {
  pass: boolean;
  failures: string[];
  /** per class: reference, render, relative difference */
  counts: Record<string, { ref: number; render: number; rel: number; limit: number }>;
}

export function evaluate(
  c: Comparison,
  refCounts: Record<string, number>,
  renderCounts: Record<string, number>,
  t: Thresholds,
): Evaluation {
  const failures: string[] = [];
  const pct = (x: number) => `${(100 * x).toFixed(2)}%`;
  if (!(Math.abs(c.inkRel) <= t.ink)) failures.push(`ink ${pct(c.inkRel)} (±${pct(t.ink)})`);
  if (!(c.ssim >= t.ssim)) failures.push(`ssim ${c.ssim.toFixed(4)} (≥ ${String(t.ssim)})`);
  if (!(c.ssimCoarse >= t.ssimCoarse))
    failures.push(`coarse ssim ${c.ssimCoarse.toFixed(4)} (≥ ${String(t.ssimCoarse)})`);
  if (!(Math.abs(c.medianRel) <= t.median))
    failures.push(`median width ${pct(c.medianRel)} (±${pct(t.median)})`);
  if (!(Math.abs(c.p90Rel) <= t.p90)) failures.push(`p90 width ${pct(c.p90Rel)} (±${pct(t.p90)})`);
  const counts: Evaluation['counts'] = {};
  for (const k of Object.keys(refCounts)) {
    const ref = refCounts[k] ?? 0;
    const render = renderCounts[k] ?? 0;
    const rel = ref === 0 ? (render === 0 ? 0 : Infinity) : (render - ref) / ref;
    const limit = ref < 100 ? t.countsSmall : t.counts;
    const ok =
      Math.abs(rel) <= limit || Math.abs(render - ref) <= t.poisson * Math.sqrt(Math.max(ref, 1));
    counts[k] = { ref, render, rel, limit };
    if (!ok)
      failures.push(`${k} ${String(render)} vs ${String(ref)} (${pct(rel)}, ±${pct(limit)})`);
  }
  return { pass: failures.length === 0, failures, counts };
}
