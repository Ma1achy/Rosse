# 88. A merging galaxy's marks follow depth

Date: 2026-10-10

## Status

Proposed. Step 1 of unifying the merger path with the single-galaxy path; flagged by `depthAuto` (ADR 0084), so v21's merger is unchanged.

## Context

A merger's galaxies are built as face-on single-galaxy scenes and carried to the plate by a 2D tidal map (ADR 0009). Their marks therefore knew nothing of the depth the N-body sim gives each star, and ignored `depthAuto`, while the debris sprites (ADR 0084) followed it. Real unification needs the tide to carry depth, then thickness, then one view interface for both paths; this is done in steps.

## Decision

Step 1: the tide buffer gains one word per star, the mark scale of its depth in this view (`1 / max(1 − (vz − fcz)·persp, 0.3)` times the zoom shrink, the debris sprite's own factor; exactly 1 without `persp`), written by the sprite kernel beside the plate position. Each grid vertex gets a third value, the inverse-distance mean of its four nearest stars' scales, interpolated like the position. `warp_instances` scales the mark's 2×2 matrix, `warp_ribbons` scales each end's corners about their midpoint, `warp_caps` scales the width, all only where the scale is not 1. Words 0–8 now head the buffer (word 8 is the offset of the scales) and a grid vertex is 3 words.

Next steps: z-thickness of a merging disc along its normal's screen projection; then fold the sky, debris, shell and lens layers behind one view-tier interface so the page stops branching on `P.merger`.

## Consequences

- A merging galaxy's near side is drawn larger and its far side smaller, with `depthAuto`.
- GPU = CPU on the new channel (tests/gpu/tide.ts).
