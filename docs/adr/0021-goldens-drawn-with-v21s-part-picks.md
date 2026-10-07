# 21. Goldens are drawn with v21's part picks

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Extends item 5 of [0015](0015-golden-metric-as-calibrated-in-m2.md) and its M4 addendum the same way for the drawn parts of M5. It changes nothing else in 0015 or in the comparison's later changes.

## Context

M5 draws the vector parts: envelopes, whole drawings, drawn arms, bars, rings, bubbles at the clumps, arcs, shells, the tail, trails and cosmic rays, the arrow, the jet and the stellar streams. v21's `parts(r)` (app23.js:L987–1086) makes every choice about them from one sequential stream, `mulberry32(P.seed · 57 + 3)`:

- which drawing (the envelope by kind, the whole drawing by type, the arms by tightness, a non-solid bar, a ring, a bubble's curve, the nuclear spiral, the tail's and the streams' pen lines);
- spins, sizes and places (the arcs' sizes, the trails' and the arrow's plate positions, the jet's angle and length, the streams' radius, span and start);
- random gates (halo or disc, whether each arm copies the first drawing, whether each clump gets a bubble, whether the arrow is drawn).

The new engine makes the same choices with v21's rules on its counter streams (ADR 0004), each part on its own index of the `parts` stream (`PartIndex` in src/model/parts.ts), so changing one part no longer moves the others. Its picks therefore differ from v21's for the same seed. These are structural choices: a bar drawn from one drawing and a bar drawn from another carry different ink, in different places. That is the situation item 5 of ADR 0015 addresses for the variation, and its M4 addendum for the strokes and the noise. Without v21's picks, a comparison measures which drawing each engine happened to choose, not whether the engine draws a galaxy correctly.

The streams' marks are the one subtlety. v21 draws them from the same stream, between the picks of one stream and the next, and how many it draws depends on the zoom (one slot per 2.4 plate px of the bent pen line). The second stream's picks therefore depend on the zoom of the capture.

## Decision

1. **The golden runner draws with v21's part picks.** `tests/golden/compare/v21-parts.ts` replays `parts()`'s draws line for line on v21's own `mulberry32` stream, with v21's replayed variation (its clumps place the bubbles), and returns them as data (`PartPicks`). The engine lays them out with its own `vectorRows` (`SceneOptions.partPicks`). The replay walks the streams' marks' draws (the keep test, the drawing, two Gaussians, the knot test and its draws) at the capture's zoom, so the second stream's picks are v21's at that zoom.
2. **The replay is checked against v21's own code.** `v21PartsRows` cuts `parts()` and what it calls out of app23.js by name and evaluates it unchanged, as `v21-curves.ts` does for `curves()`, with the sky and the hatching stubbed out (they draw from other streams). `tests/unit/parts.test.ts` requires, on 17 configurations (the M5 presets, and parameter sets that turn every part on) at 4 cameras and zooms:
   - the same drawings in the same order;
   - the same positions and matrices to 10⁻⁶ relative;
   - the same pen scales and alphas;
   - the same rewind warps (evaluated at sample points to 10⁻⁹);
   - the same cores and nuclear spiral;
   - every one of v21's stream marks within 6.3 px (4.5 σ of its 1.4 px jitter) of the engine's streams, which holds only if the replayed stream picks, and the mark draws between them, are v21's.
3. **The engine's own picks are tested statistically.** `tests/unit/parts-distribution.test.ts` draws 2,000 seeds on each side, each engine with its own variation. It compares every pick:
   - categorical picks (drawings, numbers of trails and bubbles, whether the arrow is drawn, whether an arm copies the first) by a two-sample χ² test at the 0.1% level;
   - continuous ones (spins, sizes, places, the streams' radius, span and start) by their means and standard deviations within 4 standard errors.
   The golden runner still prints the comparison with the engine's own variation, strokes, noise and picks, for information (`own var.`).
4. **Marks stay the engine's.** The streams' dots and knots are marks, like the stipple's dots. They are sampled on the GPU from the `partMarks` stream, keyed by the placement key, so re-keying re-draws them with the stipple. This is what the thresholds are calibrated on (ADR 0015 item 6).

## Consequences

- The M5 goldens compare the same parts drawn by both engines. A wrong matrix, size, pen weight, warp, draw order or expansion fails. A different choice of drawing does not fail, because it cannot happen.
- The engine's own choices of drawing are guarded by the distribution test, not by the goldens.
- The replay is test code, and it is pinned to app23.js. If the reference changes, the oracle test fails before the goldens drift.
- Parts drawn from other streams are outside this decision and need their own replay when their milestones land: the sky (`skyParts`, M7), mergers' and lensed sources' parts (M8, M9).
