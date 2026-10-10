# 89. Jets, streams and tails as 3D stroke bundles

Date: 2026-10-10

## Status

Proposed. A deliberate divergence from v21, requested by the owner, with `lineWorld` (ADR 0081, on the page).

## Context

v21's jet is one stretched bitmap, its streams are pen-line drawings laid along an arc, and its tidal tail is one curve. They read as squiggles with no width or depth. The owner also asked to retire the sliders for the old stand-ins that real lensing, shells and artefacts replaced (drawn arcs, drawn shells, satellite trail and cosmic rays, the stray arrow, closed curves as bubbles).

## Decision

- With `lineWorld`, ribbons draw them (`jetStrands`, `streamStrands`, `tailStrands`, src/model/curves.ts), from their own curve counters. The jet is a bright spine and a twisting cone of strands along the galaxy's axis, a third of them short and bright at the root, the rest ending at different lengths so the tip feathers; the streams are a band that is narrow at the progenitor and fans out along the same arc and tilt as the pen-line stream; the tail is a fanning bundle that lifts out of the plane. The old bitmap jet, pen-line tail and pen-line streams are not drawn when strokes are on (`lines > 0`).
- The five sliders leave the page (`control: false`, out of the layout); the engine still reads the parameters so v21's drawings are unchanged, and the page sets them to 0.

## Consequences

- Volume, and a real shape edge-on, for features that were flat marks; galaxies drawn without line-work have no jet, stream or tail on the page.
- A galaxy's saved or URL state that set the five parameters keeps them, but they no longer draw on the page.
