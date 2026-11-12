# 102. The lens acts by depth

Date: 2026-11-12

## Status

Proposed. Rides on `lensField` (ADR 0097, 0101): off in the core so v21's goldens hold, on in the page. The first step of a lens that every layer of the scene shares.

## Context

The lens bent the deep field and nothing else, and it bent all of it by the same amount, whichever side of the lens a galaxy lay on in the 3D scene. A background galaxy in front of the lens plane was lensed as if it lay behind it; the foreground stars were never lensed, though with `depthAuto` some of them lie behind the lens. Nothing in the scene carried a depth that the lens could ask about.

## Decision

Every object of the sky already has a world position about the lens, so its depth is its view-space z (the lens plane is z = 0, the camera is `CAM` = 30 in front of it, smaller z is farther behind). The lens a source feels is scaled by

    k(z) = min( [ −z / (CAM − z) ] / [ SKY_RMAX / (CAM + SKY_RMAX) ], 1 )   for z < 0,   0 otherwise

the physical ratio of the lens-to-source to the camera-to-source distance, D_ls / D_s, over its value for the far field (z = −SKY_RMAX), so the far field keeps the strength it had, a nearer source feels less and one at or in front of the lens plane none, with no step at the plane (`lensDepthK`, twin of `lens_depth_k`).

`k` multiplies the deflection (`sky_deflect`, and so its Jacobian and the Newton solve), per object:

- a deep-field **dot**, by its own depth;
- a **drawing**, by the depth of its galaxy's centre, carried to `vector-expand` in the instance's `w.x` (`WarpKind.lens`, ADR 0101);
- a **foreground star**, which is now lensed too: placed at its image, by its depth.

The lens uniform reaches `sky_fg` (binding 32, as the dots and rows).

## Consequences

- The core is v21's: without `lensField` nothing changes.
- The deep field is no longer lensed uniformly: the galaxies in front of the lens plane are as they were drawn, so a view from another side of the lens bends a different half of the field.
- A foreground star near the ring is displaced; its sprite is not stretched, so a star at the critical curve is moved, not smeared.
- Not yet: the companions (v21 puts them in front of the galaxy, so they would feel nothing), the subject galaxy and the merger's galaxies (the lens plane runs through them), several images of one source, and several lens planes. A per-object `k` is the quantity those need, so they build on this.
