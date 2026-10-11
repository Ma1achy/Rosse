# 81. Line-work in 3D

Date: 2026-10-09

## Status

Proposed. An optional, experimental divergence from v21, requested by the owner. Off in the core and, for now, off on the page.

## Context

v21 keeps its edge-on look with camera-dependent switches: the `incE` buckets pick which strokes and drawings exist at each tilt, and the midplane stroke appears past 80 degrees. Tilting the camera makes them pop. The owner does not want fading or dithering to hide this; the line-work should be real geometry in the galaxy's space, so the camera only looks at it.

## Decision

A model-tier parameter `lineWorld` ("Line-work in 3D", 0 in the core). With it on:

- The structure key is `'world'` (src/view/camera.ts), and `structuralIncl` gives the curve and vector description a fixed inclination of 0, so no `incE` bucket changes with the camera. Orbit and zoom still do not rebuild the model (ADR 0010, 0017).
- Dust lanes are drawn as arcs of rings lying in the disc plane (`laneRings`, role `lane-ring`, src/model/curves.ts): 2 to 3 arcs per ring, a little wobble and z jitter, tapered, so seen edge-on they are a band of real strokes and seen face-on a set of faint arcs.
- The edge-on midplane stroke is not emitted, because the inclination it keys on is fixed.

The CPU and GPU twins are unchanged (the arcs are ordinary ribbons).

## Consequences

- No pop under tilt from the line-work. Arcs are faint near face-on; making them more visible, giving arm strokes thickness out of the plane, and a 3D core are later slices.
- `lineWorld` 0 is v21's drawing; goldens are unchanged.
