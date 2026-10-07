# M7: stars and artefacts

Drawn stars, the stars and artefacts as subjects and overlays, and the sky (deep field, foreground stars, companions) are built, with CPU twins for every kernel (`fallback/kernels/breathe.ts`, `star-marks.ts`, `sky.ts`; `model/dynvec.ts` for the dynamic rows). The decisions are ADRs 0030 to 0034; what the golden set judges, and the calibration it needed, are ADR 0035 (proposed).

## What is built

- Drawn stars (`sstars`) as a dynamic vector set fed by the stipple's compaction; v21's breathing room as a pure view filter (`compute/breathe.wgsl`).
- `starSprites` on the GPU (`compute/star-marks.wgsl`): heart, power-law glare, spikes, rings, bleed, the drawn star at the core; trails, ghosts and cosmic rays.
- Overlays with an explicit home orientation (ADR 0030, open question Q3: a deliberate divergence).
- The sky (`compute/sky.wgsl`, ADR 0032): up to 6,000 galaxies in perspective, foreground stars, companions.
- v21's quirks are kept and marked `// v21 parity` (ADR 0033, 19 places).

## Acceptance

Goldens for `Star: …`, `Artefact: …`, the four `Layered: …` presets with a galaxy and `Deep field` (60 captures, no overrides, seeds 7 and 4242, home, orbit and zoom), judged as the mean of K = 6 draws (ADR 0018), CPU against WebGPU at L1.

The merge of M5's branch had turned the golden job red (75 of 212 passing; 212 of 212 now). Root causes, none in the engine:

1. `engine-hashes.json` merged as a mixture of M5's hashes (its captures have the stars off) and M7's: 128 cases `(e) DIFFERS`. Made again.
2. M5's recalibration of `spiral` and `smooth` measured the re-draw spread without the drawn stars; with them on the spread is wider (10 cases failed the zoom SSIM). Calibrated again on M7's captures.
3. The dots' count is not a Poisson count: the dots round the large drawn stars are cleared, so it varies several per cent between draws, in v21 as in the engine (20 seeds of `Layered: barred spiral, satellite trail`: bias −0.8%, spread 4.8% against 4.2% expected). Its tolerance now comes from the spread.
4. M7's own families had provisional thresholds. Calibrated.

See ADR 0035 for the numbers, the calibration factor (3, with the results at 1.5, 2 and 2.5) and what the owner may prefer instead. `Edge-on with dust` keeps M5's thresholds exactly; its three cases await the owner's decision (M5 README).

## Decisions awaiting the owner

ADRs 0034 and 0035 (proposed); the three `Edge-on with dust` cases of M5; whether the calibration factor is 3 (shipped) or 2.
