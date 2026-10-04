# 13. Golden images are compared on ink distribution, pen weight and counts, not pixels

Date: 2026-10-03

## Status

Accepted. The thresholds are provisional until calibrated in M2.

## Context

The new engine is not sample-exact with the reference (ADR 0005). Its dots, about 2–3 px across and placed randomly, land elsewhere. Pixel-exact comparison fails by construction. Plain SSIM on the ink is the wrong test too: it compares local structure at the scale of its window, and at that scale the structure _is_ the random dots.

We measured this on v21 itself (seed 7, ink alpha). A 0.3° orbit re-rolls part of the stipple and changes nothing structural. A 35° orbit changes the structure for real. The results:

| preset | plain SSIM, re-roll pair | density-map SSIM, re-roll pair | density-map SSIM, 35° orbit |
| --- | --- | --- | --- |
| Grand design | 0.75 | 0.97 | 0.41 |
| Barred spiral | 0.81 | 0.98 | 0.50 |
| Flocculent | 0.70 | 0.97 | 0.37 |

The re-roll pairs also differ in total ink by only 0.01–0.4%. Plain SSIM penalises equally valid drawings by 20–30%, even though only part of the plate was re-drawn (the parts, ribbons and deep field stay). A full re-draw, which is what the new engine is, would score far lower. The density-map SSIM separates "same galaxy, other dots" (0.97–0.98) from "different structure" (0.37–0.50) by a wide margin. That margin is what the test relies on.

What has to match is:

- **where the ink is**, at a scale coarser than a dot: arms, bulge, bar, ring, tails, arcs;
- **how much ink** there is overall;
- **what the marks look like**: pen weight, and dots versus lines;
- **how many marks** of each kind there are.

## Decision

Comparisons work on the ink layer only. That is the canvas read back as premultiplied ink on transparent, `*.ink.png` in tests/golden/. From each image we take the alpha channel α (straight coverage, 0–1, 800 × 800 plate pixels at device pixel ratio 1) and compute four tests. Each must pass:

| # | test | measure | parity threshold (against the reference, L2) | strict threshold (engine against itself across adapters, or the CPU fallback, L1) |
| --- | --- | --- | --- | --- |
| a | **total ink** | Σα | within ±5% | within ±0.5% |
| b | **ink structure** | SSIM between _density maps_: α blurred with a Gaussian of σ = 4 plate px (wider than the dot spacing), downsampled 4× to 200 × 200, SSIM with a 7 × 7 window | ≥ τ_ref, calibrated (below); provisional 0.85 | ≥ 0.98 |
| c | **pen weight** | stroke-width distribution: distance transform of the mask α ≥ 0.5, sampled on its medial axis, ×2; compare median and 90th percentile | median and p90 within ±10% | within ±2% |
| d | **mark counts** | instances per class (dots, knots, stars, drawn stars, pieces, ribbon segments, vector drawings), from the engine's statistics and the reference's `__GEN.stats()` | within ±3% per class (±10% for classes under 100) | identical, or within ±0.1% |

Plus **(e) the engine against its own goldens on SwiftShader: bit-exact** (L0, ADR 0004).

**Calibrating τ_ref.** Two sources of "the same galaxy, drawn again with different dots":

1. **v21's own re-roll.** With dust lanes on, a 0.3° orbit re-rolls the stipple stream from the first view-dependent cull onwards (docs/reference-notes.md, flagged item 1). It is a _partial_ re-draw: parts, ribbons and the sky are unchanged. That makes it an optimistic noise floor.
2. **The new engine's placement streams.** Because of ADR 0004, the new engine can re-key only the placement streams (stipple, knots, glare), keeping every structural choice. That gives a full re-draw with the same structure, which is exactly the variation expected between v21 and the new engine.

For each preset we compute tests (a)–(c) over pairs from both sources. τ_ref is set to the 5th percentile of the full-re-draw distribution minus 0.02, per preset family (spiral, smooth, merger, lens, star, artefact), and recorded in `tests/golden/thresholds.json`. Thresholds (a) and (c) are set the same way, as the 95th percentile of their absolute differences plus a margin. The provisional τ_ref = 0.85 sits between the measured re-roll floor (0.97) and real structural change (≤ 0.50).

**Reporting.** Each failing case writes a side-by-side report to `tests/golden/diff/` (git-ignored, uploaded as a CI artifact). It contains the reference, the new render, both density maps, the signed density difference as a heat map, and the stroke-width histograms. Pull requests attach it (CONTRIBUTING.md).

## Consequences

- One misplaced drawing, such as a bar rotated 90°, may pass (b) if it carries little ink. The pen-weight and count tests catch some such cases. Visual review of the report catches the rest, which is why render diffs are attached to pull requests.
- Density maps at σ = 4 px are blind to the texture inside a stroke (beaded versus plain). Test (c) and the counts cover that partly. Stroke texture is otherwise judged by eye.
- The thresholds are empirical. They must be recalibrated, by a deliberate pull request, if the capture setup changes (browser, resolution, seeds).

## Calibration in M2 (addendum, for the owner to confirm)

The M2 calibration is in `docs/milestones/m2/README.md` and `tests/golden/calibration.json`. It changed the metric in five ways, each reasoned there: a coarse structure test (b′) at σ = 16 px, gated with (b), because at σ = 4 px a full re-draw of the stipple scores 0.3–0.6 and cannot be told from a 35° orbit; SSIM averaged over windows with ink; (c) as band means of the width distribution rather than single order statistics; a Poisson allowance of 3√n on counts against v21; and comparisons drawn with the reference's hand (its dot pool, recorded at capture). The calibrated thresholds are in `tests/golden/thresholds.json`.
