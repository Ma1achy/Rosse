/**
 * Software rasteriser for the CPU engine: bitmap quads (bilinear, same mip choice, same smoothstep
 * ink edge) and capsule ribbons (same analytic coverage) into a premultiplied Float32Array, then
 * composited onto the surface. No MSAA to emulate, because the GPU path uses none (ADR 0007).
 */
export {};
