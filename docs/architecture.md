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
| [0006](adr/0006-drawing-storage-on-the-gpu.md) | Bitmaps as r8 texture arrays, one layer per drawing with its own mips. Vectors as one segment buffer expanded on the GPU, with constant pen weight and per-vertex warps (analytic capsule coverage; pen lines such as the dust hatching are v21's overlap quads unioned per sample, [0019](adr/0019-pen-lines-as-sampled-quads.md), proposed). No SDF. |
| [0007](adr/0007-render-pipeline.md) | An ordered layer list mirroring v21's `scene()`. Ink goes into an rgba16float target without MSAA, then a composite onto Paper or Chalkboard (palette swap plus surface swap). Plates are multi-pass. |
| [0008](adr/0008-lens-solver-on-the-gpu.md) | The lens is grid, bins (count, scan, scatter, sorted ids), queries (canonical image lists) and emission. The solver is cached per lens; only queries re-run on orbit. The home orientation becomes explicit state. |
| [0009](adr/0009-merger-integration-on-the-gpu.md) | The merger's core track is computed on the CPU in f64. Test stars use KDK leapfrog (dt 0.012) on the GPU in f32, with f16 timeline snapshots. The tidal warp grid is computed on the GPU. |
| [0010](adr/0010-data-flow-and-cache-tiers.md) | Model, view and present tiers. Orbiting re-runs view and present only. |
| [0011](adr/0011-cpu-fallback-that-matches.md) | Without WebGPU, a CPU engine (TS kernels, the same RNG, f32, a software rasteriser) that matches at L1. |
| [0012](adr/0012-tooling-and-ci.md) | CI runs lint, typecheck, tests, WGSL validation and build on every push. Goldens run on SwiftShader WebGPU on hosted runners; a real-GPU job runs on demand. |
| [0013](adr/0013-golden-image-metric.md) | Goldens are compared on total ink, SSIM of blurred density maps, stroke-width distribution and mark counts. Thresholds are calibrated from "same galaxy, other dots" pairs (v21's re-roll and the new engine's placement streams). The engine against its own goldens on SwiftShader is bit-exact. |
| [0014](adr/0014-one-kernel-two-backends.md) | _Proposed:_ hand-written WGSL plus TypeScript twins with parity tests, with TypeGPU re-evaluated in M1. |
| [0015](adr/0015-golden-metric-as-calibrated-in-m2.md) | The golden metric as calibrated in M2: coarse density SSIM plus a moment and extent test as the structure gate, band-mean widths, Poisson-aware counts, comparisons drawn with v21's replayed variation, and negative controls. Supersedes 0013 in part. Superseded in part by 0018. |
| [0016](adr/0016-m2-acceptance-overrides.md) | _Proposed:_ the extra overrides of the M2 stipple-only acceptance captures (`starMix`, `field`, `fgstars`; `jet` for `Radio jet`; `vary`, `dustScribble` for the arms case). |
| [0017](adr/0017-model-tier-key-is-a-structure-signature.md) | The model tier's inclination key is a structure signature: every discrete inclination switch in v21 (the `incE` thresholds and L1000's cos i test); every other use of the inclination is a view-tier input. Clarifies 0010. |
| [0018](adr/0018-comparison-draws-and-the-mean-of-k-redraws.md) | _Proposed:_ what the golden comparison draws with from M4 (v21's stroke picks, noise corners, dust choices and ring-knot clusters; the placement key re-draws the engine's own), the zoom camera's own thresholds, and v21 compared with the mean of each measure over K = 6 engine draws, with thresholds calibrated for that statistic. Supersedes 0015 in part. |
| [0019](adr/0019-pen-lines-as-sampled-quads.md) | _Proposed:_ pen lines (the dust hatching) are v21's overlap quads (0.9 w past each end), sampled at v21's four MSAA positions and unioned per sample, then resolved over the ink; capsule coverage stays for other vector drawings. Amends 0006 for pen lines. |
| [0020](adr/0020-m4-acceptance-overrides.md) | _Proposed:_ the overrides of the M4 acceptance captures (`starMix`, `field`, `fgstars`, `bubbles`, `whole`, `envelope`; `barStyle` and `ringStyle` for `Barred spiral`), and the line-work-only `lines` captures with their held-out seeds. |
| [0021](adr/0021-goldens-drawn-with-v21s-part-picks.md) | _Proposed:_ the goldens draw the parts with v21's part picks, replayed from `mulberry32(seed · 57 + 3)` and checked against v21's own `parts()`; the engine's own picks are tested by their distributions. Extends 0015 item 5. |
| [0022](adr/0022-m5-acceptance-overrides.md) | _Proposed:_ the overrides of the M5 acceptance captures (`starMix`, `field`, `fgstars`; the drawn shells for `Shell galaxy`). |
| [0023](adr/0023-m6-acceptance-overrides.md) | _Proposed:_ the overrides of the M6 acceptance captures (`starMix`, `field`, `fgstars`, as before; the Chalkboard captures; the `knob-*` probes). |
| [0024](adr/0024-plates-are-present-tier-passes.md) | Plates (`slip`, `colour`) are present-tier passes over layers that carry their population; switching them builds uniforms only. |
| [0025](adr/0025-the-slipped-plates-are-their-own-golden-family.md) | _Proposed:_ the slipped plates are their own golden family (`slip`), calibrated alone. |
| [0026](adr/0026-per-preset-bands-widen-only.md) | _Proposed:_ per-preset bands for the radii, the position angle and the axis ratio: the larger of the current band and 1.5 × the preset's largest re-draw spread (the owner's decision of 2026-10-07). |
| [0030](adr/0030-overlays-take-an-explicit-home-orientation.md) | Overlays (a foreground star, an artefact) take an explicit home orientation, the camera they are placed at, in place of v21's `homeFor`: the open question Q3, option (b). |
| [0031](adr/0031-m7-golden-cases-and-retired-overrides.md) | M7's golden cases (stars, artefacts, layered scenes, the deep field, no overrides), and the retirement of the `starMix`, `field` and `fgstars` overrides of M2 to M5, whose captures are made again. |
| [0032](adr/0032-the-sky-is-a-catalogue-built-on-the-gpu.md) | The sky is a model-tier catalogue (deep-field galaxies, foreground stars, companions), culled, drawn and bounded per view by GPU passes. |
| [0033](adr/0033-stars-and-sky-follow-v21s-draws.md) | The loops, quirks and limits of `starSprites` and `buildSky` that are reproduced (`// v21 parity`). |
| [0034](adr/0034-m7-checks-after-the-merge-with-m5.md) | _Proposed:_ four changes to checks and cases when M7 met M5's line-work set (the `lines` cases keep their overrides; the orbit check and the stars' raster check; the GPU page time limit). |
| [0035](adr/0035-m7-calibration-with-the-stars-on-and-the-dots-count-spread.md) | _Proposed:_ the dots' count tolerance from the engine's own re-draw spread; M7's families and `spiral` and `smooth` calibrated with the stars on (`Edge-on with dust` keeps M5's thresholds); the engine's own goldens made again. |
| [0036](adr/0036-v21-drawn-again-and-compared-as-its-mean.md) | _Proposed:_ v21 drawn again (its stipple stream moved) for three cases, which are compared with the mean of its 8 draws; no band changes. |
| [0040](adr/0040-merger-stars-snapshots-and-the-framing-read-back.md) | _Proposed:_ the merger's test stars on the GPU in chunks, the f16 snapshots under a 64 MiB budget, and the model tier's one 12 kB read-back for `frameOf` |
| [0041](adr/0041-a-merging-galaxy-is-carried-after-its-own-kernels.md) | _Proposed:_ a merging galaxy is built as a single galaxy and carried by its tides (the 4-nearest-star warp grid) after its own kernels |
| [0042](adr/0042-the-debris-of-a-merger-as-marks.md) | _Proposed:_ the debris of a merger as marks: classified on the counter RNG, thinned as v21 thins it, and what v21 builds and never draws is not built |
| [0043](adr/0043-shells-on-the-gpu-detected-by-atomics-and-bisection.md) | _Proposed:_ shell galaxies: the satellite on the GPU, the shells found by integer atomics and a bisection, the arcs through a face-on camera |
| [0044](adr/0044-m8-acceptance-overrides-and-the-merger-and-shell-thresholds.md) | _Proposed:_ the M8 goldens' overrides, and the thresholds of the merger and shell families |
| [0050](adr/0050-the-lens-marks-slots-and-explicit-home.md) | _Proposed:_ the lens's marks, slots and explicit home: 8 slots per mark, mark classes, the fixed-point κ, the saved source orientation (open question Q3, option b) that the orbit never re-rolls. |
| [0051](adr/0051-goldens-drawn-with-v21s-lens-picks.md) | _Proposed:_ the goldens draw the lens with v21's lens picks, replayed from v21's own streams and checked against v21's solver; the engine's own picks are tested by their distributions. Extends 0015 item 5 and 0021. |
| [0052](adr/0052-m9-acceptance-overrides.md) | _Proposed:_ the overrides of the M9 acceptance captures (the deep field, drawn stars and foreground stars; and `Layered: lensed merger`, lens on, since M8). |
| [0053](adr/0053-lens-family-calibration-and-count-gate.md) | _Proposed:_ the `lens` family's calibration (28 configurations, `--only-family lens`), and its count gate at `poisson` 4.5 (lensed knots are over-dispersed: 1.27 against 0.82). |
| [0054](adr/0054-lens-inner-axis-ratio-band.md) | the `lens` family's inner axis-ratio band becomes 0.044 (1.1 × the largest of 84 v21 captures, 0.0395), after two of the 28 acceptance cases missed 0.033 by 0.0002 and 0.0065. |
| [0060](adr/0060-the-real-galaxies-are-their-own-golden-family.md) | _Accepted (owner, 2026-10-07):_ the real galaxies are their own golden family (`real`), calibrated on engine re-draws of the 20 captures and one held-out seed |
| [0061](adr/0061-real-galaxies-with-the-sky-on-and-two-more-cases-against-v21s-mean.md) | _Proposed:_ the real galaxies drawn with the sky on (captures without the overrides): the `real` family's dots tolerance calibrated again (ADR 0035's procedure, factor 2; no other threshold), and `Real galaxy 6` and `barred-spiral--knob-ring-lines` (s7 home) compared with the mean of v21's 8 draws (ADR 0036). |
| [0070](adr/0070-pooled-scratch-shared-uploads-and-kept-batches.md) | _Proposed:_ pooled scratch buffers (cleared on reuse), content-addressed shared uploads and kept ink batches, so a model rebuild and an orbit frame create almost no resources. Output unchanged. |
| [0071](adr/0071-the-cpu-engine-runs-in-a-worker.md) | _Proposed:_ the CPU engine runs in a worker behind messages (`fallback/core.ts`, `worker.ts`, `client.ts`), so a CPU frame never blocks the page. |
| [0072](adr/0072-the-lensed-source-follows-the-lens-frame.md) | _Proposed:_ the lensed source follows the lens frame under orbit (a deliberate divergence from v21's `srcNow`), so an Einstein ring stays a ring. |
| [0074](adr/0074-the-star-is-dimmed-by-the-dust-in-front-of-it.md) | _Proposed:_ an overlay star behind a dusty galaxy is dimmed by the galaxy's own dust extinction `exp(-tau)`, all its marks thinned by the same share (a deliberate divergence: v21 never dims it). |
| [0075](adr/0075-disc-galaxies-carry-a-natural-dust-layer.md) | _Proposed:_ on the page, disc galaxies carry a natural dust layer (`dustAuto`, `effectiveDust = max(dust, naturalDust)` by type and bulge, none for ellipticals) in v21's own smooth slab; off in the core (a deliberate divergence from v21, where `dust` is 0 unless set). |
| [0076](adr/0076-bulges-follow-a-sersic-law.md) | _Proposed:_ on the page, a bulge's stars follow a deprojected Sérsic law whose index follows the galaxy (`bulgeAuto`, n 1 for a pseudo-bulge to 4 for a big round one) instead of v21's one Hernquist sphere (boxy-peanut when barred); same size, off in the core. |

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
4. **Round pen ends.** Vector drawings other than pen lines are drawn as capsules, with round caps and joins; v21's quads extend 0.9 of the width past each end and rely on MSAA. The spike measured capsules as closer to a real pen stroke (ADR 0006). Pen lines (the dust hatching) are not a divergence: M4 draws them as v21's own quads, 0.9 w past each end, unioned at v21's four MSAA sample positions, because capsules composited per pixel inked 18–41% more than v21 at the joins (ADR 0019, proposed).
5. **Integer-lattice value noise** replaces the `sin`-hash noise, so flocculence, patchiness and dust gaps are the same on every machine. The patterns differ from v21's, but their statistics do not.
6. **The star is dimmed by the dust in front of it.** v21 never dims the overlay star; here, behind a dusty galaxy, all its marks thin by the same `exp(-tau)` of the galaxy's own dust model (ADR 0074).
7. **Disc galaxies carry a natural dust layer.** v21's `dust` is 0 unless a preset sets it; with `dustAuto` (on in the page, off in the core) every reader of the dust takes `max(dust, naturalDust)`: a spiral about 0.35 face-on optical depth, an elliptical none (ADR 0075).
8. **Bulges follow a Sérsic law.** v21 draws every bulge as one flattened Hernquist sphere; with `bulgeAuto` (on in the page, off in the core) the stipple draws the radius from a deprojected Sérsic law, index by type and flatness, at the same half-mass radius (ADR 0076).

## Performance budget

These are targets on a mid-range laptop GPU, measured in M10.

|  | budget |
| --- | --- |
| orbit frame (view + present), default presets | < 4 ms GPU, 60 fps |
| orbit frame, cluster lens or deep field 1.0 | < 8 ms GPU |
| parameter change (model tier), single galaxy | < 30 ms to first frame |
| merger parameter change | < 100 ms to first frame at the default horizon |
| CPU fallback orbit frame | < 100 ms on one core |

M10 built the harness that measures these (`npm run perf`, `npm run l1`) and checked in what SwiftShader and the CPU engine show, each labelled with its adapter: [docs/milestones/m10](milestones/m10/README.md). The rows on a real GPU are not measured yet (open question Q14).

v21 today, on SwiftShader: 50 ms (deep field) to 1.6 s (cluster lens) per render, with every orbit frame a full render (reference notes, sizes and costs).

## Testing

- **Unit tests** (vitest, Node) cover the RNG vectors, schema and tiers, scene description, camera maths, the WGSL resolver, struct layouts, and, from M1, CPU-twin kernels against the WGSL kernels.
- **Goldens** (ADR 0013): `tests/golden/reference/` holds 186 captures of v21 (45 presets × 2 seeds × 2 cameras, plus Chalkboard for 3). From M2, `npm run golden` renders the same cases with the new engine (WebGPU on SwiftShader, and the CPU engine) and compares them.
- **WGSL validation:** naga in CI and Tint in the golden job.
