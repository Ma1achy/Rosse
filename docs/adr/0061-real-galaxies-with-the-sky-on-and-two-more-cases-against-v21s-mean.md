# 61. The real galaxies with the sky on, and two more cases against the mean of v21's draws

Date: 2026-10-07

## Status

Proposed. Awaiting the owner's sign-off. It changes one threshold (the dots' count tolerance of the `real` family, below) and extends the list of ADR [0036](0036-v21-drawn-again-and-compared-as-its-mean.md) by two cases. It builds on [0060](0060-the-real-galaxies-are-their-own-golden-family.md) (accepted), [0035](0035-m7-calibration-with-the-stars-on-and-the-dots-count-spread.md) and 0036 (both proposed).

## Context

M12's 20 captures of 10 real galaxies were made with `starMix 0`, `field 0` and `fgstars 0`, because the engine drew no stars or sky then (ADR 0060). With M7 in the branch those overrides are not needed (ADR 0031), and M12 recorded that they retire with it. The integration made the 20 captures again without them (`npm run capture:reference -- --extra tests/golden/extra-cases.json --variants real`; the `overrides` of the ten `real` cases are gone from `extra-cases.json`, and `tests/unit/real-galaxies.test.ts` checks that the captured parameters are `fromReal`'s, exactly).

Judged against them, with the family's thresholds as ADR 0060 calibrated them (K = 6, no other change), 11 of the 20 cases fail:

| case | measure | value | band |
| --- | --- | --- | --- |
| `real-galaxy-10` s7941 home | dots | 7286 against 7776 | ±3% (233) |
| `real-galaxy-12` s6057 orbit | dots | 7077 against 7296 | ±3% (219) |
| `real-galaxy-15` s9946 home, orbit | dots | 4824 against 4994; 4048 against 4644 | ±3% (150; 139) |
| `real-galaxy-19` s1884 orbit | dots | 5829 against 6047 | ±3% (181) |
| `real-galaxy-23` s8748 home | dots | 6059 against 6442 | ±3% (193) |
| `real-galaxy-26` s7121 home | dots | 6081 against 5781 | ±3% (173) |
| `real-galaxy-3` s4288 home, orbit | dots | 5284 against 4956 | ±3% (149) |
| `real-galaxy-37` s3937 orbit | dots | 7304 against 7543 | ±3% (226) |
| `real-galaxy-6` s586 home | inner axis ratio | −0.0498 | ±0.0470 |

Every other measure of every case passes (ink, the coarse SSIM, the widths, the radii, the outer ink, the axis ratio, the position angle), and the mark counts of the other classes. The dots are the effect ADR 0035 describes: v21 clears the dots round each large drawn star, so how many remain follows where the stars fall, in a bulge several per cent from draw to draw. ADR 0060 calibrated `real` without the stars, where the count is Poisson. The sixth galaxy's miss is the same kind as the three of ADR 0036: v21's own single draw (below).

The old failure of M12 (`Real galaxy 6` at home, r50 −3.96% against ±3.90%) does not exist any more: the new capture is a different drawing (the sky is on), and its r50 is −0.0%.

`barred-spiral--knob-ring-lines` seed 7 home (M6, the line-work set) is the one case that failed in the last full run of the M7 and M8 branches, by 0.0270 against ±0.0270, and was not widened. It fails here too, and the cause is the same.

## Decision

1. **The `real` family's dots tolerance is calibrated again** with the procedure of ADR 0035 (item 1): `npm run golden -- --calibrate-counts --families real --only-family real --keys 6 --factor 2`, over the family's 40 configurations (the 20 captures and the ten galaxies' held-out seed 3, home and orbit), 3 stand-ins and 6 keys each, 120 pairs, with v21's star and sky choices replayed (`compare/v21-sky.ts`, `v21-stars.ts`). It gives 12.2% for the family (`countsBy.dots`) and, per galaxy of eight or more pairs, 7.7% (`Real galaxy 0`) to 19.3% (`Real galaxy 15`), recorded in `thresholds.json` and `calibration.json` (`countSpread`). The factor is 2, the owner's decision for every family since ADR 0035. **No other threshold of the family changes**: ink ±5%, the coarse SSIM ≥ 0.89, the widths, the radii, the outer ink, the axis ratios and the position angle stand as ADR 0060 has them, and all pass with the sky on.
2. **`real-galaxy-6--real__s586__home` is compared with the mean of v21's 8 draws** (ADR 0036, item 4, which announced it): `tests/golden/v21-redraws.json` lists it, `capture:reference --redraws` drew its other 7. The tool did not carry a real galaxy's index into the re-draws (it drew the default galaxy for them); it does now. Against the mean every measure of the case is inside its band (the ink −1.3%, the coarse SSIM 0.960, the radii within 0.4%, the axis ratio 0.002); every case of the family passes.
3. **`barred-spiral--knob-ring-lines__s7__home` is compared the same way.** Against its single capture the axis ratio is 0.027033 (band 0.027; M6's CI passed it at 0.026845 on main: M7 draws the ring knots' stars, 334 more capsules, and the measure moves by 0.0002, well inside its draw-to-draw spread; the six engine keys give 0.0217 to 0.0377). Against the mean of v21's 8 draws it is 0.0003. v21's own draws differ from each other by far more than the band, so its single capture is not a better reference than the mean; the band is not touched (the owner's rule for this case).
4. **The sky is on for the real galaxies**: the captures, `extra-cases.json` and the family's cases have no overrides.

## Consequences

- The integration's one full golden run (`npm run golden -- --update-engine`, 440 required cases, 7,059 s) passed 419 of them before items 2 and 3 were applied; the other 21 were the 20 real cases (their engine hashes were those of the old captures; made again) and `knob-ring-lines` (above). With the hashes made again, the dots' tolerance and the two lists in place, those 21 cases pass (`npm run golden -- --only real-galaxy,barred-spiral--knob-ring-lines__s7__home`: 21 of 21, 508 s). Nothing else was re-measured: no engine output changed between the two runs.
- A real galaxy whose dots are wrong by 12% or more still fails; ink, the SSIM and the other counts catch a missing layer of dots as before. The tolerance is as wide as the other families that draw many large stars (about 13%).
- Two more cases are compared with the mean of v21's draws: five in all, ADR 0036's three and these two (`tests/golden/v21-redraws.json`). If the owner would rather not, a name comes off the list and its case fails by v21's single draw, with the numbers above.
- The real family is still calibrated on the engine's re-draws only (`v21Reroll: null`); v21's held-out captures of other galaxies remain for the owner to ask for.
- Everything here is on SwiftShader; real hardware is the recalibration of docs/open-questions.md Q14.
