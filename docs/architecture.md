# Architecture

Rosse draws a galaxy by building it in 3D and inking it with real hand drawings: dots, knots, strokes, stars and whole galaxies, drawn with a fineliner and scanned. This document describes the WebGPU engine that replaces the single-page v21. It is the overview; each decision, with the alternatives considered, is an ADR in [`adr/`](adr/). How v21 works, stage by stage, is in [`reference-notes.md`](reference-notes.md).

## In one paragraph

The CPU turns parameters into a **scene description**: a few kilobytes of numbers, such as the galaxy's variation, curve control points, which drawings go where, lens halos, the sky catalogue and a merger's two-core track. **Everything per mark runs on the GPU in WGSL compute passes**: sampling the stipple, projecting it, culling it, expanding strokes and vector drawings into pen ribbons, integrating merger stars, solving the lens, and emitting every lensed mark. Two render pipelines then ink the result: instanced quads for bitmap drawings, and analytic capsule ribbons for pen lines. They draw into an offscreen ink layer, which is composited onto Paper or Chalkboard. Work is cached in three tiers (model, view, present), so orbiting the camera only re-runs the view passes. Random numbers come from a counter-based hash, so every sample owns its randomness, nothing depends on thread scheduling, and orbiting never re-rolls the stipple. Where WebGPU is missing, a **CPU engine** runs TypeScript twins of the same kernels with the same random numbers and f32 arithmetic, and rasterises with the same ink maths, so it matches. Parity with v21 is **statistical** (same structure, same ink, same pen weight, same counts; not the same dots) and is tested by golden images captured from the v21 page, compared on ink distribution, pen weight and mark counts.

## Decisions

