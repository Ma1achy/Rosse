# TypeGPU evaluation (M1, ADR 0014)

Date: 2026-10-03. TypeGPU 0.12.6 with unplugin-typegpu 0.12.4 (esbuild), in a scratch project (not a dependency of this repository).

## What was tried

ADR 0014 asked for a trial on one real kernel before more kernels are written. The stipple sampler does not exist yet (M2), so the trial used the kernel M1 does have and which is the hardest to get exactly right on two backends: the counter-based RNG of ADR 0004. `pcg4d`, the u32-to-uniform mapping and Box–Muller were written as TypeGPU `'use gpu'` functions, once with plain operators and once with `std.add` and `std.mul`. Each was then:

1. resolved to WGSL with `tgpu.resolve`;
2. called as ordinary JavaScript in Node, and compared with `src/core/rng.ts` (which matches the GPU bit for bit, `npm run test:gpu`) on 1,000 keys.

## Results

**The generated WGSL is good.** It is almost line for line the hand-written `src/shaders/common/rng.wgsl`: `var v = vec4u(((k.x * 1664525u) + 1013904223u), …); v.x += (v.y * v.w); …`, with literals typed (`1664525u`, `-2f`), and functions kept as functions. Nothing to object to for kernels of this kind.

**The CPU execution is not exact, for integers or for f32.**

- u32 arithmetic runs in JavaScript doubles. Products of two u32 values exceed 2^53, so the low bits are lost before any wrap. `pcg4d` gave the wrong answer on **1,000 of 1,000 keys**. `std.mul(u32, u32)` behaves the same (`std.mul(4000000000, 1664525)` returned 6658100000000000, not 3043035136).
- `>>` on a u32 is JavaScript's signed shift, so `f32(u >> 8) * 2^-24` returned a negative number (−0.130 instead of 0.870) for `u = 0xdeadbeef`.
- Scalar float expressions run in f64: `gauss` returned an f64 value (not representable in f32).
- What is exact: the data constructors and casts. `d.u32(2^32 + 5)` is 5, `d.u32(-1)` is 4294967295, `d.f32(0.1)` and `vec4f` components are rounded to f32. So values are wrapped and rounded when they are stored in a TypeGPU type, but not between operations.

To make the CPU path exact, every integer multiply would need `Math.imul` and every float operation `Math.fround`, which TypeGPU's transpiler does not emit and which would not translate back to WGSL. That is the "f32 matching is not automatic" risk ADR 0014 named, confirmed and worse for integers than expected.

## Recommendation

**Stay with K1** (hand-written WGSL plus a TypeScript twin and a parity test per kernel), as ADR 0014 proposes. The owner can accept ADR 0014 as it stands (open question Q4), with this note as the evaluation it called for. The parity tests M1 adds (RNG vectors bit-exact on the GPU, and the CPU raster within 1/255 of the GPU raster) are the guard that K1 relies on, and they work.

Revisit only if TypeGPU's CPU execution gains exact u32 and f32 semantics (a "strict numerics" mode). Its WGSL generation is already good enough that it would then be worth a second look for new kernels.
