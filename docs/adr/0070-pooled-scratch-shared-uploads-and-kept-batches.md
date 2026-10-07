# 70. Pooled scratch buffers, shared uploads and kept batches

Date: 2026-10-07

## Status

Proposed. It adds to the resource lifetimes ADR 0010 describes; it does not edit that ADR, which stays as accepted.

## Context

ADR 0010 says what each tier rebuilds. It does not say how the rebuilding is done, and until M10 it was done naively:

- A model-tier rebuild created every buffer again (about 76 `createBuffer` calls for a `Grand design` seed change), however small or unchanged, and destroyed the last set.
- Every view-tier run (every orbit frame) called `GpuRenderer.setLayers`, which destroyed every ink batch and built them again: 18 buffers and 19 bind groups per frame, all of them identical to the last frame's, because the model tier's buffers had not moved.
- Read-backs (tests and statistics) created a staging buffer each time.

The sizes are small at today's scenes (3 MB of buffers, a few KB of uploads), so the saving is mostly in object counts, which is what a browser's WebGPU implementation pays for on every frame. It grows with the deep field and the lens (M7, M9), whose buffers are larger.

## Decision

1. **`BufferPool`** (src/gpu/pool.ts) serves the model tier's scratch buffers (samples, projected instances, the scans' work buffers, the line-work's and vectors' outputs, readback staging). A released buffer is kept for the next acquire of its size class (2^k × {1, 1.25, 1.5, 1.75}, never beyond the device's binding limit). A reused buffer is cleared with `clearBuffer` before the work that reads it is submitted, because a new buffer reads as zero and some passes depend on it. Idle buffers beyond 256 MB are destroyed, oldest first.
2. **`UploadCache`** serves uploads of data no pass writes (the galaxy's pools and dot sizes, the noise field, the pen tables, the line-work's input arrays). It is content-addressed with a byte-for-byte check on a hit, so it cannot serve other data, and only holds uploads of up to 1 MB. A buffer a pass writes (a counter, draw arguments) is scratch with an initial value (`GpuResources.init`), never a shared upload.
3. **`GpuRenderer.setLayers` keeps a batch** whose layer has the same key (kind, population, gain, the identity of every GPU buffer it draws and its offsets and counts). A camera move that does not touch the model tier builds no batch for the GPU layers; only the cores, a CPU instance list placed for the view, are rebuilt. A resize or a new atlas drops every batch.
4. **No shader may ask a binding for its length** (`arrayLength`), because pooled buffers may be larger than asked. None does now; a new one takes its count from a uniform.

## Consequences

- Output does not change. `tests/gpu/reuse.ts` renders a scene, another, and the first again on reused buffers, and requires the samples, projected instances, per-class counts and ink to hash the same; it also checks that a camera move builds at most one batch and creates at most four buffers and bind groups. The engine hashes of tests/golden/engine-hashes.json are unchanged.
- A model-tier rebuild on a pool in steady state creates no scratch buffer (the test sees 0 new ones for the second visit to a scene).
- Memory is held between rebuilds (up to the pool's limit). The page can call `trim()` on a memory warning; nothing does yet.
- A pass that reads a pooled buffer before writing it, and does not need the zero a new buffer has, would pay a clear it does not need. The pool has `zero: false` for the staging buffers; others can use it.
