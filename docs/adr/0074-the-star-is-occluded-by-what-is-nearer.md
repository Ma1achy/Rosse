# 74. The star is occluded by what is nearer

Date: 2026-10-09

## Status

Proposed. A deliberate divergence from v21, requested by the owner ("add depth occlusion for the star"). It keeps [0010](0010-two-compute-tiers.md)'s tiers: the grid and the cull are view tier, so a pure orbit or zoom does not rebuild the model.

## Context

v21 draws the star last, over everything (`scene()`, app23.js:L1289-1301; the star's dots are `merge`d after the galaxy's, L456). Its dense glare disc, spikes, rings and bleed column therefore sit on top of galaxy marks that are nearer the camera than the star, which a pen drawing would not do: the nearer ink is drawn and the star is interrupted.

With single-colour ink there is no blending to occlude with, so occlusion means the star's own marks are dropped where something nearer is drawn, a stippled gap as a draftsman leaves.

## Decision

1. **An occluder depth grid**, 128 x 128 cells over the 800-unit plate (6.25 units a cell), one u32 each. A cell holds `quantZ` of the nearest occluder mark that falls in it or in a cell next to it (`OCC_HALO` = 1, a 3 x 3 block); 0 is "nothing". `quantZ(z) = floor((clamp(z, -64, 64) + 64) * 2048) + 1` (1/2048 unit steps, at least 1). `gridCell` and `quantZ` are written once in `src/model/occlusion.ts` and mirrored in `src/shaders/common/occlusion.wgsl`; the constants are compared by `tests/unit/occlusion.test.ts`.
2. **The z convention.** The view frame is x right, y down, z towards the viewer (`rotFwd`, `toView`; the deep field's `perspective(depth) = CAM / (CAM - depth)` grows with depth; `srcNow` puts a source behind the lens at -D). A larger z is nearer. `quantZ` keeps the order, so the nearest occluder is the largest key, and the grid is an `atomicMax` (commutative, so the invocations' order is immaterial) that starts at zero: `clearBuffer` clears it, with no clearing dispatch. (The first design had a minimum from "far"; the maximum of the same keys is the same thing and needs no init pass.)
3. **Writers.** compute/project.wgsl (CPU: `projectSample`), for every stipple sample (the proposals and the ring knots and clumps) that survives the culls, in classes old, disc, young and knot, at its drawn (wobbled) position, with its view-space z. A Sersic sample is drawn as a 2D disc, not turned, so its z is its stored z, 0: the galaxy's plane. Dust-culled samples write nothing. Drawn stars (`CLS_STAR`, `CLS_RSTAR`) and the line-work do not write. The grid is stamped only for a view with star slots (`Culls.occ`, was `pad1`).
4. **The star's z.** `StarJob.pad0` became `z` (f32; the struct is still 64 bytes). `starJobs` gives every job of a star its z: 0 for a subject star at the galaxy's centre plane; the scene point's z (`scenePointZ`, next to `scenePoint`) for an overlay star (home depth 1.4) and for satellites (depth + `satelliteDepth`, ADR 0055). The artefacts' lines, a cosmic ray, the ghost's disc and edge are screen-fixed or fixed to the frame: `OCC_NEVER_Z` (64, the nearest key), which nothing is nearer than.
5. **The cull.** compute/star-marks.wgsl (CPU: `starMark`), after the mark's position is known: if the grid cell at the mark's drawn position holds a key more than `OCC_EPS` (102 keys, 0.05 unit) above the job's key, the class is `CLS_NONE`. The drawn core (class rstar) is a vector mark, so it is kept or dropped whole by its centre's cell. The epsilon keeps a star from being cut by the disc it sits in.
6. **Order.** `clearBuffer` before the pass; project writes the grid; star_marks, a later dispatch of the same compute pass, reads it (the storage writes of an earlier dispatch are visible to a later one, as `classes` already is to the scan).

## Not done (phase 2)

- The deep field's galaxies cannot occlude: `sky_cull` drops anything with `k > 0.8`, that is, anything less than 7.5 units behind the galaxy's plane, so they are all farther than the star. The foreground stars (`sky_fg`) can be nearer; they are drawn by `GpuSky.encode` after the star marks, so they need their dispatch moved ahead of `star_marks` and a binding on the grid in compute/sky.wgsl and fallback/kernels/sky.ts.
- Merger debris and a merging galaxy's marks: each galaxy is its own `GpuStipple` view, with its own grid, and the tides carry the marks after the projection (compute/tide-apply.wgsl), so the grid holds the positions before the warp. The debris projection (src/render/merger.ts, src/fallback/merger.ts) needs its own writes.
- Ribbons, vector drawings and the lens's marks as occluders; the star's own marks as occluders of the star's fainter neighbours.

## Consequences

- Layered presets with an overlay star change: the star loses marks where the galaxy is in front (a lot when seen from the far side of the disc). Subject stars without a galaxy do not change. The comparisons with v21 of those cases move (v21 draws the star over everything).
- Cost: one `atomicMax` per sample and halo cell (9) in a view with star marks, one read per star mark, a 64 KiB buffer.
- The grid is coarse: a cell is 6.25 units and an occluder fills its whole 3 x 3 block, so the gap in the star is blockier than the occluding ink. `OCC_GRID` and `OCC_HALO` are the tuning knobs.
