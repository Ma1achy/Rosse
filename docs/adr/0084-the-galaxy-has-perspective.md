# 84. The galaxy has perspective

Date: 2026-10-09

## Status

Proposed. A deliberate divergence from v21, requested by the owner, on the page only.

## Context

v21 projects the galaxy orthographically: a mark's size and its distance from the centre do not depend on how near it is. Tilted, the near and far halves of the disc look alike, and zoomed out a galaxy flattens to an ellipse with no depth cue to read its structure from. The deep field already has a perspective camera (CAM 30), but the galaxy is a unit or two across and is not seen through it.

## Decision

A view-tier choice `depthAuto` ("Depth", 0 in the core): 0 flat, 1 marks shrink with distance (the page), 2 full perspective. The `View` uniform's spare word `persp` carries it: 0, `-GALAXY_PERSP` or `GALAXY_PERSP` (0.075, 1 / camera distance, about 13 galaxy units), the sign saying whether the offsets scale too. Each mark's view-frame depth `d` gives `k = 1 / max(1 - d persp, 0.3)`, and its size is scaled by `k` (mode 2 also its plate offset from the centre; mode 1 keeps the orthographic positions, which the owner prefers) and, in both, by `min(1, (scale / 84)^0.35)`, so marks shrink as the view zooms out and a zoomed-out galaxy does not clot into an ellipse. Offsets and sizes (`persp_k`, shaders/common/camera.wgsl, `perspK` in fallback/kernels/project.ts). The ribbon kernel's point projection (curves, lane points, carving lines, hatch anchors, drawing anchors) uses the same factor, so the culls that compare marks with the line-work still agree. A Sérsic 2D sample, which has no depth, keeps k = 1. With `persp` 0 the factor is exactly 1 and every output is bit for bit the orthographic one.

Not yet scaled: ribbon widths, the drawn cores' sizes, and the merger and sky paths.

## Consequences

- The near half of a tilted disc draws larger, more spread marks and the far half smaller, denser ones; orbiting changes it every frame (view tier; no model rebuild).
- `depthAuto` 0 is v21's projection; goldens are unchanged.
