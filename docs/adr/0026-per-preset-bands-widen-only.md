# 26. Per-preset bands for the radii, the position angle and the axis ratio: widen-only

Date: 2026-10-07

## Status

Proposed. Records the owner's decision of 2026-10-07 (option A, below). It amends how the thresholds of [0015](0015-golden-metric-as-calibrated-in-m2.md) are calibrated; it does not edit that ADR, which stays as accepted.

## Context

With the M5 goldens compared as ADR 0018 sets out (v21 against the mean of 6 engine draws), 149 of the 152 required cases passed. The three failures were all `Edge-on with dust`, each one measure just past its band:

| case | measure | difference | band |
| --- | --- | --- | --- |
| s4242 home | r25 | +3.41% | ±3.00% |
| s4242 orbit | position angle | 1.53° | ±1.45° |
| s7 orbit | axis ratio | −0.0308 | ±0.030 |

They are not caused by the vector marks (the M5 README shows the s7 orbit difference is the same to four places with every part removed). They sit inside the preset's own re-draw spread: a flat galaxy's r25, position angle and axis ratio scatter more between re-draws than the family's bands, which are 1.5 × the 95th percentile over every spiral, allow.

## Decision

Option A of the three put to the owner, chosen on 2026-10-07: widen the per-preset bands for the radii, the position angle and the axis ratio where the preset's own spread needs it.

For a preset (with at least 8 re-draw pairs, and not where held-out v21 captures set the family's bands), the band for each of r25, r50, r90, the axis ratio q and the position angle (its constant `paA`) is the larger of

- the band that applies to the preset now (the family's; for q the preset's own, which ADR 0015 already sets per preset), and
- 1.5 × the preset's own largest re-draw spread of that measure (the maximum over its pairs of |Δ|; for the position angle, of |Δpa| × (ε − paEps0), with the preset's own `paEps0`).

It is widen-only: an entry is written only where the second exceeds the first, so no band is narrower than before, and no other threshold (ink, SSIM, median, p90, outer ink, `qInner`, `paEps0`, counts) changes. `tests/golden/compare/compare.mjs` derives it from the shards; nothing is hand-edited in `thresholds.json`.

## Consequences

- The three cases pass: 152 of 152 required cases. The thresholds were recalibrated with `npm run golden -- --calibrate --reuse-shards`, from the same measurements (the shards of the last calibration), so only the bands above moved.
- Negative controls, re-run from the same shards against the new thresholds: detections over the 399 applicable (control, configuration) pairs went from **253 to 249**. Four controls each lose one configuration: spiral `halo off` 2/28 to 1/28, spiral `thick ×3` 8/28 to 7/28, spiral `bulgeSize ×1.5` 1/10 to 0/10, spiral@zoom `halo off` 3/13 to 2/13. All four were already weak (mostly missed); every other control keeps its count, and those caught in every configuration still are. The cost of the rule is a slightly coarser test for flat galaxies, in measures where their own noise already hid such a change.
- The widening is calibrated on SwiftShader (software) re-draws. The owner will re-run the calibration on their own MacBook (real GPU) afterwards, as listed in docs/open-questions.md and the M10 row of docs/roadmap.md, so the bands rest on real-hardware spreads; this ADR's numbers are then replaced by that run's.
