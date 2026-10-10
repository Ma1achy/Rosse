# 91. A star's colour follows the galaxy

Date: 2026-10-10

## Status

Proposed. A deliberate divergence from v21, requested by the owner, for the colour plate (ADR 0024), with `popAuto` ("Population detail", on the page). The plates `ink` and `slip` are unchanged.

## Context

v21's colour plate inks every layer in one of four flat inks by population (old, disc, young, HII), so a galaxy is four colours with hard borders, saturated, and the same everywhere. The owner asked for a more natural look and distribution, with a bigger palette, keeping the limited coloured-pencil (paper) and pastel-chalk (chalkboard) feel.

## Decision

- **A ramp of fifteen inks per surface** (`Palette.ramp`): the stars' temperature from dust-reddened red, red-orange, orange, amber, gold, pale yellow, cream, ice, sky, blue and periwinkle (1 to 11), then the nebulae's rose, coral, lilac and teal (12 to 15). On the chalkboard they are pastels; on paper, the same hues as deeper pencils.
- **A dot carries its tint** in four bits of the sample's class word (`SampleFlag.tint`, bits 13 to 16), set by the stipple kernel (`tintOf`, and `tint_of` in the WGSL twin) and sent to the sprite by the projection as `alpha + 2 · tint` (alpha 1 for a dot, so the code is exact). The sprite shader and the CPU rasteriser decode it and take the ink from the plate pass's `tints`, which only the colour plate sets. On every other plate a tint is the pass's ink, so nothing else changes. Tint 0 is the population's own ink: the clump and ring-knot extras and the drawn stars keep it.
- **Where a star falls on the ramp follows the galaxy:** a bulge is orange at its core and goldens outward; the disc is gold at the centre and bluer with radius; young arm stars are blue; the trailing (dust-lane) edge of an arm is reddened by up to 2.4 steps; a ring is bluer; halo stars are pale yellow and thick-disc stars gold; knots are rose, sometimes coral or lilac. The clumps' noise, which gathers stars into groups (ADR 0090), shifts a patch's hue together, so neighbours share a colour, and each star scatters a little (two hashes of its own roll, so no extra draw).
- The stipple's class word now holds the tint; 15 uniform vec4s extend the `Sprite` uniform to 304 bytes.

## Consequences

- The colour plate reads as a galaxy: warm core, golden disc, blue arms with pink star-forming knots, pale blue outskirts; on the chalkboard like pastel chalk.
- GPU = CPU on the tinted dots and the plates (tests/gpu/stipple.ts, plates.ts).
- Not yet: the drawn stars (vector drawings) and the line-work keep the key ink; the hand-drawn colour of a star by its brightness could follow.
