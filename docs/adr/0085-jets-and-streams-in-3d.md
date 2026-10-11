# 85. Jets and stellar streams in 3D

Date: 2026-10-09

## Status

Proposed. A deliberate divergence from v21, requested by the owner, with `lineWorld` (ADR 0081, on the page).

## Context

v21 draws the radio jet as two sprites at a fixed angle in the plate, and bends each stellar stream's pen line round the galaxy in the plate's own axes ("the streams lie in the plate, whatever the camera"). Orbiting changes neither: they are stickers on the picture, the one thing that does not live in the space everything else does.

## Decision

With `lineWorld`:

- The jet runs along the galaxy's own axis, tilted 0.14 rad off it towards the picked angle, 3 to 4 galaxy units for the main lobe and 0.65 of that for the counter-jet. Each lobe's tip is projected by the camera (`vectorRows`, src/model/parts.ts); the sprite lies from the centre to the tip, as long as the projection and at least 1.4 widths, and 0.2 of the lobe's length wide. Face-on it points at the viewer and is a short blob; edge-on it stands out of the disc.
- Each stream lies on an orbit tilted out of the galaxy's plane by `streamTilt` (0.35 to 1.3 rad, its own counter `PartIndex.streamTilt + q`), its points lifted to 3D and projected (`streamSegments`, src/model/vectors.ts). The kernels are unchanged: they already receive plate-space segments, built per view.

## Consequences

- Orbiting turns, foreshortens and slides both; a stream seen along its orbit's plane is a line.
- `lineWorld` 0 is v21's jet and streams. No new draws move other parts.
- Not yet: the dots of a stream are not occluded by the disc in front of them, and the jet does not thin with distance.
