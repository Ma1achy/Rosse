# 97. The lens bends the deep field

Date: 2026-10-13

## Status

Proposed. Opt-in (`lensField`, "Lens bends the deep field": 0 in the core so v21's goldens hold, 1 on the page). A deliberate divergence from v21, requested by the owner.

## Context

The lens traces the subject galaxy's marks through the lens (the source-plane solver, ADR 0008), but the rest of the plate's elements sit behind the lens too and were drawn untouched. v21 bent the field only by shearing each drawing about its own centre (`LENSWL`, app23.js:L1273–1278), and that was an identity stub in the new engine (`weak_lens`). A full trace of every dot of the deep field through the solver's triangle map would cost the lens passes a second time over thousands of marks.

## Decision

With `lensField` (and `lensOn`) the deep field is seen through the main plane's lens, at v21's 1.3 strength for the field behind it, by its primary image:

1. A plate point is a source β in lens units. Its image θ solves θ − α(θ) = β by five damped Newton steps (Jacobian by finite differences, |det A| floored at 0.15, step capped at 0.4) from θ = β + α(β).
2. A deep-field **dot** is placed at its image. A galaxy's **drawing** is placed at the image of its centre and its rows are multiplied by A⁻¹ there (the same tangential stretch v21's weak lens used, now with the position move and the strong-lens stretch), so a drawing near the ring is drawn as an arc.
3. Only the primary image is drawn: the fainter counter-images inside the ring are not.

`lensImage` (`src/fallback/kernels/sky.ts`) and `lens_image` (`sky.wgsl`) are twins; the lens reaches the GPU as the `LensZ` uniform (the halos packed as the lens passes pack them, at most 12). The foreground stars and the subject are not lensed.

## Consequences

- The core is v21's: without `lensField` nothing changes.
- A near-critical view has points whose root differs a little between GPU and CPU transcendentals, so the sky parity test holds the lens cases to a fraction of dots (≤ 5 %) rather than the 0.05 px bound.
- An isothermal lens deflects every source by a constant, so the whole field is pushed out by about 1.3 θ_E: the field's density is kept, but a hole opens where the counter-images would be.
- Cost: about 15 deflection evaluations per dot and per row, only when the lens is on.
