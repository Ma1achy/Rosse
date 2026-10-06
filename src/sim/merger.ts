/**
 * Mergers: two galaxies on a parabolic orbit with test stars (restricted N-body).
 *
 * Planned (ADR 0009): the two cores' track integrated on the CPU in double precision, the test
 * stars integrated on the GPU with the same kick-drift-kick leapfrog and step (dt = 0.012), the
 * snapshots for the timeline, and the tidal warp grid that carries each galaxy's drawings.
 * Reference: `simulateMerger`, `mergerSprites` (app23.js:L304, L481).
 */
export {};
