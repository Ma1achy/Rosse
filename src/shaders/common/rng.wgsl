// Counter-based random numbers (ADR 0004).
//
// Planned: a 32-bit integer hash (PCG-style) of (seed, stream, index, draw), returning u32,
// uniform f32 in [0, 1), and Gaussian pairs. No floating-point state and no sin-based hashing,
// so every GPU computes the same bits. Must match src/core/rng.ts on shared test vectors.
