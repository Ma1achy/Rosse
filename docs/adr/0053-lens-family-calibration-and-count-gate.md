# 53. The lens family's calibration and its count gate

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Applies the procedure of [0015](0015-golden-metric-as-calibrated-in-m2.md) and [0018](0018-comparison-draws-and-the-mean-of-k-redraws.md) to the `lens` family, whose thresholds were provisional, and changes one number those ADRs set (the Poisson multiplier of the count gate), for that family only. Nothing in either ADR is changed.

## Context

The `lens` row of `thresholds.json` held the provisional values every family without an engine has (ink ±5%, coarse SSIM ≥ 0.85, 10% for the radii, `poisson` 3). M9 gives the family an engine, and its first comparison (28 captures, 6 draws each) passed 26 cases. The two that failed did so on the **count of knots**:

- `Lens: a quad`, seed 7, home: 137 against v21's 193 (allowed ±54);
- `Lens: Einstein ring`, seed 7, home: 110 against 160 (allowed ±49).

Nothing else failed. The ink, the structure, the radii, the axis ratios and the widths agreed everywhere, and the other 26 counts of knots did too. It was not clear whether the engine made too few knots or the gate was too tight, so it was measured. For `Lens: Einstein ring` and `Lens: giant arc`, seeds 1–24, home camera, with the M9 overrides (ADR 0052), v21 and the engine (3 placement keys each, v21's lens picks):

| | v21: mean (sd) | engine: mean (sd) | correlation across seeds | sd of v21 − engine mean |
| --- | --- | --- | --- | --- |
| `Lens: Einstein ring`, knots | 167.2 (38.3) | 169.2 (44.0) | 0.83 | 24.9 |
| `Lens: giant arc`, knots | 139.4 (30.4) | 139.9 (32.7) | 0.85 | 17.6 |
| `Lens: Einstein ring`, dots | 12,502 (30) | 12,492 (17) | | |
| `Lens: giant arc`, dots | 12,498 (31) | 12,499 (18) | | |

The engine makes as many knots as v21 and follows v21 seed by seed. The spread of v21's draw about the engine's mean is larger than that of two Poisson counts: the standardised difference (v21 − engine) / √(v21 + engine) has a standard deviation of 1.27 over the 48 (preset, seed) pairs (its maximum is 3.11), against 0.82 for Poisson counts with the engine side a mean of K = 3 draws. A lensed source's knots arrive in groups (the knots on an arm, each seen in several images), so they are over-dispersed. The gate, 3 × √(v21 + engine), is 2.4 of the observed standard deviations: it would fail about one case in 60 by chance, about one run in two over 28 cases.

## Decision

1. **The `lens` family is calibrated** by the procedure of 0018 (`npm run golden -- --calibrate --only-family lens --controls-every 2`): 28 configurations (7 presets, 2 seeds, home and orbit), each against 3 stand-ins for v21 and the mean of 6 keys, and the negative controls on every second configuration. The other families' rows are untouched (`--family` merges its result into `thresholds.json` and `calibration.json`). The row is no longer provisional.
2. **The family's count gate uses `poisson` 4.5**, not 3 (3 × 1.5, 1.5 being the over-dispersion measured above, 1.27 / 0.82 = 1.56, rounded down). That is 3.5 of the observed standard deviations, the same 0.05% per case that 3σ gives for Poisson counts. It applies to the counts below 2,000, as before (`poissonBelow`): knots, sparkle stars and drawn stars. The dots' ±3% is not changed (their observed spread is 0.21, far below Poisson).
3. **The new negative controls** (`lensR` × 1.12, `lensSize` × 1.4, `lensStars` × 0.5, `lensShear` + 0.1, `lensSrc` + 0.25) are recorded with the others. Which are caught is in `calibration.json`. The controls that are not lens parameters (`halo off`, `bulgeFlat`, `RMAX 4.2`) change nothing a lens preset draws, since the galaxy at the centre is not drawn, and are not expected to be caught there.

## Consequences

- A lens whose knots were wrong by a factor 0.7 or less (or 1.4 or more) still fails; one wrong by 10% does not, which is also true of the unlensed families' gates at their ±3% over 2,000 and 3σ below it.
- The count gate of a lens case at 6 draws has a margin of about 1.5 standard deviations of the observed spread. If a later milestone makes knots more regular (the sources' own knots are the engine's, ADR 0051), the multiplier can come back down with the same measurement.
- M7 (drawn stars, the deep field) and M8 (the lensed merger) add ink to these captures when their overrides come off (ADR 0052). The family is then re-calibrated, as `--family lens` allows without touching the others.
