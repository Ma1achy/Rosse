# 95. Shells are in the scene

Date: 2026-10-13

## Status

Proposed. Opt-in (`shellAuto`, "Shells in 3D": 0 in the core so v21's goldens hold, 1 on the page). A deliberate divergence from v21, requested by the owner.

## Context

The shell galaxy's satellite is integrated in 3D (x, y, z in a logarithmic potential), but v21 draws it from x and y only, turned by the infall axis, and its detected arcs through a face-on camera. The shells follow neither `incl`, `az` nor `pa` (reference notes 20.14): orbiting the galaxy changes nothing, so the shells read as a picture laid over the galaxy rather than a structure around it.

## Decision

With `shellAuto`, in the page's single-galaxy view:

1. **The stars are drawn in the scene.** Each star's (x, y, z) is turned by the infall axis about z, then projected through the galaxy's camera (the same `az`, `incl`, `pa` rotation the stipple uses). The kernels take the camera as a uniform (`SSim.mode` and the six sines and cosines), on both engines (`src/fallback/kernels/shells.ts`, `shells.wgsl`).
2. **A shell is a cap of a sphere.** Each detected arc keeps its meridian (v21's arc) and gains its rim, the circle round the infall axis at the shell's opening angle, as a second stroke, so a turned camera sees the shell's shape and not one edge-on line. Both go through the real camera.

A merger's shells (shells inside a merger scene) keep v21's flat image; there the camera belongs to the debris's frame.

## Consequences

- The core is v21's: without `shellAuto` nothing changes (the goldens hold).
- The shells are not perspective-scaled, and not dimmed by the galaxy's dust; both are further steps.
- The detection (radii, sides and opening angles) is unchanged: it is a statistic of the stars about the axis, so it is the same from every camera.
