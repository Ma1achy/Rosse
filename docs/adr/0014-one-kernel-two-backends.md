# 14. Kernels: hand-written WGSL with a TypeScript twin, tested for parity

Date: 2026-10-03

## Status

Proposed. Awaiting the owner's choice (open question Q4).

## Context

ADR 0011 requires every compute kernel to run on the GPU (WGSL) and on the CPU (TypeScript) with matching results. The brief asks for WGSL in its own files. The options considered were:

- **(K1) Hand-written WGSL plus a hand-written TypeScript twin**, with the same structure and names, and a parity test per kernel that runs both on shared inputs and compares outputs. Each language is idiomatic and debuggable, and there are no dependencies. The cost is that every kernel is written twice and can drift; the parity tests are the only guard.
- **(K2) A single source in TypeScript compiled to WGSL**, for example TypeGPU (Software Mansion, 0.x), whose `'use gpu'` functions are transpiled to WGSL and can also run as JavaScript. One source and no drift, but:
  - it is young (pre-1.0), so APIs and codegen change;
  - its CPU execution uses JavaScript doubles unless we wrap every operation in `fround`, so f32 matching is not automatic;
  - the generated WGSL is not hand-tuned;
  - it departs from "WGSL in its own files".
- **(K3) WGSL as the single source, interpreted or transpiled for the CPU.** There is no mature WGSL-to-JavaScript compiler or interpreter today. naga has no JavaScript backend, and building one is a project in itself.
- **(K4) Our own small kernel language** generating both. Too much tooling for this project.

## Decision

Proposed: **K1**, with discipline:

- **One kernel, one pair of files:**
  - `src/shaders/compute/x.wgsl`;
  - `src/fallback/kernels/x.ts`.

  Each exports the same per-element function (`fn sampleDisc(i: u32) -> Sample` and `sampleDisc(i: number): Sample`), and the dispatch wrappers stay thin.

- **Shared constants** come from one place. A generated `src/shaders/common/constants.wgsl` is written from `src/core/constants.ts` at build time.
- **A parity test per kernel**, from M1: random inputs from the shared RNG run through both, and outputs are compared within the L1 tolerance (ADR 0004). These run in CI on SwiftShader on every push.
- **TypeGPU is re-evaluated** in M1 with one real kernel (the stipple sampler). If it produces equivalent WGSL and can run f32-exact on the CPU, a superseding ADR moves to K2 before more kernels are written.

## Consequences

- The kernel count is about 12 (the list in `src/shaders/compute/`). Doubling them is a known, bounded cost, estimated at +40% on kernel work in the roadmap.
- A kernel change touches two files, and review checks both. CONTRIBUTING.md says so.
- If the M1 TypeGPU evaluation succeeds, the switch happens before the bulk of the kernels exist, which is when it is cheap.
