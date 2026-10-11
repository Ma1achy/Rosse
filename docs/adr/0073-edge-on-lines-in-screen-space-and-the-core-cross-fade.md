# 73. Edge-on lines in screen space and the core cross-fade

Date: 2026-10-09

## Status

The cross-fade of the core is superseded by [0079](0079-the-core-is-one-opaque-drawing.md). Proposed. A deliberate divergence from v21, decided by the owner; it keeps [0017](0017-model-tier-key-is-a-structure-signature.md)'s tiers (no new structure switch).

## Context

Two things the owner sees on the live page, both inherited from v21.

**The straw.** Near edge-on, v21 draws 1-D lines in the galaxy plane: the midplane stroke (`curves()`, app23.js:L788), the three hatch rows of the dust lanes (L944-958) and the dust-carving pen line (L201-207). A line in the plane shrinks with cos(az) on the screen while the disc stars keep their full width. At incl 88 the stroke is 538 px at az 0, 269 at az 60, 95 at az 80 and a 19 px vertical stub at az 90, against a disc 420 px wide at every azimuth: a bar that does not turn with the camera, "like looking down a straw". Its alpha, `lines (incl - 72) / 18`, also used the raw inclination, so it passed 1 above 90 degrees (1.55 at 100, 11 at 270) and went negative at -90.

**The bulge.** The drawn core is a 2-D bitmap from the `cores` atlas placed as `chain(Rm(pa), Sm(s, s max(bulgeFlat, ci())))` at alpha 0.9. It vanishes at `incE >= 80`, its style flips from line to dotted (a different bitmap) at `incE > 70`, and the whole drawing's pool changes at `incE > 70` (smooth:elongated) and `> 78` (edge-on). `ci()` is signed (L123), so for an inclination in (90, 270) the flattening was `bulgeFlat` even face-on from below, and a smooth galaxy seen from below was always `smooth:elongated` (L1000).

## Decision

1. **Screen-space edge-on lines.** The midplane stroke (`Curve.screen`), the edge-on hatch rows (`Hatch.screen`, `DustLanes.screenPts`) and the carving pen line (`DustLanes.screenLines`) are built as offsets on the screen, in galaxy units, x along the roll axis: the stroke is (+-3.2, 0), the hatch rows are x in [-2.8, 2.8] at y = -zo, the pen line is (-3 + 6 s, -0.28 d). A point's fourth float in `points3` is 1 for these; the projection (`project_points` in compute/ribbons.wgsl and `projectPoint` in fallback/kernels/ribbons.ts) mirrors it by the winding, rolls it by `pa` and scales it by `84 zoom`, and does not orbit it. The length is 6.4 x 84 x zoom at every azimuth (v21's at az 0), the hatch directions come from the plate-space step (no `atan2` of a projected step degenerating near az 90), and at az 0 the hatches and lane points equal v21's to 0.05 px.
2. **The stroke's alpha** is `lines clamp((incE - 72) / 18, 0, 1)` (`edgeOnAlpha`), symmetric about 90 degrees and bounded by `lines`.
3. **Flattening uses |cos i|** in the core, the `smooth` whole drawing and the envelope (`max(bulgeFlat, |cos i|)`), and `wholeTypeOf` and its structure predicate (`CI_PREDICATES`, src/view/camera.ts) use `max(|cos i|, 0.05)`. The nuclear spiral keeps `discM` (signed; the orientation is right).
4. **The core cross-fades.** Its alpha is scaled by `1 - smoothstep(66, 80, incE)`, so the cut at 80 is invisible, and the line and dotted drawings hand over with complementary alphas `smoothstep(66, 74, incE)` (centred on v21's 70) unless the style is always dotted (`stipple > 0.5` and `lines < 0.5`) or the two styles pick the same drawing. The alternate drawing is emitted at alpha 0 whenever it could be needed, so the number of core instances (at most the core, its alternate and the nuclear spiral: 3) does not change with the camera inside a structure bucket (the merger's core buffer in render/stipple.ts is 3 instances; the lens counts them through `extras`). Both are view-tier: `coreInstances` already reads the continuous inclination.
5. **Not done: the whole drawing's pool switches (70, 78).** A cross-fade needs per-row alpha, which the vector path ignores on purpose (v21 parity, reference notes 20.10: every vertex, dot and blob has alpha 1) and a row count fixed by the model tier (`vectorView` throws if it changes). Fading would change the vector instance layout and compute/vector-expand.wgsl; left for a decision. The |cos| fix above removes the worst switch (from below).
6. **Not done: fading the arm, bar and ring ribbons** by cos(incl) past 80 degrees. The bar is a straight galaxy-plane line like the stroke and shrinks with cos(az); it was left as v21 draws it.

## Consequences

- Tiers: the screen-space data is independent of zoom and azimuth, so the model tier is unchanged by an orbit or a zoom (the stroke's length is `6.4 UNIT_SCALE zoom`, rolled by the view uniform). `structureKey` is as before except that the signed predicate is |cos|. The line-work's buffers differ from v21's only in `points3.w`.
- Goldens: engine hashes and the comparison to v21 change for the cases at `incE` >= 66 (the core's alpha and style mix), at incl > 90 with a core or a smooth drawing (|cos|), and at `incE` > 72 with az != 0 or incl != 90 (the screen-space lines; at incl 88 and az 0 the lines move by under 0.05 px). Thresholds are not changed here; the cases are to be made again and their per-preset bands judged on the new hashes.
- The unit tests that compare with v21 (tests/unit/parts.test.ts, lines.test.ts, camera.test.ts) keep v21 where the port does not deviate and test the deviations on their own.
