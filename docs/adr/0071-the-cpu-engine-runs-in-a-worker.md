# 71. The CPU engine runs in a worker

Date: 2026-10-07

## Status

Proposed. It carries out what ADR 0011 already names ("the CPU engine … in a worker") and changes none of its decisions.

## Context

ADR 0011 puts the CPU engine in a worker, but until M10 the page ran it on the main thread: `CpuStippleTiers`, the rasteriser and the composite ran inside the animation-frame callback's promise chain. A frame takes 150 ms or more on a shared machine, so the page stopped responding to input and to its own repaints for that long, every orbit frame (tools/perf/worker.mjs measures it).

## Decision

- `fallback/core.ts` (`CpuEngineCore`) is the whole CPU engine with no DOM: draw (the tiers), resize, present (ink if the plates or palette changed, then the composite). The tests and the profiling harness run it directly.
- `fallback/worker.ts` runs one core behind messages (`fallback/protocol.ts`): init (the worker loads the packed assets itself, so nothing large crosses the thread boundary), draw, resize, present. Requests are handled in order. A frame's pixels come back as a transferred `ArrayBuffer`; the page puts them on the canvas.
- `fallback/client.ts` has two backends behind one interface: `WorkerCpu`, and `LocalCpu` (the same core on the page's thread), used where a `Worker` cannot be made, if starting one fails, or with `?cpuworker=off` (the profiling comparison).
- The page's frame queue is unchanged: at most one frame waits, drawn with the latest camera; while the worker is busy the page stays responsive and the pending frame coalesces further moves.

## Consequences

- The main thread is free while a CPU frame is drawn: tools/perf/worker.mjs reports the longest gap between animation frames and the long tasks with the worker and without it, and docs/milestones/m10 records the numbers.
- The CPU engine's cost per frame is unchanged by this; what changes is who waits for it.
- Output is the same bytes: `CpuEngineCore` is tested against the kernels and rasteriser called directly.
- The worker bundles the kernels a second time (84 kB), loaded only when the CPU engine is used.
