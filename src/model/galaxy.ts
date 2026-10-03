/**
 * The galaxy model, CPU side: turns parameters into the small descriptions the GPU samples from.
 *
 * Planned (ADR 0003): component weights (bulge, halo, bar, ring, disc), arm phases and profile
 * coefficients, spurs, clumps, dust patches, warp and lopsidedness, packed into a uniform/storage
 * buffer for compute/stipple.wgsl. The reference samples everything sequentially on the CPU in
 * `generate` (app23.js:L175).
 */
export {};
