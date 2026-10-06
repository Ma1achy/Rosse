# 15. The golden metric as calibrated in M2

Date: 2026-10-04

## Status

Accepted. Supersedes in part [0013](0013-golden-image-metric.md): what is not changed here still holds as 0013 states it. The overrides of the M2 acceptance captures are a separate decision, [0016](0016-m2-acceptance-overrides.md), proposed and awaiting the owner's sign-off.

## Context

ADR 0013 set the golden metric and left its thresholds provisional until M2 calibrated them on "same galaxy, other dots" pairs. M2 did, and found that parts of the metric as written cannot do their job for a stipple drawn anew:

- **(b) does not separate re-draws from changes of structure.** At σ = 4 px, a full re-draw of a stipple-only spiral scores 0.31–0.57 density-map SSIM, and a 35° orbit 0.26–0.48. ADR 0013's 0.97 came from v21's re-roll, which re-draws only part of the plate. At σ = 4 px the map still resolves single dots.
- **Density maps are nearly blind to shape.** Review found that a coarse density SSIM barely moves for real structural changes of smooth galaxies: on a coarse map the local variance is far below SSIM's C2, so the score mostly compares local means. A cigar made rounder (`bulgeFlat` 0.35 → 0.50) scored 0.936; a bigger bulge, a missing halo, a thicker disc or v21's truncation at 4.2 units passed or were caught only by total ink.
- **Single order statistics of grid distances jump.** A third of the medial-axis widths of a stipple are exactly 2.000 px; the median flipped to the next value, 2.236 (+11.8%), between two width distributions whose means differed by 2%.
- **Small counts are Poisson.** v21 drew 1 and 3 sparkle stars for `Disc, no arms` where 0.5 are expected; no relative tolerance covers that.
- **The engines make their random choices differently** (ADR 0005). The per-galaxy variation (the pens of the "hand", arm pitches and phases, spurs, clumps, dust patches, lopsidedness, warp) changes total ink by up to ±25% and stroke widths by up to ±30% for the same seed, which is a choice of drawings, not a defect.

## Decision

1. **Structure gate: (b′) plus the moment and extent test (f).** (b′) is the SSIM of coarse density maps (σ = 16 px, 8× downsampling to 100², 7 × 7 windows). (f) measures the ink about the plate's centre:
   - the radii holding 25%, 50% and 90% of it (relative differences);
   - the ink beyond the reference's r90 (absolute difference of fractions);
   - the axis ratio q of the second moments within the reference's r90 and within its r50 (absolute differences), with tolerances per preset where the calibration has enough re-draws of it (at least 8), because near-round galaxies are noisier in q and a family-wide value would be too wide for flat ones;
   - the position angle, with a tolerance that widens smoothly as the reference gets rounder: |Δpa| ≤ paA / (ε − ε₀), where ε = (1 − q²)/(1 + q²) is the reference's ellipticity and ε₀ the noise floor of ε itself (per preset, as for q), and no limit once that exceeds 90°, since a round galaxy has no position angle.

   Test (b) at σ = 4 px is still computed and reported, but is not gated.
