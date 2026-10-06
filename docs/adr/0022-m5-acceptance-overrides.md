# 22. The overrides of the M5 acceptance captures

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Follows the pattern of [0016](0016-m2-acceptance-overrides.md) (proposed), which it does not change.

## Context

The roadmap's M5 acceptance compares `Hand-drawn arms`, `Ringed`, `Disc, no arms`, `Barred spiral`, `Edge-on with dust`, `Radio jet`, `Stellar streams` and `Shell galaxy` (its drawn part) with v21, at seeds 7 and 4242 and the home, orbit and zoom cameras. With the presets as they are, v21 still draws ink that M5 does not:

- drawn stars among the dots (`starMix`: the vector `sstars` sheet, placed by `generate()`'s `rstar`, M7);
- the deep field of background galaxies (`field`, M7);
- foreground stars (`fgstars`, M7);
- in `Shell galaxy`, the simulated shells (`shellsOn`: `shellSprites` and `shellArcs`, an N-body integration, M8). Its drawn part is the `shells` vector sheet, which the preset leaves at 0.

A comparison with that ink in the reference but not in the render fails on total ink and structure for reasons unrelated to the vector marks.

## Decision

The M5 captures (`tests/golden/extra-cases.json`, variant `vectors`) set, on every case:

- **`starMix: 0`, `field: 0`, `fgstars: 0`**, as ADR 0016 does for the stipple and M4 for the ribbons. The drawn stars of ring knots and clumps stay: v21 draws them whatever `starMix`. Both engines classify and count them (`rstars`), and M7 draws them.

and on `Shell galaxy` only:

- **`shellsOn: 0`, `shells: 1`**: the drawn shells in place of the simulated ones, so the case exercises the preset's drawn part, the `shells` sheet, laid flat on the plate (app23.js:L1038).

Nothing else is overridden. In particular, these stay on:

- the parts M5 draws: envelopes (`Disc, no arms`), drawn arms (`Hand-drawn arms`), the drawn bar and ring (`Barred spiral`, `Ringed`), bubbles at the clumps (every preset with arms, at v21's default 0.4), the jet (`Radio jet`) and the streams (`Stellar streams`);
- what earlier milestones draw: the ribbons, the dust lanes and their hatching, the core.

`Barred spiral` is drawn with its default drawn bar and ring, where M4 compared their ribbon styles.

## Consequences

- M5's acceptance covers every part `parts()` places for these presets, through the vector expansion, at three cameras.
- When M7 draws drawn stars, the deep field and foreground stars, and M8 the simulated shells, their goldens use the full presets, and these variants stay as regression cases for the vector marks.
- If the owner rejects the overrides, M5's acceptance falls back to the full presets, which fail by construction until M7 and M8.
