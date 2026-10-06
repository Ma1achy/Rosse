# 23. The overrides of the M6 acceptance captures

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Follows the pattern of [0016](0016-m2-acceptance-overrides.md) and [0022](0022-m5-acceptance-overrides.md) (both proposed), which it does not change.

## Context

The roadmap's M6 acceptance compares all 18 single-galaxy presets with v21 at seeds 7 and 4242 and the home, orbit and zoom cameras, plus the Chalkboard captures:

`Grand design`, `Barred spiral`, `Flocculent`, `Hand-drawn arms`, `Tightly wound`, `Loose, open arms`, `Ringed`, `Disc, no arms`, `Smooth, round`, `Cigar-shaped`, `Edge-on with dust`, `Dusty spiral`, `Hand wobble`, `Radio jet`, `Stellar streams`, `Shell galaxy`, `Plates slipped` and `Stellar populations`.

With the presets as they are, v21 still draws ink that the engine does not, because it belongs to M7 or M8:

- drawn stars among the dots (`starMix`: the vector `sstars` sheet, placed by `generate()`'s `rstar`, M7);
- the deep field of background galaxies (`field`, M7);
- foreground stars (`fgstars`, M7);
- in `Shell galaxy`, the simulated shells (`shellsOn`: an N-body integration, M8).

A comparison with that ink in the reference but not in the render fails on total ink and structure for reasons unrelated to the single-galaxy marks.

## Decision

The M6 captures (`tests/golden/extra-cases.json`) set, after the preset and the seed:

- **`starMix: 0`, `field: 0`, `fgstars: 0`** on every case, as ADRs 0016, 0020 and 0022 do. The drawn stars of the ring knots and clumps stay: v21 draws them whatever `starMix`, both engines classify and count them (`rstars`), and M7 draws them. Nothing else is overridden: no preset's own parameter is changed, and the parts, the line work, the dust lanes, bubbles, envelopes, `Radio jet`'s jet, `Stellar streams`' streams and the plates are all drawn.
- **variant `single`** (seeds 7 and 4242; home, orbit and home at zoom 2): `Grand design`, `Flocculent`, `Tightly wound`, `Loose, open arms`, `Dusty spiral`, `Hand wobble`, `Smooth, round`, `Cigar-shaped`, `Plates slipped` and `Stellar populations`. These are the presets M2 and M4 captured with more overrides (`lines`, `knots` and `envelope` off for the smooth ones; `bubbles` off for the spirals). M6 removes those.
- **Chalkboard captures** of `Grand design`, `Plates slipped` and `Stellar populations` (seed 7, home and orbit; `capture:reference` takes `"chalk": true` per case). The ink is the same on both surfaces except on the coloured plates, whose inks differ by palette; the captures check that, and the lighter, warmer inks of the Chalkboard, as ink images (tests/unit/plates.test.ts).
- **The other eight presets** are M5's `vectors` captures, whose only overrides are these three (and `Shell galaxy`'s below): `Barred spiral`, `Hand-drawn arms`, `Ringed`, `Disc, no arms`, `Edge-on with dust`, `Radio jet`, `Stellar streams`, `Shell galaxy`. They are not captured a second time.
- **`Shell galaxy`: `shellsOn: 0`, `shells: 1`**, as ADR 0022 decides: its simulated shells are M8; its drawn part is the `shells` sheet. This is the one preset of the 18 whose acceptance remains partial until M8.
- **variants `knob-*`** (seeds 7 and 4242, home and orbit): eight single-parameter probes of the model that no preset exercises and that M12's real galaxies use (`patchy`, `irr`, `tail`, `sersicN`, `ringOnlyLines`, `dust`, `halo` with `envelope` and `outline`, `nuclear` with `whole` and `envelope`), each on the preset named in its case, with the three overrides above. They are checks for gaps, not roadmap cases.

## Consequences

- M6's acceptance covers every single-galaxy preset and every plates mode, on Paper and Chalkboard, at three cameras.
- When M7 draws drawn stars, the deep field and foreground stars, and M8 the simulated shells, the goldens of these presets use the full presets, and these variants stay as regression cases for the single galaxy.
- If the owner rejects the overrides, M6's acceptance falls back to the full presets, which fail by construction until M7 and M8.
