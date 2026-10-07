# 60. The real galaxies are their own golden family

Date: 2026-10-07

## Status

Accepted. The owner accepted the family and its thresholds on 2026-10-07 (the decision on the M12 review). One case still fails, and is handled as the Consequences say. Adds a family to the thresholds of [0015](0015-golden-metric-as-calibrated-in-m2.md) by the rule of that ADR, as [0025](0025-the-slipped-plates-are-their-own-golden-family.md) did for the slipped plates; it changes no other family and no code of the metric.

## Context

M12 draws the 42 real galaxies from their Galaxy Zoo 2 votes (`fromVotes`, v21's app23.js:L1321), and the roadmap asks for goldens captured from v21 for 10 of them. A real galaxy is not a preset:

- its parameters are the whole set `fromVotes` writes (arms, bar, pitch, bulge from the votes, a colour-dependent knot fraction, `rewind`, `field`, and a seed from the object id), so no preset's family or per-preset band describes it;
- the ten chosen (indices 0, 3, 6, 10, 12, 15, 19, 23, 26 and 37 of `real-galaxies.json`) are a round and a cigar-shaped elliptical, an edge-on disc with a dust lane, a ringed disc, a two-armed spiral, two barred spirals (one with a ring and a whole drawing), a spiral at 73° and an irregular. Their parameters differ from the presets' in the quantities the metric reads (axis ratio, pitch, flocculence, `bulgeFlat` from the photo's axis ratio), so a preset's per-preset band is not theirs.

The mergers (indices 34 to 36), the lensed galaxy (39) and the shells need the M8 and M9 engines, and are not in the ten.

## Decision

1. **A golden family `real`.** `goldenFamily` returns it for the captures of variant `real`. The captures are v21's, made by `capture:reference --extra … --variants real` (`"real": i` in a case: v21's `__GEN.real(i)`, then the case's overrides): ten galaxies at the one seed `fromVotes` gives each, home and orbit cameras, 20 captures, each compared three ways as every family is (WebGPU and the CPU engine against v21 at the family's parity thresholds, the CPU engine against WebGPU at the strict ones; K = 6 draws).
2. **Overrides.** Only `starMix: 0`, `field: 0` and `fgstars: 0`, the sky and the drawn stars of M7 (the overrides of ADR 0023); they retire with M7's, when the real captures are re-made without them.
3. **Calibration by ADR 0015's rule**, run for this family alone (`npm run golden -- --calibrate --only-family real --keys 6 --controls-every 3`, which merges it into `thresholds.json` and `calibration.json`): 1.5 × the 95th percentile of the re-draw spread, ink and widths floored at ±5% and ±10%, the coarse SSIM at its 5th percentile minus 0.02, with per-galaxy axis-ratio tolerances (and the widen-only bands of ADR 0026), on the 20 captures and the same ten galaxies' held-out seed 3 at home and an orbit (re-draw pairs need no v21 capture): 40 configurations, 3 stand-ins and 6 keys each, and every negative control on every third configuration.

## What the calibration is, and is not

It is calibrated **only on engine re-draws** (`v21Reroll: null`: v21 has no re-roll pairs for a real galaxy), and its 40 configurations **include the 20 gated captures themselves**; only the ten galaxies' seed 3, home and an orbit, are held out. So the thresholds are not out of sample for the cases they gate. That differs from ADR 0018 item 7, which calibrates the `lines` family on held-out v21 captures (seeds 3, 11, 23, 101) as well, and takes the wider of the re-draw and the v21-against-engine spread. The real family has no held-out v21 captures. They would be cheap to add (the capture tool takes `"real": i` with another seed, once the seed check allows it), and the owner asked for them to be made with the `Real galaxy 6` re-captures (below); until then the family is not out-of-sample and the 19 passes say less than the 19 of a family calibrated on held-out v21 captures would.

## Consequences

- The family's bands are those of a spiral's, within a few thousandths: the coarse SSIM ≥ 0.89, ink ±5%, widths ±10%, r25 ±3.2%, r50 ±3.7%, r90 ±5.0%, outer ink ±1.4 points. Numbers, the per-galaxy bands and the negative controls (a turned galaxy at ±30° and an orbit are caught in every configuration, bigger dots in all, a truncated disc in 14 of 15; a removed halo in 5 of 15, as in the other families) are in `calibration.json`.
- Against v21, 19 of the 20 cases pass (the coarse SSIM 0.91 to 0.97 against the band's 0.89). `Real galaxy 6` at home (an edge-on disc with a dust lane) misses its r50 band by 0.06 points (-3.96% against ±3.90%), as M5's `Edge-on with dust` cases miss by one moment measure; the band is not widened by hand (owner, 2026-10-07). It stays failing until the mechanism that compares against the mean of several v21 re-captures of one configuration (M7's) is in main, and is then re-checked with K ≥ 6 captures of that configuration (the capture tool's `--reroll`), with a new ADR if the comparison needs one.
- Ten real galaxies are a small sample of the 239,695 of the catalogue. They check that `fromVotes`' parameters draw as v21 draws them; they are not a calibration of every kind of galaxy the votes can describe (the star-or-artefact, merger, lensed and shell cases wait for M7 to M9).
- If the owner rejects the family, the real cases fall back to `spiral` or `smooth`, with the preset-specific bands missing, and the cases that now pass by a thousandth may fail.
- Memory, for the record (the catalogue the real galaxies are drawn from; owner decision of 2026-10-07: not shrunk): the data held is 16.3 MiB; QA measured the renderer process's RSS in headless Chromium on SwiftShader on a loaded 4-core machine (not a phone): a peak of +65 to +76 MB over baseline during the load, +58 to +71 MB after it, about +13 MB after `close()`.