| ADR | decision |
| --- | --- |
| [0001](adr/0001-record-architecture-decisions.md) | Decisions are recorded as ADRs (Nygard). |
| [0002](adr/0002-stack-and-build.md) | TypeScript (strict), Vite, vitest, ESLint and Prettier. WGSL lives in its own files, with a tiny `// #import` resolver shared by the build and naga validation. |
| [0003](adr/0003-everything-per-mark-on-the-gpu.md) | Everything per sample, mark, vertex or pixel runs on the GPU. The CPU only builds the scene description, which is shared with the fallback. |
| [0004](adr/0004-determinism.md) | A counter-based RNG (`pcg4d`) keyed by seed, stream, index and draw; deterministic scans, with no order-dependent atomics; "same" defined at L0 (bit-exact on one adapter), L1 (structure across machines and the CPU) and L2 (statistical, against v21). |
| [0005](adr/0005-statistical-parity-with-the-reference.md) | Parity with v21 is statistical, not sample-exact, and deliberate divergences are listed. |
| [0006](adr/0006-drawing-storage-on-the-gpu.md) | Bitmaps as r8 texture arrays, one layer per drawing with its own mips. Vectors as one segment buffer expanded to capsule ribbons on the GPU, with constant pen weight and per-vertex warps. No SDF. |
| [0007](adr/0007-render-pipeline.md) | An ordered layer list mirroring v21's `scene()`. Ink goes into an rgba16float target without MSAA, then a composite onto Paper or Chalkboard (palette swap plus surface swap). Plates are multi-pass. |
| [0008](adr/0008-lens-solver-on-the-gpu.md) | The lens is grid, bins (count, scan, scatter, sorted ids), queries (canonical image lists) and emission. The solver is cached per lens; only queries re-run on orbit. The home orientation becomes explicit state. |
| [0009](adr/0009-merger-integration-on-the-gpu.md) | The merger's core track is computed on the CPU in f64. Test stars use KDK leapfrog (dt 0.012) on the GPU in f32, with f16 timeline snapshots. The tidal warp grid is computed on the GPU. |
| [0010](adr/0010-data-flow-and-cache-tiers.md) | Model, view and present tiers. Orbiting re-runs view and present only. |
| [0011](adr/0011-cpu-fallback-that-matches.md) | Without WebGPU, a CPU engine (TS kernels, the same RNG, f32, a software rasteriser) that matches at L1. |
| [0012](adr/0012-tooling-and-ci.md) | CI runs lint, typecheck, tests, WGSL validation and build on every push. Goldens run on SwiftShader WebGPU on hosted runners; a real-GPU job runs on demand. |
| [0013](adr/0013-golden-image-metric.md) | Goldens are compared on total ink, SSIM of blurred density maps, stroke-width distribution and mark counts. Thresholds are calibrated from "same galaxy, other dots" pairs (v21's re-roll and the new engine's placement streams). The engine against its own goldens on SwiftShader is bit-exact. |
| [0014](adr/0014-one-kernel-two-backends.md) | _Proposed:_ hand-written WGSL plus TypeScript twins with parity tests, with TypeGPU re-evaluated in M1. |
| [0015](adr/0015-golden-metric-as-calibrated-in-m2.md) | The golden metric as calibrated in M2: coarse density SSIM plus a moment and extent test as the structure gate, band-mean widths, Poisson-aware counts, comparisons drawn with v21's replayed variation, and negative controls. Supersedes 0013 in part. |
| [0016](adr/0016-m2-acceptance-overrides.md) | _Proposed:_ the extra overrides of the M2 stipple-only acceptance captures (`starMix`, `field`, `fgstars`; `jet` for `Radio jet`; `vary`, `dustScribble` for the arms case). |
| [0017](adr/0017-model-tier-key-is-a-structure-signature.md) | The model tier's inclination key is a structure signature: every discrete inclination switch in v21 (the `incE` thresholds and L1000's cos i test); every other use of the inclination is a view-tier input. Clarifies 0010. |
| [0021](adr/0021-goldens-drawn-with-v21s-part-picks.md) | _Proposed:_ the goldens draw the parts with v21's part picks, replayed from `mulberry32(seed · 57 + 3)` and checked against v21's own `parts()`; the engine's own picks are tested by their distributions. Extends 0015 item 5. |
| [0022](adr/0022-m5-acceptance-overrides.md) | _Proposed:_ the overrides of the M5 acceptance captures (`starMix`, `field`, `fgstars`; the drawn shells for `Shell galaxy`). |
| [0030](adr/0030-overlays-take-an-explicit-home-orientation.md) | Overlays (a foreground star, an artefact) take an explicit home orientation, the camera they are placed at, in place of v21's `homeFor`: the open question Q3, option (b). |
| [0031](adr/0031-m7-golden-cases-and-retired-overrides.md) | M7's golden cases (stars, artefacts, layered scenes, the deep field, no overrides), and the retirement of the `starMix`, `field` and `fgstars` overrides of M2 to M5, whose captures are made again. |
| [0032](adr/0032-stars-artefacts-and-the-sky-on-the-gpu.md) | The drawn stars are a dynamic vector set fed by the stipple's compaction; the marks of a star or an artefact are slots appended to the stipple's; the sky's catalogue is the model tier and its view is culled, drawn and bounded per view. |
| [0033](adr/0033-v21-parity-in-the-stars-and-the-sky.md) | The loops, quirks and limits of `starSprites` and `buildSky` that are reproduced (`// v21 parity`). |

## Modules

```
src/core/        parameters (typed DEF), schema (ranges, tiers), presets, the CPU half of the RNG
src/model/       scene description for a galaxy: variation, component weights, arm and spur
                 coefficients, part placement; the stars and artefacts (stars.ts), the sky
                 catalogue (sky.ts), dynamic vector sets (dynvec.ts)
src/view/        the camera: one rotation for project / rotFwd / rotInv / toView, perspective
src/sim/         merger (core track, snapshots), lens (halos, solver driver), shells
src/marks/       bitmap sheets → texture arrays; vector records → segment, dot and blob buffers;
                 the strokes sheet and its pieces
src/gpu/         device, buffers, pipelines, resource lifetimes per tier
src/render/      frame orchestration, layer order, surface, palette
src/shaders/     WGSL: common/ (rng, math, camera, instance), compute/, render/
src/fallback/    the CPU engine: kernel twins and a software rasteriser
src/ui/          the page (M11); the catalogue browser, real galaxies and exports (M12)
```

`view/` and `render/` are additions to the suggested layout. Camera maths is used by every stage and both engines, so it is not GPU plumbing. Draw order and surfaces are policy, while `gpu/` is mechanism. `fallback/` holds the CPU engine of ADR 0011.

