# 11. Without WebGPU: a CPU-only engine that runs the same kernels and matches the GPU

Date: 2026-10-03

## Status

Accepted. The owner asked for "a CPU-only fallback that matches" at kickoff.

## Context

WebGPU is in Chrome and Edge (desktop and Android), Safari 26 and Firefox 141+ (Windows), but not everywhere: older Safari, Firefox on Linux and macOS, locked-down enterprise browsers, and some headless environments. Without a fallback, those visitors see nothing.

The options considered were:

- **(F1)** a notice, plus the unchanged v21 WebGL page as a "classic" renderer. This is cheap, but it does not match: it is a different engine with different randomness (ADR 0004/0005).
- **(F2)** a WebGL2 port of the GPU passes, with transform feedback or fragment-shader GPGPU. That is a second GPU engine, and still a GPU.
- **(F3) a CPU engine** that runs the same kernels in TypeScript in a worker, with the same random numbers and the same arithmetic, and rasterises in software with the same ink maths.

## Decision

Option F3, as the owner asked.

- **Same scene description.** The CPU-side code of ADR 0003 (variation, control points, part placement, sky catalogue, merger core track, lens halos) is shared code, not duplicated.
- **Same kernels.** Every WGSL compute pass has a TypeScript twin in `src/fallback/kernels/`. Each twin has the same structure, the same names and the same per-element function. How the two are kept in step is ADR 0014.
  - Arithmetic is f32: every intermediate goes through `Math.fround`, or uses `Float32Array` storage.
  - The RNG is the same integer hash (ADR 0004).
  - Compaction is the same sequential order as the GPU scan.
- **Same rasteriser maths.** A small software rasteriser in the worker draws:
  - bitmap quads, with bilinear sampling of the same mip levels and the same smoothstep ink edge;
  - capsule ribbons, with the same analytic coverage.

  Because the GPU path uses no MSAA (ADR 0007), coverage is computed at pixel centres on both paths and the rasteriser has nothing to emulate. It writes premultiplied ink to a `Float32Array` and composites onto the surface in an `OffscreenCanvas`.

- **Expected speed** (one core, modern laptop):
  - model tier: 20–200 ms, with merger integration at the high end;
  - view tier: 20–60 ms;
  - raster: 10–40 ms for about 50k marks.

  Orbiting therefore runs at about 10–20 frames per second, and lens and merger changes take a beat. The page shows a quiet "drawn on the CPU" note.

- **What "matches" means:** L1 of ADR 0004. That is identical structure, instance buffers within the L1 tolerances, and images passing the golden metric at its strict thresholds against the WebGPU render. CI checks it on every golden case: the CPU fallback in Node against WebGPU on SwiftShader in Chromium.
- The v21 page remains in `assets/reference/` as the oracle. It is not a fallback.

## Consequences

- Every kernel is written twice, or generated twice (ADR 0014). This is the largest ongoing cost of the project, roughly +40% on kernel work, and the parity test is what keeps it honest.
- The CPU engine is also a debugging tool: any GPU pass can be compared element by element with its twin, in Node, without a browser.
- The fallback runs in Node, so most golden checks for structure can run without a GPU, and quickly.
- Some GPU-only optimisations (sub-group operations, f16 storage) need a CPU twin with the same results, or must stay out of passes whose outputs are compared. For example, ADR 0009's f16 timeline snapshots: the CPU twin rounds to f16 too, with a software f16 conversion.
