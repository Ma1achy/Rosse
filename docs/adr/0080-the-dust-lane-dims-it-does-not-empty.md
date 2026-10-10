# 80. The natural dust lane dims, it does not empty

Date: 2026-10-09

## Status

Proposed. A deliberate divergence from v21, requested by the owner, on the page only (it follows `dustAuto`, ADR 0075).

## Context

With natural dust on, an edge-on disc's stars in the midplane are culled almost completely: `dustTau` through the slab is large, the sample survives with probability `exp(-tau)`, and a band along the disc's axis is empty. The strokes drawn along an edge-on disc (the midplane stroke, the hatch rows, ADR 0073) were meant to thicken it, but they land on the empty band, so the disc looks thinner, not thicker.

## Decision

The extinction cull keeps a sample with probability `max(exp(-tau), tau_floor)`, `tau_floor` being a field of the culls uniform (it was padding): 0 without `dustAuto`, which is v21's, and `NATURAL_TAU_FLOOR` = 0.5 with it (src/model/ribbons.ts). Both kernels apply it (compute/project.wgsl, fallback/kernels/project.ts). The lane dims the midplane by at most half and never empties it; the strokes read as thickening the disc. The overlay star's own extinction (ADR 0074) is not floored: a star behind the disc is dimmed as before.

## Consequences

- Edge-on discs keep their stars through the lane; the dust still darkens it (up to half the marks thinned).
- v21's own dust (`dustAuto` 0) is unchanged.
