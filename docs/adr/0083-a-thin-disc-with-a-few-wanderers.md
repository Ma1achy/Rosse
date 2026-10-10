# 83. A thin disc with a few wanderers

Date: 2026-10-09

## Status

Proposed. A deliberate divergence from v21, requested by the owner, on the page only.

## Context

v21 gives the disc an exponential height, `z = -thick ln(1 - u)`, with a scale of 0.08. The tail is long: about a fifth of the marks lie above 0.15 and a tenth above 0.3 (probed on the grand design, barred, flocculent and plain discs), and a Sérsic bulge reaches 20 scale lengths. Edge-on and tilted, the plane is not dense enough to read as a disc, and the stars spread far off it.

## Decision

A model-tier parameter `thinAuto` ("Thin disc", 0 in the core), carried as the galaxy flag `thinDisc` (32), no layout change. With it:

- The disc's height comes from the same single draw, split: 85% fall in a sharp layer (scale 0.4 `thick`), 15% in a thicker one (scale 1.5 `thick`), each stopped at -ln 0.03 scale lengths and flaring 15% of the radius outward. The plane is dense, the fall-off sharp, and a few marks still wander well off it.
- The bulge's Sérsic tail is cut at 8 scale lengths instead of 20.
- The arms weigh 1.25 times more in picking disc samples (at most 0.95) and the disc draws half as many stars again (`proposalCount`), so the structure carries more of the picture.

Both kernels apply it (compute/stipple.wgsl, fallback/kernels/stipple.ts); the draw count is unchanged, so no other sample moves.

## Consequences

- Seen edge-on, the disc is a dense thin plane; the bar's peanut remains the taller part.
- `thinAuto` 0 is v21's disc and the goldens are unchanged. The halo's spherical tail is not yet thinned.
