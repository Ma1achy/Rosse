# 74. The star is dimmed by the dust in front of it

Date: 2026-10-09

## Status

Proposed. A deliberate divergence from v21, requested by the owner. It keeps [0010](0010-two-compute-tiers.md)'s tiers: the extinction is a number per star computed in the view tier, so a pure orbit or zoom does not rebuild the model. It replaces a first design of this ADR (an occluder depth grid that cut the star's marks along the outline of the nearer galaxy), which the owner rejected as unphysical.

## Context

A star's light is additive: a galaxy in front of a star does not hide it, it adds its own light to the star's (and ink on ink looks the same anyway). The glare, the rings and the diffraction spikes are the telescope's response to the star's light, not objects at the star's depth, so nothing opaque cuts them. The one realistic thing that dims a star behind a galaxy is **dust extinction**: the star's light is attenuated by `exp(-tau)` along the line of sight through the galaxy's dust slab. Every part of the star (heart knots, glare, rings, bleed column, spikes and the drawn core) is the same light, so the whole star dims by the same factor. In pen, that is the star's stippling thinned uniformly, not cut off along an outline.

v21 never dims the overlay star: it is drawn last, over everything (`scene()`, app23.js:L1289-1301; the star's dots are `merge`d after the galaxy's, L456).

## Decision

1. **The model is the galaxy's own.** The galaxy's marks already survive with probability `exp(-tau)` where `tau = dustTau(p, c)` (app23.js:L145-152): zero when `P.dust <= 0` or beyond R 3.2; else `9 * P.dust * exp(-R / 1.6)` times the length, capped to 6, of the line of sight through the slab `|z| < 0.06`, from the point `p` (galaxy frame) along the direction whose z component is `c`, the cosine of the inclination. The port's `dustTau` (src/fallback/kernels/project.ts, twin of `dust_tau` in compute/project.wgsl) is reused unchanged.
2. **One `keep` per star, on the CPU.** `starJobs` (src/model/stars.ts, view tier) computes `keep = f32(exp(-tau))` once per star, for the primary, the overlay star and each satellite: the star's place in the galaxy's frame (`sceneGalaxyPoint`, src/view/camera.ts: the overlay's scene point `[x, y, depth]` turned by the home orientation, which the camera does not move; a satellite at its own offset and `satelliteDepth`, ADR 0055), and `c` is the camera's `cos i`. `StarJob.pad0` became `keep` (f32; the struct is still 64 bytes). The galaxy's dust is passed in (`GalaxyDesc.dust`), so a scene with no galaxy has `keep = 1`.
3. **The thinning.** compute/star-marks.wgsl (CPU: `starMark`): each mark survives iff a per-mark uniform draw `u < keep`. `u` is the kernel's counter RNG at a new draw index, `DRAW_KEEP` = 5, after the last draw any mark makes (0 to 4), so no existing draw changes and v21-replayed picks and goldens are untouched. A mark that does not survive is class `CLS_NONE`. The drawn core is one mark of its own job and is kept or dropped whole by its own draw. The draw is deterministic and identical on both engines, so the classes are bit-identical GPU against CPU.
4. **What has `keep = 1`.** A subject star (no galaxy); the artefacts (trail, ghost, cosmic rays); a merger's overlay star (below); `P.dust = 0`; a star on the near side of the disc, and one far enough out (R > 3.2) or edge-on and outside the slab, where `dustTau` is 0.

4a. **The reach shrinks too.** A dimmer star also reaches less far: the core radius, the glare's radius, the spikes' length and the bleed column's length are scaled by `sqrt(keep)` (`starJobsOf`). Each job keeps its mark count, so the slots and buffers do not move; the marks are then thinned by `keep` as above. So a star seen through a lot of dust has shorter spikes and a smaller bloom as well as fewer marks. A star with `keep = 1` is as before.

## Not modelled

- Nothing opaque hides a star. The galaxy's stars, gas and lines do not cut the star's marks: the light is additive.
- A merger's overlay star has no single galaxy frame (two galaxies, each with its own dust and orientation): `keep = 1` there. A follow-up would have to choose a model (the nearer galaxy's, or the two optical depths summed).
- The deep field's foreground stars and companions are not dimmed.

## Consequences

- Layered presets with an overlay star and `dust > 0` change when the star is behind the disc: the whole star thins evenly (more the more edge-on, and the nearer the galaxy's centre). Subject stars and `dust = 0` do not change. The comparisons with v21 of those cases move (v21 never dims the overlay star).
- Cost: one `dustTau` per star on the CPU, one extra RNG draw per star mark; no buffers, bindings or passes.
