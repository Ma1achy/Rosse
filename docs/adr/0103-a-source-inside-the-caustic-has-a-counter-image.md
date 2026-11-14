# 103. A source inside the caustic has a counter-image

Date: 2026-11-14

## Status

Proposed. Rides on `lensField` (ADR 0097, 0101, 0102): off in the core so v21's goldens hold, on in the page. Amends ADR 0097's "only the primary image is drawn".

## Context

The deep field was seen through the lens by its primary image only (the root of the lens equation outside the Einstein ring). A source inside the caustic has a second root, on the far side of the lens, with the opposite parity; with only the primary drawn, the field was pushed out by the deflection and a hole opened inside the ring (ADR 0097's consequences).

## Decision

With `lensField` each deep-field dot and drawing is drawn at its counter-image too, where it has one.

- **The root.** The same damped Newton steps (`lens_newton`) from θ = β − α(β), which is the second root exactly for a lens whose deflection has a constant size and a good start for the others. It counts as an image when the lens equation holds to `LENS_CONV` (0.005 lens units) and it lies at least `LENS_SEP` (0.05) from the primary image (`lensCounter`, `lens_counter`); otherwise the source has none.
- **Dots** are placed at it; **drawings** go through it vertex by vertex (`WarpKind.lensCounter`), a vertex without a counter-image drops its piece, and the map's negative determinant mirrors the drawing, as a real counter-image is. The depth share of ADR 0102 scales the deflection as before.
- **Slots.** With the lens on, the sky's dot slots and drawing rows are doubled (`SkyDesc.nImg` = 2): the second half is the counter-images, a zero instance where there is none. `tf_ok` (a module-private flag, twinned in the CPU kernel) carries a vertex's validity out of `tf`.

## Consequences

- The core is v21's: without `lensField` nothing changes and `nImg` is 1.
- The inside of the ring is no longer empty. How many counter-images a view shows depends on how many sources the field has inside the caustic: few on the sparse default field.
- Costs a second solve (two Newton runs, the primary's for the separation test) per counter dot and per counter vertex, only with the lens on.
- Only two images: a source near the critical curve of a cluster can have more, and only the counter-image is searched for. The foreground stars are not given a counter-image.
- A source near the caustic edge may or may not converge differently between GPU and CPU transcendentals, so the sky parity test holds the lens cases to a fraction of the dots, as before.
