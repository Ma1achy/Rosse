# 51. Goldens are drawn with v21's lens picks

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Extends item 5 of [0015](0015-golden-metric-as-calibrated-in-m2.md) and [0021](0021-goldens-drawn-with-v21s-part-picks.md) the same way for the lens of M9. It changes nothing else in either.

## Context

A lensed scene makes more discrete random choices than a galaxy does, all from sequential streams:

- the cluster's layout: the number of member halos (7–11) and each one's place, strength, axis ratio and angle (`lensModel`, app23.js:L594–598, from `mulberry32(P.seed · 431 + 9)`);
- each source galaxy's options: the arms, inclination and position angle of the single source (L702), and for each of the cluster's 6–9 sources its angle, distance, size, arms, bulge, flocculence, inclination and position angle (L695–698), all from `mulberry32(P.seed · 613 + 5)`;
- the drawing of the "sketch" source (L692) and of each cluster member galaxy (L700);
- and, for every source galaxy, everything a galaxy chooses: its variation, which stroke draws each curve, its noise, its parts.

The new engine makes the same choices with v21's rules on its counter streams (ADR 0004): `Stream.lens`, one index per group (`LensIndex`). Its picks therefore differ from v21's for the same seed. They are structural: a source with two arms and one with three, at another inclination, are two different arcs on the sky. Without v21's picks a comparison measures which source each engine happened to choose.

## Decision

1. **The golden runner draws with v21's lens picks.** `tests/golden/compare/v21-lens.ts` replays `lensModel`'s halos and `lensSprites10`'s draws, line for line, on v21's own `mulberry32` streams, and returns them as data (`LensPicks`: `halos`, `sources`, `drawing`, `members`). The engine's `describeLens` takes them (`SceneOptions.lens.picks`). The pens of each source galaxy come from the same replays as the main galaxy's: `node.sceneOptionsOf` gives v21's own variation, stroke choices, noise corners and part picks for the source's parameters, at its scale of 70.
2. **The replay is checked against v21's own code.** `lensModel` and `lensSolver` are cut out of app23.js by name and evaluated unchanged (as `v21-curves.ts` does for `curves()`), and `tests/unit/lens.test.ts` requires, for the six lens presets at seeds 7 and 4242 (and the double plane's 1.42 and the weak lens' 1.3): the same halos, the same deflection and potential to 10⁻¹², and, on 600 source points each, the same image lists, with positions within 2 × 10⁻⁵ and magnifications within 0.2%.
3. **The engine's own picks are tested statistically** (`tests/unit/lens-distribution.test.ts`): 2,000 seeds on each side, categorical picks (arms, the number of members and sources, the drawing tiles) by a two-sample χ² test at the 0.1% level, continuous ones (place, size, inclination, angle) by means and standard deviations within four standard errors. The golden runner still prints the comparison with the engine's own picks, for information (`own var.`).
4. **Marks stay the engine's.** The lensed dots, knots and the quasar's stars are sampled from the counter RNG, keyed by the placement key, so re-keying re-draws them with the stipple. The thresholds are calibrated on that (ADR 0015 item 6).
5. **Where the lens sits.** The orientation the sources are fixed at is the preset's own camera: what v21's `homeFor` remembers when the preset is chosen on a fresh page, which is how every capture is made (a fresh page per case, the home camera first, the orbit camera reached from it). The orbit captures are therefore drawn with the same home, and show the sources from a new angle, as v21's do (ADR 0050).

## Consequences

- The M9 goldens compare the same lens, the same sources and the same pens, drawn by both engines. A wrong deflection, Jacobian, parity, scale, resampling, matcher, warp or draw order fails. A different choice of source cannot happen.
- The engine's own choices are guarded by the distribution test, not by the goldens.
- The replay is test code pinned to app23.js: if the reference changes, the oracle test fails before the goldens drift.
- v21's orbit re-rolls every lensed mark (its stream is seeded by where the source is seen from). The engine's does not. The orbit goldens therefore compare structure and ink, which the metric does, and not which dot is where.
