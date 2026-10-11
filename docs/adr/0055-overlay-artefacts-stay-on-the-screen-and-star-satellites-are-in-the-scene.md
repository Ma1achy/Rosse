# 55. Overlay artefacts stay on the screen, and star satellites are in the scene

Date: 2026-10-09

## Status

Accepted. A deliberate divergence from v21 (docs/architecture.md), at the owner's request. It extends [0030](0030-overlays-take-an-explicit-home-orientation.md).

## Context

v21's `starSprites` (app23.js:L400–436) sizes everything by `U = VIEW.scale`, the zoom. An overlay satellite trail and its cosmic rays therefore grow and shift with the zoom, although they are camera artefacts (ADR 0030 keeps them on the image under an orbit). v21 also places only the primary star in the scene: its fainter neighbours are a pure screen offset from the plate centre, so a cluster does not behave as a constellation under orbit, and an overlay star has no neighbours at all (`P._ov ? 0 : 3 + …`).

## Decision

1. **An overlay trail and an overlay's cosmic rays use the zoom-1 scale** (`viewScale(1)`, 84 px per unit) for their half-length, offset and hit centres: the same job geometry at any zoom. A subject artefact keeps the zoom. An overlay ghost keeps the zoom too: it is the reflection of its star, whose scene point moves with the zoom, so its radii must scale with the star's glare. The kernels read the job's pixels (`a`, `b`, `c`) and need no change.
2. **Every star of a star sprite is a point in the scene.** A satellite (index above 0) is placed by `scenePoint(home, …)` at its offset from the primary (the plate centre, or the overlay's place) and at the primary's depth plus `satelliteDepth`, a deterministic jitter of -0.8 to 0.8 units from its brightness pick (no new draw; the picks and v21's replayed ones are unchanged). Under orbit and zoom the cluster moves, scales and changes its relative positions. The diffraction spikes' angle (`spikeA`) stays fixed on the screen.
3. **An overlay star has satellites** drawn from its own streams like the subject's (`ownCtxPicks`), faint and not full (no spikes, rings or bleed). The slot capacity follows, as it is the jobs' own count at the largest zoom.

## Consequences

- At the home camera and zoom 1 a satellite sits where v21 puts it, up to the jitter in depth, which shows only as a tiny parallax at home. A subject star's orbit and zoom captures, and every overlay star, differ from v21's; the `Star` and `Layered` goldens and the engine hashes of the cases with an overlay artefact, a subject star or an overlay star change.
- A scene that is not a star, or an overlay with no star, is unaffected.
