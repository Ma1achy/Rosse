# 35. M7's calibration: the stars on, and the spread of the dots' count

Date: 2026-10-07

## Status

Proposed. Awaiting the owner's sign-off. It changes thresholds (listed below), so it is not an addendum to an Accepted ADR. It builds on [0018](0018-comparison-draws-and-the-mean-of-k-redraws.md) (the K-mean comparison and its calibration) and [0031](0031-m7-golden-cases-and-retired-overrides.md) (the cases the stars and the sky make real). It leaves the three `Edge-on with dust` cases of M5 exactly where M5's branch left them (item 4).

## Context

Merging M5's branch (3c8e9ee) into M7 turned PR #8's golden job red on 75 of 212 cases passing. Two causes, neither of them the engine:

1. **`engine-hashes.json`** (test e). It merged as a mixture of M5's hashes (made with M5's engine, whose captures have `starMix: 0`) and M7's. 128 cases reported `(e) DIFFERS`.
2. **Thresholds calibrated on captures without the stars.** M5's recalibration of `spiral` and `smooth` (11ebdfe) measured the engine's re-draw spread on drawings with `starMix: 0`, `field: 0` and `fgstars: 0`. M7's captures (ADR 0031) have them on, and the drawn stars scatter more between draws than the dots alone: 10 cases failed the coarse SSIM at the zoom camera (0.81 to 0.84 against 0.85), and a few failed a moment or an axis ratio by a hair. Besides, M7's own families (`star`, `artefact`, `layered`, `deepfield`) still had provisional thresholds, and its `layered` cases used the `spiral` bands at the zoom camera, where no zoom band existed.

The dots' count is a different matter. A count of independent proposals is Poisson or binomial, and the ADR's 3% with the Poisson allowance below 2,000 covers it. The dots are not: v21 clears the dots round each large drawn star (its breathing room, `generate()`), so how many dots remain follows where the 70 or so large stars fall, and in a bulge, where a cleared disc holds many dots, that varies by several per cent from one draw to another. Measured on `Layered: barred spiral, satellite trail`, 20 seeds, v21's capture against the mean of 6 engine draws with v21's choices: the mean difference is −0.8% (no bias), its standard deviation 4.8%; one engine draw has a standard deviation of 3.9%, so two draws of equal spread would differ by 4.2% (σ·√(1 + 1/6)). v21's own spread is at least the engine's. The 3% rule therefore fails by chance (`dots 6962 vs 6482 (±194)` at seed 7, 1.5 σ), not because marks are missing.

## Decision

1. **The dots' count tolerance is calibrated** as the other measures are (ADR 0018): per family, and per preset where it has eight or more pairs, 1.5 × the 95th percentile of |stand-in count − mean of the K draws' counts| / stand-in count, where that is wider than the ADR's 3%. It is recorded as `countsBy: { dots }` in `thresholds.json` (`evaluate` takes it for classes of 100 marks or more; the Poisson allowance below 2,000 and the small-class rule are unchanged), with the spread's summary in `calibration.json` (`countSpread`). Only the dots: knots, stars and drawn stars are counts of independent proposals.
2. **M7's families are calibrated** (ADR 0031 item 4): `star`, `artefact`, `layered`, `deepfield` and their `@zoom` variants, from M7's own cases, as 0015 and 0018 say. `npm run golden -- --calibrate --families …` now passes its families to its shards (it did not, and measured every family).
3. **`spiral` and `smooth` (and their `@zoom`) are calibrated again, with the stars on**, on M7's captures (every preset and every variant of M2 to M5 with the three overrides retired): ADR 0031 said to leave their bands and fix the engine, but the bands in question are M5's, measured on drawings without the stars, and the engine has no fault to fix; v21's stars and the engine's scatter alike. The negative controls are run on every sixth configuration, and `calibration.json` records which they catch.
4. **`Edge-on with dust` keeps M5's thresholds**: for `spiral` and `spiral@zoom`, the preset's entry in `byPreset` carries M5's family values for every measure (ink, SSIM, widths, the radii, outer ink, axis ratios, position angle) as well as its own. Only the dots' count tolerance follows the new calibration. The owner's decision on its three cases is still awaited.
5. **`engine-hashes.json` is made again** from this branch's engine (`npm run golden -- --update-engine`).

## Consequences

- A count that really is wrong is still caught: ink (±5%), the SSIM, the radii and the other classes are untouched, and a missing layer of dots shows in all of them. A mismatch of the dots alone, beyond the spread of the draws, still fails. The tolerance is wide for the families that draw many large stars (about 13% for `spiral`, `smooth` and `layered`, 4 to 17% by preset); the negative control `dot size ×1.3` is caught in every configuration of every family; `halo off` and `thick ×3` are missed in some families, as they were before (`calibration.json` lists every control and what it missed).
- Several negative controls on the `star` and `artefact` families are not caught (`halo off`, `RMAX 4.2`, `thick ×3`): they change little of a star's or an artefact's drawing. The families are judged by their SSIM, radii and counts, and by the unit tests that check the marks against v21's own code (tests/unit/stars.test.ts, sky.test.ts).
- If the owner rejects item 3, the M5 bands return, and with them 10 failing zoom cases and a few moments, which only a looser band or fewer draws of stars can fix.
