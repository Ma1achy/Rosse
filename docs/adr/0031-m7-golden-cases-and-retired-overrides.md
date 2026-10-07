# 31. M7's golden cases, and the retired overrides of M2 to M5

Date: 2026-10-06

## Status

Accepted (the owner's brief for M7). Supersedes the `starMix`, `field` and `fgstars` overrides of [0016](0016-m2-acceptance-overrides.md), of M4's `ribbons` cases ([0020](0020-m4-acceptance-overrides.md) on the M4 branch) and of [0022](0022-m5-acceptance-overrides.md); everything else those ADRs override stays. Extends [0021](0021-goldens-drawn-with-v21s-part-picks.md) and ADR 0018 (on the M4 branch) to the stars and the sky.

## Context

M2 to M5 compared v21 with the new engine on cases that switched off three things v21 draws and the engine could not yet: the drawn stars among the dots (`starMix: 0`), the deep field (`field: 0`) and the foreground stars (`fgstars: 0`). They were proposed as overrides, awaiting sign-off, and each milestone's acceptance said which cases they made possible.

M7 builds all three (and the star and artefact subjects), so the reason for the overrides is gone, and the cases they shaped are the real parity test of M2 to M6: a drawn star is the biggest single mark in most galaxies (1,500 of 11,000 proposals at the defaults, each a drawing of 30 to 60 pen segments), and the deep field adds ink where the galaxy has none.

## Decision

1. **The three overrides are removed** from every case of `tests/golden/extra-cases.json` (the `stipple`, `stipple-arms`, `ribbons` and `vectors` variants) and the cases are captured from v21 again with the stars and the sky on (124 captures). Every other override stays, with its reason: `lines`, `knots` and `envelope` 0 on the M2 stipple cases (the roadmap's M2 acceptance), `jet: 0` on the Sérsic `Radio jet`, `vary` and `dustScribble` 0 on the arms case, `bubbles`, `whole` and `envelope` 0 and the ribbon styles on M4's, the drawn shells on `Shell galaxy`. Those that keep a part off do so because a later milestone's own cases draw it, not because the engine cannot.
2. **M7's cases are `tests/golden/m7-cases.json`**, a file of their own (the shared `extra-cases.json` stays small and mergeable): `Star: bright, with spikes`, `Star: faint`, `Artefact: satellite trail`, `Artefact: ghost reflection`, `Artefact: cosmic rays`, `Layered: spiral beside a bright star`, `Layered: barred spiral, satellite trail`, `Layered: edge-on, star on top`, `Layered: ringed galaxy, ghost reflection` and `Deep field`, with **no overrides**, at seeds 7 and 4242 and the home, orbit and zoom cameras (60 captures). `Layered: lensed merger` waits for M8 and M9. Their variants are `stars`, `layered` and `sky`.
3. **The comparison draws with v21's choices**, as for the hand, the strokes, the dust, the ring knots and the parts (ADR 0015, 0018, 0021): the star and artefact picks (`SceneOptions.starPicks`, replayed by tests/golden/compare/v21-stars.ts from v21's own `starSprites`, evaluated as written with a few statements of record added at its draws) and the sky's catalogue (`SceneOptions.sky`, from v21's own `buildSky` and `skyParts`, v21-sky.ts), and the overlays' home orientation (ADR 0030). Only the marks differ: the glare's dots, the spikes', the deep field's dots. tests/unit/stars.test.ts and sky.test.ts check, against v21's own code, that with its choices the engine makes v21's marks (the same counts of every class where v21's count is certain, the same within 4 σ where it is random; the same drawings, positions and matrices for the deep field's rows) and that the engine's own picks have v21's distributions over 2,000 seeds, including the loops whose bound v21 draws afresh at every test (ADR 0033).
4. **Families.** The golden family of a preset (thresholds.json `parity`): `star`, `artefact`, `layered` (the four layered presets with a galaxy) and `deepfield`, each with its `@zoom` variant, calibrated as ADR 0015 and 0018 say (1.5 × the 95th percentile of the engine's re-draws; negative controls), from M7's own cases only (`npm run golden -- --calibrate --families star,artefact,layered,deepfield`, which merges into thresholds.json and calibration.json and leaves the other families as they are). The calibration of `spiral` and `smooth` is **not** redone: their cases are judged by the bands they have, and where a case fails the engine is fixed, not the band.
5. **Impossible classes.** A class the parameters make impossible must be 0 in both drawings (`impossibleClasses`): a star or an artefact always has a drawn star (its core), a star's heart is knots, a ring's knot clusters and any overlay add drawn stars and knots; sparkle stars are a galaxy's alone.

## Consequences

- M2 to M6's cases now pass or fail with drawn stars, the deep field and the foreground stars on; docs/milestones/m7/README.md reports which fail and why.
- The old captures are replaced, not kept: their pixel hashes in the manifest change, and so do the engine's own goldens (`engine-hashes.json`) for every case.
- The v21 captures of M4's and M6's branches that carry the same overrides are re-made the same way when those branches are merged (`npm run capture:reference -- --extra tests/golden/<file>`), which takes minutes.
