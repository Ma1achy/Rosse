# 20. The overrides of the M4 acceptance captures

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Follows [0016](0016-m2-acceptance-overrides.md), which decides the M2 ones.

## Context

The roadmap's M4 acceptance compares `Grand design`, `Barred spiral` (stipple part), `Flocculent`, `Tightly wound`, `Loose, open arms`, `Dusty spiral` and `Hand wobble` with v21. With their presets as they are, v21 also draws marks M4 does not build:

- drawn stars among the dots (`starMix`, the vector `sstars` sheet, M5 and M7);
- the deep field and the foreground stars (`field`, `fgstars`, M7);
- rings drawings at the clumps (`bubbles`, a vector sheet, M5);
- whole drawings and envelopes (`whole`, `envelope`, vector, M5);
- `Barred spiral`'s bar and ring as drawings (its default `barStyle` and `ringStyle`, vector, M5).

A comparison with that ink in the reference and not in the engine would fail for reasons unrelated to M4. Review (QA D3) also found that, with the stipple in, the metric hardly sees changes of the line-work at the home and orbit cameras.

## Decision

The M4 captures (`tests/golden/extra-cases.json`) set, after the preset and the seed:

- **variant `ribbons`** (seeds 7 and 4242; home, orbit, and home at zoom 2): `starMix: 0`, `field: 0`, `fgstars: 0`, `bubbles: 0`, `whole: 0`, `envelope: 0` (the last two already 0 in these presets); and, on `Barred spiral`, `barStyle: 'ribbon'` and `ringStyle: 'ribbon'`, v21's own alternative styles, which draw the bar and the ring as ribbons M4 builds while its stipple (bar, ring, ring knots) is unchanged. Not overridden: lines, knots, sparkle stars, the dust lanes with their hatching and lane cull, the carving lines, the drawn core and the hand wobble.
- **variant `lines`** (seeds 7 and 4242 gated, home and orbit; seeds 3, 11, 23 and 101 captured for the calibration only, ADR 0018): the same, and also `stipple: 0`, `knots: 0` and `sparkle: 0`, so that the line-work (curves, pieces, hatching, the drawn core, and the ring knots' and clumps' own marks) is compared on its own.

The ring knots' and clumps' drawn stars stay in both (v21 draws a ring knot's star whatever `starMix`): they are classified and counted on both sides, and not drawn until M5 and M7.

## Evidence that the line-work is tested

With the stipple in, the metric hardly sees changes of the line-work at the home and orbit cameras (QA D3). The `lines` captures were added for that. The seven source breaks of QA's table (a stroke width ×1.5, arm phase +45°, taper off, no re-spaced pieces, a lane cull radius of 0, no hatching, no clumps), each run through the CPU golden at the final thresholds, fail this many of the 14 cases per family and camera (`docs/data/m4-breaks.json`, written by `tools/m4-summary.mjs breaks`; the unbroken source fails none):

| break | `lines` home | `lines` orbit | `ribbons` home | `ribbons` orbit | `ribbons` zoom |
| --- | --- | --- | --- | --- | --- |
| stroke width ×1.5 | 13 | 14 | 1 | 0 | 6 |
| phase +45° | 14 | 14 | 2 | 1 | 11 |
| taper off | 7 | 6 | 0 | 0 | 1 |
| no re-spaced pieces | 12 | 11 | 0 | 0 | 5 |
| lane cull radius 0 | 0 | 0 | 5 | 8 | 6 |
| no hatching | 14 | 14 | 0 | 1 | 4 |
| no clumps | 14 | 14 | 14 | 14 | 14 |

Two breaks are missed by the `ribbons` cases at home and orbit, and what catches them is stated here and not left to be found:

- **No re-spaced pieces** changes little ink under the stipple (0 of 14 at home and orbit), and is caught by the `lines` cases (12 and 11 of 14) and, partly, at zoom (5 of 14).
- **The lane cull** thins about half a per cent of the marks (61 of about 11,000 for `Dusty spiral` seed 7), which the `lines` cases, with no stipple, cannot see (0 of 14), and the ink gates see in 5 to 8 of the 14 `ribbons` cases. It is guarded by a unit test of the cull itself (`tests/unit/lines.test.ts`, "the lane cull thins the stipple near the lanes"), which fails for a radius of 0.

Taper off is the weakest of the rest (6 to 7 of 14 on `lines`, 0 to 1 on `ribbons` at home and orbit): a taper changes the width of the last part of each arm, a few per cent of its ink.

The `lines` family has no negative controls of the kind the stipple families have (a change of parameter, re-keyed); these breaks are its controls.

## Consequences

- The M4 goldens test what M4 builds; the overridden marks are tested when their milestones land, with these overrides removed one by one.
- `Barred spiral`'s default look (drawn bar and ring) is not under test until M5.
- The `lines` captures are not part of the roadmap's list; they are there because the metric needs them to see the line-work (docs/milestones/m4/README.md has the breaks they catch).
