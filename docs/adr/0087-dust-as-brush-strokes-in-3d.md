# 87. Dust as brush strokes in 3D

Date: 2026-10-10

## Status

Proposed. A deliberate divergence from v21, requested by the owner, with `strokesAuto` (ADR 0082, on the page).

## Context

v21's dust is hatch pen lines laid along the lanes, in the disc plane, and its edge-on look was a billboard stroke (ADR 0081 removed it). The owner asked for dust drawn with varied brush strokes, swirls and lines that have real x, y and z, not strokes limited to a plane.

## Decision

With `strokesAuto`, each ribbon-arm galaxy also gets dust wisps (`dustWisps`, role `dust-wisp`, src/model/curves.ts): `arms · (3 + 5 · dust)` short strokes, each on the inner edge of an arm (a little behind its phase), 0.55 long in radius, swirling (a radius wobble of 5 to 12%), at a height of up to 0.25 above or below the plane (falling with radius) with a slope along the stroke and a gentle wave. Face-on they are curls along the arm; edge-on they are wisps standing above and below the midplane, which is the volume the removed edge-on strokes faked. They are ordinary ribbons, drawn from their own counters (`CurveIndex.dustWisp`), in the galaxy frame, so the camera only looks at them.

## Consequences

- More brush strokes in the arms, with their own heights; no kernel changes.
- Not yet: wisps that follow the actual dust model's density, and wisps on galaxies without arms (a ring or a smooth disc).
