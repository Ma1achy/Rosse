# 101. A lensed drawing bends

Date: 2026-11-11

## Status

Proposed. Rides on `lensField` (ADR 0097): off in the core so v21's goldens hold, on in the page. Amends ADR 0097's decision 2.

## Context

ADR 0097 placed a deep-field drawing at the image of its centre and multiplied its rows by A⁻¹ there, a single 2 × 2 matrix per drawing. A linear map keeps a straight stroke straight, so a long source near the ring, which should be a thin arc, came out as a long straight line. The owner saw it at grazing angles, where the lensing is strongest.

## Decision

A lensed drawing is a `WarpKind.lens` instance: it keeps its source-plane matrix and place, and every vertex is put at its own primary image (`lens_pos`, the damped Newton solve of ADR 0097) after the matrix and before the wobble. The drawing is cut into pieces as any warped drawing is (≤ 0.012 tile units, app23.js:L1202), so a stroke follows the curve; a piece stretched past 22 px is dropped, as for the tides. A blob is placed at its image and stretched by A⁻¹ there; a dot is placed at its image.

- **GPU:** the lens solve moves from `sky.wgsl` to `common/lens-sky.wgsl`, shared with `vector-expand.wgsl`, which reads the sky's `LensZ` uniform at binding 32 (all zero for every other set of drawings). `rows_sky` marks the row instead of folding A⁻¹ into its matrix.
- **CPU:** `lensImage` moves to `kernels/lens-sky.ts`; `tf` in `kernels/vector.ts` has the lens case, and the sky set's rows carry the warp.
- **Slots:** a warped drawing takes a slot per piece, so with the lens on the sky set's capsule stride is the largest densified count (826 against 267 segments) and a warped slot past its drawing's pieces expands to nothing.

## Consequences

- The core is v21's: without `lensField` nothing changes and the strides are as before.
- At the ring the vertices leave the old straight-stretched drawing by about 15 px for a 90 px drawing, against about 1 px far out (a test); the GPU and CPU sky cases with the lens on agree as before.
- The cost is the lens solve once per capsule end instead of once per drawing: more work for the lens-on sky, none otherwise.
- Still the primary image only, and a drawing is not lensed against the other things in the scene (the subject, the foreground stars, other lenses): the deep field is a layer behind the lens, not part of it. A composable lens is the next step.