2. **SSIM over windows with ink.** Windows where both maps are below 10⁻³ are left out: they score 1 for any pair of drawings.
3. **(c) as band means.** The "median" and "p90" stroke widths are the means of the 40th–60th and 85th–95th percentiles, measured on α upsampled 4× before the distance transform.
4. **(d) counts.** A class the parameters make impossible (knots with `knots: 0`, sparkle stars with `sparkle: 0`, drawn stars with `starMix: 0`) must be 0 in both drawings. Otherwise the tolerance is ±3% of v21's count (±10% under 100), or, below 2,000 in v21, 3 · √(v21 + engine) if that is larger: three standard deviations of the difference of two Poisson counts. That applies when v21 drew none too: a class expected to hold 0.5 marks is empty in about 60% of drawings, so requiring an exact 0 would fail correct engines. The cut is at 2,000 rather than 1,000 because the drawn stars of a disc galaxy (1,016–1,095 of about 11,000 proposals) are such a draw too: v21 drew 1,016 and the engine 1,095 for `Disc, no arms` seed 7, 1.8 standard deviations of the difference, which ±3% (±30) would fail. Dots (9,500) stay at ±3%. Examples, v21 against the engine: 3 against 0 is allowed 5.2; 0 against 1 is allowed 3; 720 against 774 is allowed 116; 1,016 against 1,095 is allowed 138; 9,500 against 9,500 is held to ±285.
5. **The reference's variation.** The golden runner replays v21's `makeVariation` offline, line for line on v21's own `mulberry32` stream (`tests/golden/compare/v21.ts`), and draws the comparison with it, so that both engines draw the same galaxy with the same pens and only the dots differ. This is exactly what the thresholds are calibrated on. The replay is checked against v21's own code: `armPhase`/`armProfile` evaluated verbatim from app23.js, and the hands the capture tool recorded from the page. The engine's own variation is still compared and printed, for information.
6. **Calibration.** Thresholds are 1.5 × the 95th percentile of each measure over re-draws: the new engine drawing v21's variation and re-keying its placement stream. The exceptions are ink and widths, which keep 0013's ±5% and ±10% as floors, because those also have to absorb the renderers' deliberate differences (per-drawing mipmaps, no MSAA, f16 accumulation). (b′) is gated at the 5th percentile minus 0.02. Every family with an engine is also checked against **negative controls**: the same configurations with one change each, re-keyed, which the thresholds must fail. The controls are pa ±30°, `bulgeFlat` ±0.15, `bulgeSize` × 1.5, halo off, a truncation at 4.2 units, `thick` × 3, dot size × 1.3, and the 35° orbit. Each control applies only where it changes the drawing (a disc's thickness needs a disc; a position angle needs a galaxy that is not round on the sky). The controls also include a turn of 90° and, for smooth galaxies, `bulgeFlat` + 0.1. The detection rates and the size of each control's effect against the re-draw noise are recorded in `tests/golden/calibration.json` and in docs/milestones/m2/README.md. Some controls, such as removing a 0.15 halo from a face-on spiral or tripling a spiral disc's thickness at 30°, move several measures by 2–5 times their median re-draw noise and are still **not caught at these per-measure gates**, since each measure alone stays within its 1.5 × p95 band. They are reported as such, not hidden by loosening or tightening (see Future work).
7. **The M2 acceptance overrides** are decided separately, in [ADR 0016](0016-m2-acceptance-overrides.md) (proposed).
8. **Where CPU = GPU is proven.** The stipple kernels build sine, cosine and their Gaussian from + − × (`core/f32math.ts`, `common/math.wgsl`), but still use WGSL's `log`, `exp`, `pow` and `sqrt` (a few ULP), and WGSL allows a multiply and an add to be fused. Slot-for-slot equality of the GPU and CPU outputs is proven on SwiftShader only. On other adapters the parity test (`tests/gpu/stipple.ts`) falls back to L1 as ADR 0004 defines it.

## Consequences

- A structural change that moves the ink by more than the noise of re-drawing it is caught. Changes smaller than that are not, whatever the metric; the calibration says which they are.
- Thresholds are per family and are recalibrated (`npm run golden -- --calibrate`) when an engine for a new family lands (merger, lens, star, artefact keep provisional values until then) or when the capture setup changes.
- The comparison depends on an offline replay of v21's variation. A capture of a preset whose variation the replay cannot reproduce (none today) would need its own record.

## Future work

Two ways to catch controls that move several measures by a few times their noise without any one leaving its band:

- **Compare against the mean of K re-keys.** Render the case K times with different placement keys and compare v21 with their mean. Each measure's own re-draw noise then shrinks by about √K, so the bands can tighten by the same factor.
- **A joint gate.** Combine the measures, either with a Mahalanobis distance using the re-draw covariance of the measures, or with a same-sign rule (several measures all off in the direction one structural change would push them).

Neither is implemented in M2.
## Addendum, M4 (awaiting the owner's sign-off)

The line-work of M4 brings three more discrete random choices, and a camera the M2 calibration did not cover. Each is handled as item 5 handles the variation, or as item 6 calibrates:

1. **v21's stroke choices.** v21's `curves()` picks each curve's stroke row, and which spurs are drawn, from `mulberry32(VAR.strokeSeed)`. The golden runner evaluates v21's own `curves()` (cut out of app23.js, `tests/golden/compare/v21-curves.ts`) on the replayed variation and draws with its choices (`SceneOptions.curvePicks`). A unit test checks that the engine's curves then match v21's control points to 10⁻⁹ (`tests/unit/lines.test.ts`).
2. **v21's noise field.** v21's `vnoise` and the engine's lattice noise share the interpolation and differ in their corner values (deliberate divergence 5). The runner gives the engine v21's corners (`hash2` cut out of app23.js, `tests/golden/compare/v21-noise.ts`) as tables (`SceneOptions.noise`, `NoiseField` in src/core/noise.ts, `common/noise-table.wgsl`), so flocculence, patchiness, the lanes' gaps and the hand wobble follow v21's pattern. The lattice noise's own statistics are tested against v21's separately (mean, spread, tail fractions). Without it, `Flocculent` and `Hand wobble` at the zoom camera scored a coarse SSIM of 0.82–0.86: the metric sees the pattern, which is the divergence, not a defect.
3. **The zoom camera is calibrated on its own** (`<family>@zoom` in thresholds.json): at zoom 2 the plate holds the inner 2.4 units, and the same galaxy re-drawn scatters more there (coarse SSIM p5 0.87 against 0.91 at home). The configurations are the home ones at zoom 2 plus the zoom captures, by the same rule.
