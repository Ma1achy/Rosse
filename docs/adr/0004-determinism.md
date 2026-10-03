# 4. Determinism: counter-based random numbers, ordered compaction, and a stated meaning of "same"

Date: 2026-10-03

## Status

Accepted

## Context

The same parameters and seed must give the same drawing on any machine. The reference achieves this, more or less, by running everything sequentially on one thread from a handful of `mulberry32` streams. Each stream is seeded from `P.seed` by an ad hoc formula, such as `P.seed * 9973 + 1` for the model (app23.js:L176); docs/reference-notes.md lists them all. That design has four properties a GPU cannot keep:

- **Streams are consumed in order, with a variable number of draws per sample.** Rejection loops (L248–253, up to 30 tries), early `continue`s and short-circuit conditions (L262–265) decide how many numbers each sample takes. Sample _n_'s randomness depends on every sample before it. A parallel GPU cannot reproduce this. It is also why, in the reference, a view-dependent cull (`inLane`, L265) re-rolls the whole stipple when the camera orbits (docs/reference-notes.md, flagged item 1).
- **Its hash is `sin`-based** (`hash2`, L73: `sin(x·127.1 + y·311.7)·43758.5453`). `sin` at large arguments is not specified exactly in JavaScript or in WGSL, and in f32 it is useless as a hash.
- **Order of output** is the order of `push`. On a GPU, appending through an atomic counter gives an order that changes from run to run.
- **Floating point.** WGSL does not require correctly rounded `sin`, `cos`, `exp`, `log`, `pow`, `atan2` or `sqrt` (the spec gives error bounds in ULPs), and it allows fused multiply-add contraction. Different GPUs can therefore produce slightly different positions for the same sample. Near a threshold (an accept/reject test, the edge of a dust lane) that can flip a decision.

The options considered were:

- emulating mulberry32 streams on one GPU thread: deterministic but serial, which defeats ADR 0003;
- per-thread mulberry32 seeded by index: each stream is fine, but the seeding is weak and correlated;
- a **counter-based generator**: a stateless hash of (key, counter), as in Philox, Threefry or PCG-hash.

## Decision

1. **Random numbers are a pure function of (seed, stream, index, draw).**
   - We use a counter-based integer hash: the PCG output permutation applied to a four-word key, `pcg4d` (Jarzynski and Olano, _Hash Functions for GPU Rendering_, JCGT 2020).
   - This is implemented identically in WGSL (`src/shaders/common/rng.wgsl`) and TypeScript (`src/core/rng.ts`), using only 32-bit integer operations, so both give the same bits. They are tested against shared vectors.
   - `stream` is a named constant per stage (stipple, knots, clumps, sky, merger initial conditions, lens sources and so on). `index` is the sample or mark index. `draw` counts draws within a sample.
   - Uniform floats are `f32(u >> 8) * 2^-24`. Gaussians use Box–Muller on two draws.
2. **Every sample owns its random numbers.** Rejection loops are bounded, as they already are in the reference, and consume draws from their own sample's counter only. A view-dependent decision (a dust-lane cull, a bright star's breathing room, dust optical depth) is a _pure filter_: it reads a stored per-sample random number and never shifts anyone else's. Orbiting therefore never re-rolls the stipple.
3. **No order-dependent atomics in any output.**
   - Compaction uses a deterministic prefix sum (`compute/scan.wgsl`: a work-group scan plus block offsets), so output order is input order.
   - Atomics are used only for commutative integer results that are not order-sensitive, such as counts and integer min/max.
   - No floating-point atomics, and no float accumulation in scheduling order.
   - The lens solver puts its hits into a canonical order (by triangle id) before de-duplication (ADR 0008).
4. **No transcendental function decides structure where an integer can.**
   - Tile choice, pool choice and stream choice use integer arithmetic on the hash.
   - Value noise (`vnoise`) is rebuilt on an integer-hash lattice.
   - Thresholds compare a uniform in [0, 1) against a probability. Where the probability comes from `exp` or `log`, that is accepted, and its cross-GPU risk is measured (see L1 below).
5. **What "same" means.** There are three levels, each with its own test:

| level | scope | guarantee | test |
| --- | --- | --- | --- |
| **L0** | same build, same browser, same adapter and driver | bit-identical instance buffers and bit-identical image | CI renders every golden case twice on SwiftShader WebGPU and compares hashes; the new engine's own goldens are bit-exact on SwiftShader |
| **L1** | any machine, any conformant WebGPU adapter, and the CPU fallback (ADR 0011) | identical structure: the same drawings chosen, the same counts per class within ±0.1%, and ≥ 99.9% of instances matching within 0.05 plate px in position, 0.1% in size and 1e-3 rad in angle; images pass the golden metric (ADR 0013) at its strict thresholds | M10: instance-buffer diff between SwiftShader, two real GPUs and the CPU fallback, on the full preset set |
| **L2** | against the reference page (v21) | statistical parity (ADR 0005): same structure and same ink, never the same dots | golden metric (ADR 0013) at its parity thresholds |

## Consequences

- The new engine will **not** reproduce the reference sample for sample. That is ADR 0005, and it is the main reason for its golden metric.
- Turning the camera never changes which marks exist, only where they are seen. Changing the seed changes everything. Changing one parameter changes only the samples it affects. This is a behavioural improvement on the reference, which re-rolls on orbit; the user decides whether to keep it (open question Q2).
- Every compute pass that writes a variable number of outputs needs a count pass, a scan and a write pass: two or three dispatches instead of one.
- L1 is a measured property, not a proof. A decision flips if a value lands within a few ULPs of its threshold. With about 50k samples and well-spread thresholds we expect a handful of flips per drawing at most, and the tolerance absorbs them.
