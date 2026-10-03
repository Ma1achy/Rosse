/**
 * The CPU engine: runs when WebGPU is unavailable (ADR 0011).
 *
 * Planned: a worker that takes the same scene description as the GPU path, runs the TypeScript
 * twins of the compute kernels (./kernels/, ADR 0014) with f32 arithmetic and the shared
 * counter-based RNG, and rasterises with ./raster.ts. Its output must match the GPU at level L1
 * of ADR 0004, checked in CI.
 */
export {};
