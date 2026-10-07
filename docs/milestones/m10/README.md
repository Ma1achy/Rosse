# M10: the performance pass

M10 builds the means to measure performance, removes the allocations and re-uploads the measurements showed, moves the CPU engine off the main thread, and puts L1 under a harness. **No real GPU was available, so no budget of docs/architecture.md is claimed on real hardware.** Every number below carries the adapter it was measured on; the real-GPU measurement is an owner action (below, and open question Q14). Numbers are from Chromium 141 with WebGPU on SwiftShader (Playwright 1.56.1) and the CPU engine in Node 22, on a 4-core machine shared with other jobs (load averages are in [perf-report.md](perf-report.md)).

SwiftShader is a software rasteriser running on those same CPU cores. Its "GPU" times are CPU times: they show where the work is and how many objects a frame creates, not what a GPU takes.

## What is built

- **The profiling harness** (`npm run perf`).
  - `tests/perf/perf.ts` is a page that, for each scenario, measures the model tier (a new seed to the frame on screen, split into the CPU scene description, the upload and dispatch, and the rest), the orbit (a camera move through the path the page uses, awaited, its JS side alone, and pipelined), the GPU time of the passes (`timestamp-query`, `src/gpu/profile.ts`: the view compute pass, the ink pass, the composite), the buffers, bind groups and bytes each frame creates and writes, and the memory alive. Mergers (M8) have their own scenarios: the integration in chunks and the timeline scrubbed.
  - `tests/perf/cpu-bench.ts` profiles the CPU engine in Node: scene, model, view, ink, composite.
  - `tools/perf/perf.mjs` runs both and writes one JSON file per adapter to `docs/milestones/m10/perf/`; `npm run perf:report` merges them into [perf-report.md](perf-report.md), the budget table.
  - `ROSSE_WEBGPU_ADAPTER` chooses the adapter for every browser tool (`tools/gpu-test/browser.mjs`): `swiftshader` (the default), `default` or `hardware` (Chromium's own choice, a real GPU where there is one), or any value of `--use-webgpu-adapter`. `ROSSE_CHROMIUM_ARGS` adds flags.
- **Buffer pooling and avoiding re-uploads** (ADR 0070, Proposed).
  - `BufferPool`: the model tier's scratch buffers are kept for the next rebuild, by size class, and cleared when reused (a new buffer reads as zero; some passes depend on it).
  - `UploadCache`: immutable uploads (pools, dot sizes, noise, pen tables) are content-addressed and verified byte for byte on a hit.
  - `GpuRenderer.setLayers` keeps the batch (uniforms and bind groups) of a layer whose GPU buffers did not change. Before, every orbit frame destroyed and rebuilt all of them.
  - Counts, from the same harness before and after (SwiftShader; objects created per frame, medians):

    | | before | after |
    | --- | --- | --- |
    | orbit frame, `Grand design` | 18 buffers, 19 bind groups | 2 buffers, 1 bind group (the drawn core, a CPU list placed for the view) |
    | orbit frame, `Smooth, round` | 8 buffers, 8 bind groups | 0, 0 |
    | orbit frame, `Barred spiral` | 21 buffers, 22 bind groups | 2, 1 |
    | model tier, `Grand design` | 76 buffers, 39 bind groups, 3.1 MB of buffers | 28 buffers, 37 bind groups, 0.1 MB |

    The model tier's remaining buffers are the per-style uniforms of new batches and the uploads that differ between seeds. Wall-clock effects are inside the noise on SwiftShader, where the ink pass takes 150 to 500 ms: the saving is object churn on the CPU side of a frame (1 ms or less now), which a real browser pays on every frame and this harness cannot price.
  - `tests/gpu/reuse.ts` checks that a model rebuilt on reused buffers gives the same samples, projected instances, per-class counts and ink as a fresh one (a stale byte from a missed clear would change a hash), and that a camera move builds at most one batch; `tests/unit/pool.test.ts` tests the pool and the cache. The engine hashes are unchanged.
- **The CPU engine in a worker** (ADR 0071, Proposed): `fallback/core.ts` (no DOM), `worker.ts`, `client.ts`; `?cpuworker=off` runs it on the main thread. `npm run perf:worker` drags the plate 60 times on `Grand design`, with the worker and without:

  | CPU engine, on the page | frames drawn | longest gap between animation frames | long tasks (>= 50 ms) | their total |
  | --- | --- | --- | --- | --- |
  | in the worker | 15 | 27 ms | 0 | 0 ms |
  | on the main thread | 60 | 211 ms | 60 | 7,551 ms |

  M11's page draws mergers and shell galaxies, and the CPU engine integrated them on the main thread. That is in the worker too (`CpuEngineCore` holds the merger and the shells; the page still says "Simulating the merger…" while it builds). Loading the page on `Merger: the Mice` on the CPU engine, the longest task the main thread saw:

  | CPU engine, `Merger: the Mice` first frame | longest task | animation frames in the same time |
  | --- | --- | --- |
  | in the worker | 104 ms (page start-up) | 217 |
  | on the main thread (`?cpuworker=off`) | 2,497 ms | 60 |

  The CPU engine's `layers()` (M12's SVG export) is empty on the page while the layers live in the worker; the export asks `CpuBackend.layers()`, which is asynchronous.

  The worker draws fewer frames because the page coalesces moves while it is busy, and the drag took 2.0 s to feed instead of 9.8 s: the page stayed responsive. The cost of a frame is the same code either way.
