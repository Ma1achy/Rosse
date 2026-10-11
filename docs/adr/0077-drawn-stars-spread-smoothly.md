# 77. Drawn stars spread smoothly

Date: 2026-10-09

## Status

Proposed. A deliberate divergence from v21, requested by the owner, on the page only: the core, the goldens and the vectors keep v21's stars. It keeps [0010](0010-two-compute-tiers.md)'s tiers: it is a function of model parameters, never of the camera.

## Context

A sample of the stipple becomes a drawn star (`rstar`: a hand-drawn star, some of them bright) with a chance `0.34 * starMix * kc * outer`. The samples already follow the galaxy's surface brightness, so the stars do too; what is not natural is the hard steps in the weights (app23.js, the stipple's `rstar` branch):

- `kc`, the weight by component, jumps from 0.85 to 1.35 where the arm profile crosses 0.55, and the star is "young" (a bright one with chance 0.18 rather than 0.05) only above that threshold, so a ridge of stars runs along the contour of the arm and none beside it;
- `outer` falls from 1 to 0.55 at R = 2.1, and the stars stop at R = 2.7: a visible ring of them.

## Decision

1. **One new parameter, `starsAuto`** (a 0/1 choice, "Natural star spread", model tier, in the stars and dust component's more controls). It is 0 in `DEF`, so every core caller, golden, vector and replay is v21's. It is a flag bit on the galaxy uniform (`GalaxyFlag.starsSmooth`, 16); the layout does not change.
2. **A smooth arm weight.** With the flag, a disc sample has `yw = smoothstep(0.3, 0.8, arm)`, `kc = 0.85 + 0.5 yw` (0.85 between the arms, 1.35 in them, as v21's two values) and the chance of a bright star `0.05 + 0.13 yw` (v21's 0.05 and 0.18). A ring sample has `yw = 1`. Bulge, bar and halo are as v21's.
3. **A tapered edge.** `outer = (1 - 0.45 smoothstep(1.7, 2.5, R)) * (1 - smoothstep(2.5, 3.0, R))`, from 1 down to 0.55 by 2.5 and out to 0 by 3.0, for v21's step at 2.1 and cut at 2.7. Both engines compute `smoothstep` as the polynomial on f32 steps, so GPU and CPU agree.
4. **No extra draw** is made in the flag-off path, and the flag-on path draws exactly one number for the decision whatever R, as both kernels do, so the two engines stay in step.
5. **Default off in the core, on in the page**, as `dustAuto` (ADR 0075) and `bulgeAuto` (ADR 0076).

## Not modelled

- Stars that cluster (OB associations) beyond what the arm profile gives.
- A colour or a size by age: the drawn star's size and drawing are v21's.
- The overlay star and the foreground stars (they are not part of the galaxy).

## Consequences

- On the page, the stars follow the arms as a gradient, not a contour, and thin away at the edge.
- The comparisons with v21 of any galaxy with drawn stars move; the goldens do not (`starsAuto` 0).
- `PARAM_KEYS` has three keys more than v21's `DEF`.
