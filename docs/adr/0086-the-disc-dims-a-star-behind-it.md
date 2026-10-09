# 86. The disc dims a star behind it

Date: 2026-10-10

## Status

Proposed. A deliberate divergence from v21, requested by the owner, on the page only. It extends [0074](0074-the-star-is-dimmed-by-the-dust-in-front-of-it.md).

## Context

ADR 0074 dims an overlay star by the galaxy's dust slab alone (`exp(-dustTau)`). That slab is thin (|z| < 0.06), so the effect is subtle, absent when the galaxy has no dust or the line of sight misses the slab (a nearly face-on disc), and weak at the disc's outskirts. The owner found the dimming too subtle, not dramatic, and not always there when a star is behind the disc.

## Decision

A model-tier choice `occlAuto` ("Natural star occlusion", 0 in the core). With it, a star's `keep` also includes the disc's own optical depth between it and the viewer (`discTau`, src/model/stars.ts):

- The disc is a thin sheet of surface density `exp(-R / 1.6)`; the star's place in the galaxy's frame and the direction to the viewer in that frame (`rotInv([0, 0, 1], camera rotation)`) give the point where the line of sight crosses the plane and the radius `R` there.
- `tau = DISC_TAU (4) · exp(-R / 1.6) / max(|cos|, 0.12) · front`, capped at 7: heavy through the bright inner disc, a shallow line of sight crossing more of the sheet, and zero beyond R 3.2. `front` fades in across the plane (smoothstep over ±0.1), so a star in front of the disc, or level with it, is not dimmed, and nothing steps.
- `keep = max(exp(-(dust tau + disc tau)), 0.04)`: a star behind the disc is faint and never wiped out. As in ADR 0074, `keep` thins the marks and shortens the core, glare, spikes and bleed by `sqrt(keep)`.

It is computed on the CPU in the view tier (`starJobs`), so the kernels and the GPU-CPU parity are untouched, and it applies whether or not the galaxy has dust.

## A merger, and the satellites

- **A merger's star** is dimmed by both discs. The sky host's star has no galaxy of its own (its phantom galaxy no longer dims it: `withoutGalaxy` sets `occlAuto` 0), so the merger engines give the host an occluder each view (`mergerOccluder`, src/model/merger.ts; `occluder` on `CpuStipple` and `GpuStipple`, passed to `starJobs`). The star's scene point is placed in the merger's frame by the framing's scale (`frame.c + k · g0`, `k = U / sc`), and each disc is the plane through its core with its spin normal and its own frame, in units of `rmax / 4.2` merger units per galaxy unit; the two optical depths are summed.
- **The satellites** of a star cluster (ADR 0055) are spread twice as deep as before and centred 0.4 of the way from the primary's depth to the plane, so that some of a cluster lie behind the disc and some in front, and are dimmed each by its own place.

## Consequences

- A star behind a disc, face-on or edge-on, is clearly dimmer and smaller, with short spikes; the effect changes as you orbit past the plane.
- `occlAuto` 0 is ADR 0074's behaviour. The merger and satellite behaviour needs `occlAuto` too: with 0 a merger's star has `keep = 1` and the satellites keep v21's depths.
