# 52. The overrides of the M9 acceptance captures

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Follows the pattern of [0016](0016-m2-acceptance-overrides.md) and [0022](0022-m5-acceptance-overrides.md) (proposed), which it does not change.

## Context

The roadmap's M9 acceptance compares the six `Lens: …` presets, `A sketch, lensed` and `Layered: lensed merger` with v21, at seeds 7 and 4242 and the home and orbit cameras. With the presets as they are, v21 still draws ink that M9 does not:

- drawn stars among the dots (`starMix`: the vector `sstars` sheet, placed by `generate()`'s `rstar`, and the quasar's own drawn star, M7);
- the deep field of background galaxies (`field`, M7). `Lens: galaxy cluster` sets it to 0.85 and `A sketch, lensed` to 0.5; the cluster's field is also weakly lensed (app23.js:L1273–1278), which needs it;
- foreground stars (`fgstars`, M7), which every preset inherits from the default of 0.3;
- `Layered: lensed merger` needs the merger (M8).

A comparison with that ink in the reference but not in the render fails on total ink and structure for reasons unrelated to the lens.

## Decision

The M9 captures (`tests/golden/extra-cases.json`, variant `lens`) set, on every case:

- **`starMix: 0`, `field: 0`, `fgstars: 0`**, as ADR 0016 does for the stipple, ADR 0022 for the vector marks. The drawn stars of ring knots and clumps stay, as there: both engines classify and count them (`rstars`), and M7 draws them. So do the quasar's, which the engine counts but does not yet draw.

`Layered: lensed merger` is left for after M8 merges (the merger is its subject).

Nothing else is overridden. In particular these stay on: the lens itself (halos, shear, the cluster's members drawn in, the double ring); the source galaxies' stipple, knots, curves, drawn cores and drawings; the quasar and its time-delay flare; the main galaxy's own marks.

The weak lensing of the deep field is not exercised by these captures. It is `weakLensing` in src/sim/lens.ts, written as the M7 deep field's hook and tested against v21's own block (tests/unit/lens-weak.test.ts), and M7's cluster golden, without the `field` override, is where it will be seen.

## Consequences

- M9's acceptance covers every part of the lens through the full chain (solver, queries, emission, curves, drawings), at two cameras and two seeds, for seven presets.
- When M7 draws drawn stars, the deep field and foreground stars, the lens goldens use the full presets, and these variants stay as regression cases for the lens.
- If the owner rejects the overrides, M9's acceptance falls back to the full presets, which fail by construction until M7 (and M8 for the lensed merger).