## Frame

```
parameters ──► schema: which tier is dirty?
                 │
   model dirty ──┼─► CPU: scene description (variation, curves, parts, sky, lens halos, merger core track)
                 │   GPU: stipple samples (+ stored per-sample randoms) · merger stars · lens grid + bins ·
                 │        source-galaxy marks · shells
   view dirty  ──┼─► GPU: project + culls (dust τ, lanes, breathing room) → scan → instances
                 │        curves → ribbons / pieces · vectors → capsule segments (affine + warp)
                 │        sky perspective + weak lensing · lens queries + emission · tidal grid
   present     ──┴─► GPU: ink layers in order (drawIndirect) → rgba16float ink target
                          composite: surface (Paper | Chalkboard) + palette + plates → canvas
```

Nothing produced on the GPU is read back on the frame path. Counts flow into indirect draws.

## The pieces that are hard, and how they are handled

- **Rejection sampling in parallel.** Each candidate sample runs its own bounded rejection loop (at most 30 tries, as v21) on its own counter. Accepted samples are compacted by a deterministic scan. Samples are generated in the galaxy's frame, and view-dependent culls read stored per-sample random numbers (ADR 0004, 0010).
- **Lens image search.** Grid, bins and queries, as ADR 0008, with triangle ids sorted per bin so image lists are canonical.
- **Merger stars.** The core track is computed on the CPU in f64 and test stars on the GPU in f32 (ADR 0009). Long horizons are integrated over several frames.
- **Pen weight.** Ribbons are expanded after the instance transform, at a half-width in plate pixels, so a drawing's pen is the same at any size and under any warp (ADR 0006, spike).
- **Matching on the CPU.** The same RNG bits, f32 arithmetic through `Math.fround`, the same scan order, and a rasteriser with the same coverage maths (ADR 0011, 0014).

## Deliberate divergences from v21

These are intended changes in behaviour, each confirmed or rejected by the owner (docs/open-questions.md):

1. **Orbiting keeps the marks.** In v21, orbiting with dust lanes on re-rolls the stipple (reference notes, flagged item 1). Here a camera move never changes which marks exist.
2. **The home orientation is a parameter.** v21 remembers the camera at which lensed sources and overlays were first placed (`homeFor`), which makes a render depend on navigation history. Here it is explicit and saved. Built for overlays in M7 (`SceneOptions.home`, ADR 0030); lensed sources follow in M9.
3. **No mip bleed.** Each drawing has its own mip chain, so small dots no longer pick up ink from neighbouring cells.
4. **Round pen ends.** Capsule ribbons have round caps and joins. v21's quads extend 0.9 of the width past each end and rely on MSAA. The spike measured capsules as closer to a real pen stroke (ADR 0006).
5. **Integer-lattice value noise** replaces the `sin`-hash noise, so flocculence, patchiness and dust gaps are the same on every machine. The patterns differ from v21's, but their statistics do not.

## Performance budget

These are targets on a mid-range laptop GPU, measured in M10.

|  | budget |
| --- | --- |
| orbit frame (view + present), default presets | < 4 ms GPU, 60 fps |
| orbit frame, cluster lens or deep field 1.0 | < 8 ms GPU |
| parameter change (model tier), single galaxy | < 30 ms to first frame |
| merger parameter change | < 100 ms to first frame at the default horizon |
| CPU fallback orbit frame | < 100 ms on one core |

v21 today, on SwiftShader: 50 ms (deep field) to 1.6 s (cluster lens) per render, with every orbit frame a full render (reference notes, sizes and costs).

## Testing

- **Unit tests** (vitest, Node) cover the RNG vectors, schema and tiers, scene description, camera maths, the WGSL resolver, struct layouts, and, from M1, CPU-twin kernels against the WGSL kernels.
- **Goldens** (ADR 0013): `tests/golden/reference/` holds 186 captures of v21 (45 presets × 2 seeds × 2 cameras, plus Chalkboard for 3). From M2, `npm run golden` renders the same cases with the new engine (WebGPU on SwiftShader, and the CPU engine) and compares them.
- **WGSL validation:** naga in CI and Tint in the golden job.
