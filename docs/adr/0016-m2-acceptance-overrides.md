# 16. The overrides of the M2 acceptance captures

Date: 2026-10-04

## Status

Proposed, awaiting the owner's sign-off. Split out of [0015](0015-golden-metric-as-calibrated-in-m2.md).

## Context

The roadmap's M2 acceptance compares the stipple of `Smooth, round`, `Cigar-shaped` and `Disc, no arms` with v21, with `lines: 0, knots: 0, envelope: 0`. But with only those overrides v21 still draws ink that M2 does not:

- drawn stars among the dots (`starMix`, the vector `sstars` sheet, M5 and M7);
- the deep field of background galaxies (`field`, M7);
- foreground stars (`fgstars`, M7).

A comparison with that ink in the reference but not in the render would fail on total ink and structure for reasons unrelated to the stipple. Review also asked for stipple-only cases that exercise the Sérsic profile and the arms, which need more overrides of their own.

## Decision

The stipple-only captures (`tests/golden/extra-cases.json`, the variant `stipple`) set, besides the roadmap's `lines: 0, knots: 0, envelope: 0`:

- **`starMix: 0`, `field: 0`, `fgstars: 0`** on every case. `trails` is already 0 in these presets.
- **`jet: 0`** on `Radio jet`, the Sérsic case.
- On `Grand design`, the arms case (variant `stipple-arms`):
  - **`vary: 0`**: no spurs, clumps, dust patches, lopsidedness or warp, and every dot drawing in the hand. This was checked by replaying v21's `makeVariation`.
  - **`dustScribble: 0`**: no dust lanes.

The cases run at seeds 7 and 4242. `Smooth, round` and `Disc, no arms` also run at 3 and 11, whose v21 hands have 2 and 3 pens. Every case is captured at home and orbit.

## Consequences

- M2's acceptance covers the stipple, the Sérsic profile, the arms with their pitch and phases, the sparkle stars and the drawn core, all compared with v21.
- Drawn stars are still checked, by count, on the full captures of the three acceptance presets (ADR 0015), because v21's drawn-star count does not depend on what M2 leaves out.
- When the milestones that draw these marks land, their goldens use the full presets, and these variants stay as regression cases for the stipple alone.
- If the owner rejects the extra overrides, M2's acceptance falls back to the roadmap's three overrides. It then fails by construction until M5 and M7.