- **CPU engine speed, output unchanged.** The composite keeps the surface under the ink between frames (it does not depend on the ink) and copies the rounded surface where there is no ink; the bilinear tap allocates nothing. Both were checked byte for byte against the code they replaced (`tests/unit/raster-background.test.ts` keeps the cache honest). Composite: about 160 ms to 10 ms at 800 px.
- **The L1 harness** (`npm run l1`): a WebGPU adapter against the CPU engine at the strict thresholds, L0 on that adapter, and the hashes against the engine's SwiftShader goldens, one entry per adapter in [l1-report.json](l1-report.json) and [l1-report.md](l1-report.md). Run it with `ROSSE_WEBGPU_ADAPTER=hardware` on a machine with a GPU and commit the changed report.
- **Merger chunking, profiled** (M8 landed first): the test stars integrate in chunks of 200 steps per submit with a wait between. On SwiftShader a horizon of 30 is 64 chunks, 5.1 s to build, a median 76 ms and at most 203 ms per chunk, and the page saw no long task (a frame is never stalled). The snapshots of a horizon of 30 hold 49 MB of buffers, under the 64 MiB budget of ADR 0009 and the main thing to watch on a phone.

## The budget table, with its adapters

Full tables are in [perf-report.md](perf-report.md). Verdicts follow what the measurement can carry.

| budget row | budget | measured, and on what | verdict |
| --- | --- | --- | --- |
| orbit frame, default presets | < 4 ms GPU | SwiftShader: 253 to 653 ms of GPU timestamps (view 20 to 44, ink 153 to 494, composite 62 to 114) | indicative only: a software rasteriser. The ink pass is the cost on SwiftShader; whether it is on a GPU is **not measured** |
| orbit frame, cluster lens or deep field | < 8 ms GPU | not measured | **deferred**: the deep field (M7) and the lens (M9) are not merged |
| parameter change, single galaxy | < 30 ms to first frame | SwiftShader: 272 to 926 ms to the frame on screen; the CPU side of it (scene description, upload and dispatch) is 2 to 6 ms | indicative only; **not measured** on a GPU |
| merger parameter change | < 100 ms to first frame at the default horizon | SwiftShader: 1.6 s (the integration 0.5 s, the rest the software ink pass) | indicative only; **not measured** on a GPU |
| CPU fallback orbit frame | < 100 ms on one core | CPU engine, Node, one thread, load 2 to 3 on 4 cores: 69 to 128 ms | **exceeded** on this machine in 3 of 6 scenarios (`Grand design`, `Barred spiral`, `Hand-drawn arms`); the ink rasteriser is 55 to 102 ms of it. Not met; a faster machine may meet it |
| real GPUs (integrated, discrete, one mobile) | all of the above | not measured | **owner action** |

What the numbers do show, on any adapter: the frame's CPU side is about a millisecond (0.5 to 1.7 ms to record and submit an orbit frame), a camera move re-runs no model tier, and the ink pass dominates the GPU time on SwiftShader, so the first thing to look at on a real GPU is the ink pass and the composite, not the compute.

## Memory

The ink target is `rgba16float`, plate × DPR squared at 8 bytes a pixel: 5.1 MB at DPR 1 (800 px), 20.5 MB at DPR 2 (the page's cap, as v21) and 46 MB at DPR 3 (not reachable now; the risk of the roadmap row). The atlases are 14 to 17 MB of textures; the buffers of a single galaxy are 4 to 6 MB. A merger adds 31 MB (horizon 2) to 58 MB (horizon 30). The CPU engine keeps the surface under the ink as `Float32Array` (7.7 MB at DPR 1, 31 MB at DPR 2, two surfaces).

## Deferred

- **Ribbon LOD for the deep field** (M7, PR #8) and **lens query cost** (M9, PR #10): not merged when M10 was finished, so there is nothing to profile. `tools/perf/scenarios.mjs` lists `Deep field` and `Lens: cluster` (`npm run perf -- --later`) and the budget rows are waiting for them. Add the LOD where that profile says the vertex load is.
- **Real hardware**: integrated, discrete and one mobile GPU for the budget table; the L1 report on a real adapter; the golden recalibration (Q14).
- **A faster CPU ink rasteriser**: the budget of 100 ms is missed by up to 28% on this machine. The rasteriser's inner loop (`rasteriseSprites`, `sampleBilinear`) is 35% of a frame; a rewrite with the same f32 results is possible but changes nothing about parity and was not started.
- **Page-level merger and lens use of the pool**: the model tier of a merger creates 114 buffers; its galaxies draw from their own pools (one per `GpuStipple`), not a shared one.

## Owner actions (docs/open-questions.md Q14)

On the MacBook (a real GPU), from a clean checkout of this branch or main after it merges:

```
ROSSE_WEBGPU_ADAPTER=hardware npm run perf -- --gpu     # writes perf/gpu-hardware.json
ROSSE_WEBGPU_ADAPTER=hardware npm run l1                # adds the adapter to l1-report.json and .md
npm run perf:report                                     # rewrites perf-report.md
```

Chromium may need extra flags on a given machine (`ROSSE_CHROMIUM_ARGS="--enable-features=Vulkan --use-angle=metal"` is the shape); check that the first line says an adapter other than SwiftShader. Commit the changed files. Then the golden recalibration of Q14. If a budget row fails on the real GPU, the report says which pass to look at.

## Decisions for the owner

- ADR 0070 (pooling, shared uploads, kept batches) and ADR 0071 (the CPU engine in a worker) are Proposed.
- The CPU fallback's 100 ms budget is exceeded on this machine: accept it, relax it (Q10), or ask for the rasteriser work above.
- Whether the page should call the pool's `trim()` on memory pressure on mobile.
