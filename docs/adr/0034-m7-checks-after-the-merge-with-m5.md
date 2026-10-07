# 34. Four changes to checks and cases when M7 met M5's line-work set

Date: 2026-10-06

## Status

Proposed. Awaiting the owner's sign-off. It changes no threshold of an Accepted ADR; it changes what three checks compare and which overrides one case set keeps.

## Context

M7 merged M5's branch (M4's line-work set, K-mean calibration of ADR 0018, the pen-line union of ADR 0019) while it removed the `starMix`, `field` and `fgstars` overrides (ADR 0031). Four things did not fit.

1. **The `lines` cases** (M4's line-work alone, with calibration seeds) carry `starMix 0`, `field 0` and `fgstars 0` beside `stipple 0`, `knots 0` and `sparkle 0`. ADR 0031 retires those three overrides on the cases the engine could not draw; here they are not a limitation but part of isolating the line-work, so that the held-out calibration (ADR 0018) measures the renderers' differences in the pens alone.
2. **The orbit check** (`tools/gpu-test/orbit.mjs`) asserted that no mark count changes in a drag. The breathing room round a drawn star is a pure filter of the view tier: the dots it clears, and so the drawings those that remain use, follow the camera. With the stars drawn, `dots`, `old`, `disc`, `young` and `used` change in a drag, as they do in v21, where the same filter runs at every frame.
3. **The drawn stars' raster check** (`tests/gpu/stars.ts`) compared the GPU's raster of the GPU's capsules with the CPU raster of the CPU's capsules. Their positions agree within 1.3e-4 px (and are checked to 0.05 px), but coverage is a step at an edge: with 56,000 capsules a sample within that distance of one falls on either side in a deterministic few cases, and a sample is 0.25 of a pixel (Grand design, zoom 2.5).
4. **The GPU pages' time limit** of 180 s a page is the wall clock of a quiet machine; `tiers.html` and others time out when the machine is shared.

## Decision

1. The `lines` cases keep their three overrides, with the reason in `extra-cases.json`'s `about`. Every other case has none of them.
2. The orbit check compares every count except `dots`, `old`, `disc`, `young` and `used`, which the view filter owns; the model tier must still not run and the view tier must.
3. The stars' raster is compared on the same inputs: the CPU rasteriser draws the GPU's capsules. Positions keep their own tolerance (0.05 px), so the check that the two engines make the same capsules is as strict as before; what changes is that the raster comparison no longer re-measures the position tolerance at an edge.
4. `ROSSE_GPU_TIMEOUT_MS` sets the page limit (default unchanged, 180 s).

## Consequences

- If the owner would rather the `lines` cases draw the sky and stars, the line-work set is captured again without the three overrides, and its thresholds are calibrated again.
- The stars' raster tolerance (1/255) is unchanged.
