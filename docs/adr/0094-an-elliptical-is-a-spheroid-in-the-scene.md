# 94. An elliptical is a spheroid in the scene

Date: 2026-10-11

## Status

Proposed. Opt-in (`bulgeAuto`, "Natural bulge": 0 in the core so v21's goldens hold, 1 on the page). A deliberate divergence from v21, requested by the owner.

## Context

A round or cigar-shaped galaxy did not move in 3D when the camera orbited it. Two causes, both v21's:

1. A galaxy dominated by its bulge (`bulge` ≥ 0.95) flattens the bulge along the polar axis only (`pz · bulgeFlat`): an oblate spheroid. An orbit (`az`) turns the camera about that axis, so it can never change the view of an oblate body. The cigar, the round galaxy and the elliptical presets looked the same from every azimuth, which reads as a flat picture rather than a body.
2. A galaxy with an explicit Sérsic index (`sersicN` > 0, the real and Galaxy Zoo ellipticals) is sampled in 2D, `(r cos θ, r sin θ · bulgeFlat)` with z = 0, and projected as screen points (`sersic2d`): the camera's azimuth and inclination do not act on it at all.

## Decision

With `bulgeAuto`:

1. **An elliptical is prolate.** The bulge's two short axes both take `bulgeFlat` (`GalaxyFlag.prolate`): a cigar is long from the side and round end-on, and the azimuth turns it. This applies to every galaxy with `bulge` ≥ 0.95, in the CPU kernel (`src/fallback/kernels/stipple.ts`) and its WGSL twin (`stipple.wgsl`).
2. **An explicit Sérsic index is a 3D spheroid.** It takes the deprojected Sérsic radius the natural bulge uses (ADR 0076), with the 3D half-mass radius 1.33 of the effective radius, instead of the 2D draw. This is `describeGalaxy` only: it sets `bulgeSersic` and the bulge's scale, and clears `sersic`.

The marks go through the camera as any 3D sample does, so dust (`tau`) and perspective (ADR 0084) apply to them too.

## Consequences

- The core is v21's: without `bulgeAuto` nothing changes (the goldens hold).
- A smooth galaxy's 2D dust-lane carving, which tests the screen position, does not apply in the 3D path; the dust's optical depth (`tau`) does.
- Shells (`shells`) are still v21's screen-space draw; they are the next to move into the scene.
- A true triaxial body (three different axes) is not drawn; a prolate one is the cigar's shape.
