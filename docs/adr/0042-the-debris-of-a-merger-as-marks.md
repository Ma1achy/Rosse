# 42. The debris of a merger as marks: classified on the counter RNG, thinned as v21 thins it, and what v21 builds and never draws

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Records how v21's `mergerSprites` (app23.js:L481–536) and the debris of `render()` (L1234–1238) are reproduced, and one place where v21's behaviour is kept over its comment (Q13).

## Context

For each test star v21 draws a mark. It walks one sequential stream (`mulberry32(seed · 17 + 3)`) in star order, so a star's mark depends on the stars before it, and then keeps only 16% of the dots, 60% of the knots and 50% of the drawn stars (`rd0`, a second sequential stream), on top of the two galaxies' own marks. It also builds `round(1500 · M · (1 + 3.5 BUL))` bulge dots round each core and a screen position for each core. Its comment says merging galaxies "keep only their simulated bulge stars: no drawn core".

## Decision

1. **Classification is `compute/merger-sprites.wgsl`** (twin `fallback/kernels/merger-sprites.ts`), one thread per star on its own counter (`mergerSprites` stream, fixed draw numbers per role): a drawn star replacing the dot (`0.05 · starMix`, ×1.6 in a tail, bright one time in four there), a knot of 5 to 11 new stars with a bright drawn star in a tail beyond 1.15 of its galaxy's truncation radius (`0.012 (0.4 + knots)`), a knot for an outer star (`R0 > 0.45`, `0.035 (0.4 + knots)`), a sparkle star (`0.004 (0.3 + sparkle)`), or a dot (`young` for an outer star, else `disc`). An elliptical's stars are never any of the first three (`hot`). The thinning (16%, 60%, 50%) is made in the same thread on the star's own counter, so a mark's survival depends on that star only. A star makes up to 12 marks (11 knots and a drawn star), so the kernel writes 12 slots a star and the stipple's compaction (`compute/scan.wgsl`, unchanged) separates them by class. The marks are the stipple's classes: they draw as its `disc`, `young`, `knots` and `stars` layers, and the drawn stars (`rstar`) are classified and counted, as M2–M5 do, and drawn by M7.
2. **Against v21, from identical starts** (the engine's initial conditions, and each star's disc coordinates, through v21's own `mergerSprites`, `tests/unit/merger-view.test.ts`, six views): the dots and the sparkle stars agree within a Poisson allowance (the Mice at home: 9,268 dots, 2,599 of them young, against 9,283 and 2,614; 27 sparkle stars against 27); the drawn stars too (320 against 312). Knots come in clusters of 5 to 11, so their count has about 8 times Poisson's variance: 780 against 681 over the six views, about one standard deviation.
3. **What v21 builds and does not draw.** The bulge dots of `mergerSprites` go to `S.old`, which `render()` never reads (`S = { old: [], disc, young, knots, stars, rstars }`, L1236): the visible bulges are the galaxies' own (`generate`, with `bulge` from `mBulge`), carried by the tides. The simulated bulge dots, the cores' screen positions and the merger's `cores` list are therefore **not made**: building them would add ink that v21 does not draw. This is Q13's rule: reproduce what v21 shows, and mark the divergence from its comment. If the owner wants the simulated bulges drawn, it is one more list in `merger-sprites.wgsl` and a layer.
4. **`mWarp`** (app23.js:L1260–1264): one whole spiral drawing per galaxy (`galaxy:spiral`, `galaxy:barred-spiral`, `galaxy:flocculent`), at the identity matrix, pen scale 0.9 and 0.75, torn through the tidal map itself (the 4 nearest stars at each densified point of the drawing, not the grid), mirrored by the drawing's recorded winding; its dots and blobs scaled by `MS.scale = 0.3 · MS.sc`. The default of `mWarp` is 1, so every merger preset draws them, not only `Sketches, torn apart`. Placed by `mwarpDesc`/`mwarpView` through `vector-expand`'s `tideScreen` kind.
5. **Not reproduced here:** the main parameters' own `parts()` (the sky, trails, streams and jet of the whole picture, L1234; the merger presets leave them at 0 or the sky off, M7); the lens and shells of the merged scene: shells are applied (ADR 0043); the lens is M9.

## Consequences

- A merger's marks never depend on the order of the stars: a change of `mStars` re-draws everything, but changing `knots` changes only the knots.
- A merger's marks need no per-frame CPU work: 12 N slots (115,000 at the defaults, 12 MB), one dispatch and one compaction per view.
- The merged scene lacks v21's `fgstars`, deep field and trails until M7; the goldens switch them off (ADR 0044).
