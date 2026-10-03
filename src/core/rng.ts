/**
 * Seeded random numbers, CPU side.
 *
 * Planned (ADR 0004): a counter-based generator, so any draw can be computed from
 * (seed, stream, index, draw) without generating the ones before it. The same integer hash is
 * implemented in WGSL (src/shaders/common/rng.wgsl) and both are tested against shared vectors, so
 * CPU and GPU agree bit for bit. Stream ids replace the reference's ad hoc seed formulae
 * (`mulberry32(P.seed * 9973 + 1)` and others; see docs/reference-notes.md).
 */
export {};
