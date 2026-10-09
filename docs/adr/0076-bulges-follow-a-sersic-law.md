# 76. Bulges follow a Sérsic law

Date: 2026-10-09

## Status

Proposed. A deliberate divergence from v21, requested by the owner, on the page only: the core, the goldens and the vectors keep v21's bulge. It keeps [0010](0010-two-compute-tiers.md)'s tiers: the bulge is a function of model parameters, never of the camera.

## Context

v21 draws every bulge, from a round elliptical-like core to a small flat one, as one Hernquist sphere, `r = a * sqrt(u) / (1 - sqrt(u))`, squashed along z by `bulgeFlat` (app23.js, the bulge component of the stipple). A classical bulge (round, steeply peaked) and a pseudo-bulge (flat, nearly exponential like the disc) come out alike. Smooth galaxies already have their own exact Sérsic law in 2D (`sersicN`, app23.js:L223-233).

## Decision

1. **One new parameter, `bulgeAuto`** (a 0/1 choice, "Natural bulge", model tier, in the bulge component's more controls). It is 0 in `DEF`, so every core caller, golden, vector and replay is v21's.
2. **A deprojected Sérsic radius** for the bulge's stipple samples when `bulgeAuto` is on and the galaxy is not a smooth one (`sersicN > 0 && bulge >= 0.95` keeps its 2D law). The density is the Prugniel-Simien law `rho ~ r^-p exp(-b (r/re)^(1/n))`, `p = 1 - 0.6097/n + 0.05463/n^2`, `b = 2n - 1/3 + 0.009876/n`. The mass inside `r` is then a gamma of shape `n (3 - p)` in `b (r/re)^(1/n)`, so one `gammaS` draw gives the radius (`re * (G / b)^n`); direction, flattening by `bulgeFlat` and the cut (20 scale lengths) are v21's. The kernels reuse the galaxy uniform's `sersic_n` and `sersic_b` (unused for a non-smooth galaxy) and a new flag bit `GalaxyFlag.bulgeSersic` (4), so the struct layout does not change. GPU (`stipple.wgsl`) and CPU (`kernels/stipple.ts`) draw the same samples.
3. **The index follows the galaxy** (src/model/bulge.ts): an explicit `sersicN` wins; otherwise `n = 1 + 3 sqrt(bulge) * bulgeFlat`, clamped to 0.7-6, so a small or flat bulge is shallow, nearly exponential (a pseudo-bulge, n near 1) and a big round one steep (n up to 4, the de Vaucouleurs law).
4. **The size is kept.** The 3D half-mass radius stays Hernquist's, `(1 + sqrt 2) a`, which for a Sérsic law is about 1.35 times the projected `re`, so `re = 1.788 a`. Only the profile changes: a steeper centre and a longer tail at high `n`, a gentler one at low `n`.
5. **Default off in the core, on in the page**, as `dustAuto` (ADR 0075): `variantOverrides` in src/main.ts and the catalogue and real galaxies in src/ui/galaxies.ts lay `bulgeAuto: 1`; `withoutGalaxy` sets 0. `bulgeAuto=0` in a link is v21's drawing.

## Not modelled

- A boxy or peanut shape for the bulge of a barred galaxy seen edge-on.
- A bulge brighter or fainter by type: its share of the stars (`c_bulge`) is v21's.
- The drawn core (`parts.ts`) and the envelope are v21's drawings; they follow `bulgeSize`, not `n`.

## Consequences

- On the page the bulge of a spiral is more concentrated or more diffuse according to its type; ellipticals do not change.
- The comparisons with v21 of any galaxy with a bulge move; the goldens do not (`bulgeAuto` 0).
- `PARAM_KEYS` has two keys more than v21's `DEF`.
