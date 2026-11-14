# 104. Companions are lensed by depth

Date: 2026-11-14

## Status

Proposed. Rides on `lensField` (ADR 0102).

## Context

The sky's companions (1–4 drawings placed in 3D about the galaxy, v21 L913–919) are rows of the main galaxy's vector set, not of the deep field's, so ADR 0102's lens did not reach them.

## Decision

With `lensField` and `lensOn`, a companion row carries its depth share (`lensDepthK` of its view-space z; `VectorRow.lensK`) and is a `WarpKind.lens` instance: the main set's expansion reads the field's lens (the `LensZ` uniform at binding 32, written each view), so a companion behind the lens plane is bent vertex by vertex, and one in front is not. The companions sit within about 5 units of the lens plane, so their share is small (at most about 0.2): they are moved and bent a little, not made into arcs.

## Consequences

- The core is v21's: without `lensField` nothing changes.
- Companions are bounded by their own depth, which is the point: a real object near the lens is barely lensed by it.
- The subject galaxy and a merger's galaxies are not companions of this kind: the subject is the lensed source of the M9 lens (`lensOn`), which already finds every image by the triangle map (ADR 0008), and a merger is that lens's host. Neither is lensed by the field's lens.
- Not done: several lens planes. A second lens needs a description (a mass, a place, a depth) that no parameter holds yet; with the per-object share of ADR 0102 and a plane's depth it composes by tracing the rays plane by plane.
