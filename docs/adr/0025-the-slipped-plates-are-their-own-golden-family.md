# 25. The slipped plates are their own golden family

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Adds a family to the thresholds of [0015](0015-golden-metric-as-calibrated-in-m2.md) by the rule of that ADR; it changes no other family, and no code of the metric.

## Context

The golden comparison works on the ink's α (ADR 0013). On the `slip` plates (ADR 0024) v21's α is the union of four prints of every mark: the three process plates, each slipped by a few pixels and printed light, and the key ink. So the image the metric sees is the same galaxy's stipple, four times over, offset.

The first full runs of `Plates slipped` against the `spiral` family failed the coarse SSIM at home: 0.862 and 0.872 (seeds 7 and 4242) against 0.89, and 0.813 at the zoom camera against 0.85. Everything else of those cases passed, and the engine's pen, offsets and gains are v21's (tests/unit/plates.test.ts, as ink images). The cause is the measure and not the engine: the **same galaxy, re-drawn by the engine with another placement key**, scores 0.869 to 0.873 against its own first draw with the plates slipped, and 0.926 to 0.933 with the plates `ink`. A galaxy printed four times offset has a noisier density map, so two independent draws of it agree less in structure, in v21 and in the engine alike. A band calibrated on `ink` plates cannot be right for it.

## Decision

1. **`Plates slipped` is a golden family, `slip`** (and `slip@zoom` for the zoom camera, as every family has). `goldenFamily` returns it for that preset. Its thresholds are calibrated by ADR 0015's rule (1.5 × the 95th percentile of the re-draw spread, with the ink and widths floored at ±5% and ±10%, the coarse SSIM at its 5th percentile minus 0.02, per-preset axis-ratio tolerances), on `Plates slipped` alone: the six captures at seeds 7 and 4242, and held-out seeds 3, 11, 5 and 19 at home, an orbit and zoom 2, each with 3 re-keys, and every negative control.
2. **The calibration is run for this family alone**, with `npm run golden -- --calibrate --only-family slip`, which merges the family into `thresholds.json` and `calibration.json` and leaves every other family as it is. M6 does not recalibrate the other families: M4's and M5's review changes to the comparison are still to be merged.
3. **`Stellar populations` stays in `spiral`.** Its α is the plain stipple, and its colour plate's inks do not reach the α the metric reads. They are tested as ink images (tests/unit/plates.test.ts).

## Consequences

| | `spiral` | `slip` | `spiral@zoom` | `slip@zoom` |
| --- | --- | --- | --- | --- |
| coarse SSIM of re-draws, median (p5) | 0.935 (0.916) | 0.872 (0.849) | 0.918 (0.876) | 0.852 (0.809) |
| coarse SSIM band | ≥ 0.89 | ≥ 0.82 | ≥ 0.85 | ≥ 0.78 |
| r50 band | ±4.3% | ±3.0% | ±4.3% | ±3.7% |

- The slipped plates' band is lower in the coarse SSIM, where the image really is noisier, and no wider in the ink and radii.
- The negative controls (ADR 0015) are caught as the spirals' are. On the slipped plates, a turned plate (±30°, 90°), an orbit and a truncated disc (RMAX 4.2) are caught in every configuration, and bigger dots in all 12. A halo removed or a disc three times thicker is caught in 1 and 2 of 12, as in `spiral` (13 and 25 of 88): the stipple of a spiral hardly shows either.
- If the owner rejects the family, `Plates slipped` falls back to `spiral`, and its home and zoom cases fail by construction on the coarse SSIM until the comparison changes.
