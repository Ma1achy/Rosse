# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will use [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from its first release.

## [Unreleased]

### Added

- M11, the page and UI (docs/milestones/m11):
  - The page on the design language: Paper and Chalkboard, a tabbed panel whose controls are generated from the schema (`src/ui/layout.ts`, `controls.ts`), preset cards, Surprise me, New stars, the seed, PNG export (`snapshot()` on both engines), a link that holds the preset, edits, camera and surface (`src/ui/urlstate.ts`), the merger timeline, and the "drawn on the CPU" note.
  - Controls for the sky (M7), the merger (M8) and the lens (M9) appear when their flag in `FEATURES` is switched on; `?features=` previews them.
  - `tools/gpu-test/ui-smoke.mjs` (`npm run test:ui`, part of `npm run test:gpu`), contrast and layout unit tests; the plates page check drives the Ink tab.

- M8, mergers:
  - `sim/merger`: the core track in f64 (v21's `coreTrack` bit for bit, `tests/vectors/merger.json`), the timeline plan, the snapshots as f16 positions relative to the nearer core with a 64 MiB budget, `mTime` and the horizon (ADR 0040); the test stars on the GPU (`compute/merger.wgsl`, KDK at dt 0.012, in chunks) with a CPU twin and the model tier's one 12 kB read-back for `frameOf`.
  - A merging galaxy built as a single galaxy and carried by the tidal map (`compute/tide.wgsl`, `tide-apply.wgsl`, twin `fallback/kernels/tide.ts`): the 4-nearest-star warp grid, `post` warps on the vector kernels, tearing at v21's 22 px and 1.8× (ADR 0041); `mWarp`'s whole drawings torn through the tidal map itself.
  - The debris as marks (`compute/merger-sprites.wgsl`, twin `fallback/kernels/merger-sprites.ts`): classified on the counter RNG and thinned as v21 thins it; what v21 builds and never draws is not built (ADR 0042).
  - Shell galaxies: the satellite on the GPU, its shells detected by integer atomics and a bisection, the arcs as ribbons through a face-on camera (ADR 0043).
  - `ROSSE_WEBGPU_ADAPTER` (`default`, `discrete`, `integrated`, `swiftshader`) for the GPU tests, so the test stars' drift can be measured on a real GPU.
  - Goldens: v21 captures of the eight `Merger: …` presets, `Sketches, torn apart` and the lensed merger (lens off) at seeds 7 and 4242, home, orbit and zoom, the Mice at two other moments of the timeline, `Shell galaxy` with its simulated shells and 12 held-out captures of it (ADR 0044, proposed). The merger and shell families are calibrated (K = 6); the comparison draws with v21's galaxy-level draws, `mWarp`'s drawings and the shells v21 found.
- M6, the single-galaxy preset set at parity:
  - Plates (ADR 0024): `slip` (cyan, magenta and yellow at v21's offsets and gains, then the key ink; four passes) and `colour` (one pass, each population in its own ink: old, disc, young, HII), with the Chalkboard's lighter inks. They are present-tier passes over layers that carry their population (`render/plates.ts`, `render/pass-style.ts`): switching plates or surface builds a few uniform buffers and runs no compute pass. The sprite and ribbon shaders take a plate offset; both engines run the same passes; the page has a Plates menu.
  - A diff of the engine against v21 for all 18 single-galaxy presets found nothing else missing: halo and envelope rules, Sérsic profiles, patchy and irregular discs, outlines, tails, bubbles and the rest were already drawn, and the 18 presets pass at parity on the metric as it stands, bar the cases listed in docs/milestones/m6 (three M5 `Edge-on with dust` cases awaiting the owner, and one probe by a hair).
  - Goldens: 66 v21 captures of the M6 set (variant `single`, ADR 0023, proposed; 10 presets at 2 seeds and 3 cameras, and `Grand design`, `Plates slipped` and `Stellar populations` on the Chalkboard; `capture:reference` takes `"chalk": true`), the eight M5 `vectors` presets for the rest, and 32 `knob-*` probes of parameters no preset uses (`patchy`, `irr`, `tail`, `sersicN`, `ringOnlyLines`, `dust`, `halo`, `nuclear` and `whole`). The slipped plates are their own golden family (`slip`, ADR 0025, proposed), calibrated alone with `npm run golden -- --calibrate --only-family slip`, which merges into the thresholds.
  - The plates test: `tools/capture-reference/plates.mjs` records v21's draw calls and canvas for the slipped and colour plates on both surfaces; `tests/unit/plates.test.ts` replays the rows through the engine's passes and compares offsets, gains, population inks and the ink images, with negative controls; `tests/gpu/plates.ts` checks CPU = GPU and that switching plates builds uniforms only.
  - `side-by-side.mjs --set m6` draws the plates and the Chalkboard.

- M5, vector marks:
  - `marks/vector`: the whole vector library (12 sheets, 429 drawings, 23,431 segments, 6,038 dots, 328 blobs) packed once into shared tables with a per-drawing range table and a densified-piece prefix (packer 4 copies every sheet with its metadata).
  - `model/parts`: v21's `parts()` as scene description. The model tier picks envelopes, whole drawings by type (with the rewind warp), drawn arms by tightness, bars, rings, the nuclear spiral, arcs, shells, the tail, trails and cosmic rays, the arrow, bubbles at the clumps, the jet and the streams, each part on its own index of the `parts` stream. The view tier lays out v21's rows for a camera (`vectorRows`), in the `MAGNIFIED` order. `model/vectors` packs them for the GPU.
  - `compute/vector-expand.wgsl` with its CPU twin `fallback/kernels/vector.ts`: capsules at `PEN.line/2 · ps` plate px through the warp (rewind; a generic `post` hook for M8 and M9), densified to ≤ 0.012 tile units under a warp, with v21's 22 px and 1.8× drops; dots and blobs as `dots` and `knots` sprites from the hand by v21's hashes; the streams' dots and knots on the `partMarks` stream; deterministic compactions with indirect draws (`drawIndirect` for capsules). GPU = CPU within 2 × 10⁻⁴ px on 27 scenes, raster within 1/255.
  - Both engines draw every layer in `scene()` order (`GpuStipple.inkLayers`, `CpuStipple.view`); the core gains the nuclear spiral; the used-drawings count (`model/used`, CPU engine).
  - Goldens: 48 v21 captures of the M5 set (variant `vectors`, ADR 0022, proposed; `capture:reference --variant`); the runner draws with v21's part picks, replayed from v21's stream (`compare/v21-parts.ts`, ADR 0021, proposed). Unit tests check the replay's rows against v21's own `parts()` evaluated from app23.js, and the engine's own picks against v21's over 2,000 seeds; a pen-weight test at zoom 0.5, 1 and 3; `npm run test:gpu`: the vector kernels and raster against their twins, and ink per length against v21's own MSAA quads at every pen scale (within 1%, gated at ±5%: the hatching and the placed drawings are one pen-line union, ADR 0019). 45 of the 48 M5 goldens pass under the K-mean comparison (ADR 0018); the three `Edge-on with dust` failures are one moment measure each, just past a calibrated band (docs/milestones/m5). Thresholds recalibrated with the M5 set; engine hashes rewritten.
  - The page draws the parts (`?variant=vectors` gives the golden overrides).

- M4, stroke ribbons and arms:
  - The line-work as scene description (`model/curves`, `model/lanes`, `model/clumps`, `model/ribbons`): v21's `curves()` (arms with taper, flocculent segmentation on lattice noise, spurs, ribbon ring and bar, the edge-on midplane stroke with its alpha from the raw inclination, outline arcs, tails) with `strokeIndex` pools per kind; `dustLanes()` (arm inner edges, the ring lane, the edge-on midplane) as 3D lane points and hatches with their own random numbers; the carving lines (`dustLines`, from `longestLine`/`lineParam` of the pen lines); ring knots and clumps as groups. Each curve, lane step and group has its own index on a named stream.
  - `compute/ribbons.wgsl` with its CPU twin `fallback/kernels/ribbons.ts`: projection of every scene point, a sequential per-curve arc-length prefix sum with v21's `cw`, `kpx` and `reps`, textured segments (normals from neighbours, taper 1.1 − 0.45 f), re-spaced pieces at their own arc positions (binary search on slots and on arc length) drawn as `pieces` sprites with an indirect count, and the hatching as pen-line capsules, dots and blobs. GPU = CPU bit for bit on 27 scenes (9 scenes × 3 cameras).
  - `render/ribbon.wgsl` and the rasteriser twins: textured ribbon triangles with v21's ink edge and per-triangle mip level, and pen lines (the dust hatching) as v21's overlap quads sampled at its four MSAA positions and unioned per sample (ADR 0019, proposed; capsule coverage stays for other vector drawings, ADR 0006); premultiplied, no MSAA. Within 1/255 of the CPU raster. The pen-line coverage texture is shared across layer rebuilds.
  - The stipple: ring knots' and clumps' marks after the proposals (`extra` entry point); the lane cull (`inLane`) and the carving cull (`nearDust`) as pure filters on per-sample uniforms in `project.wgsl`; the hand wobble (`distort`) on every mark, vertex and piece (`view/warp`, `common/warp.wgsl`).
  - `assets-built/vector/penlines.json` (packer 3); `capture:reference --only` takes `|` between names.
  - Goldens: 42 v21 captures of the M4 set (variant `ribbons`) and 28 line-work-only captures (variant `lines`, ADR 0020); the runner draws with v21's stroke choices, dust choices and ring-knot clusters (`compare/v21-curves.ts`) and noise corners (`compare/v21-noise.ts`, through a noise-table option of both engines), and the zoom camera has its own calibrated thresholds (`<family>@zoom`). Each parity measure is the mean over K = 6 engine draws against v21's one, and the calibration measures that statistic (ADR 0018, proposed; the negative controls it catches less often are listed there; `--calibrate` takes `--keys`, `--controls-every`, `--resume` and `--reuse-shards`). 104 of 104 required cases pass. `npm run test:gpu`: the line-work kernels and raster against their twins. `tools/m4-summary.mjs` writes the numbers the docs cite to `docs/data/`.
  - The page draws arms, lanes and pieces (`?variant=ribbons` gives the golden overrides).

- M3, camera and orbit:
  - `view/camera`: one rotation for every stage. It covers `project`, `rotFwd`/`rotInv`, `toView`/`toScreen`, the deep-field perspective (CAM = 30), `discM`, `basis`, `orient`, and `scenePoint`/`srcNow` with an explicit home. Zoom (`VIEW.scale` = 84 · zoom, 0.15–12); `incE`, every use of it in v21 (`INCE_USES`, 12 lines) and its 7 buckets (exactly 80° is its own). `common/camera.wgsl` is the same rotation in WGSL. `tests/vectors/camera.json` (`npm run vectors:camera`) holds v21's own camera functions evaluated, and all 5,384 numbers match bit for bit.
  - The view tier (ADR 0010): `render/tiers.ts` runs the model tier only when the schema's tier tags or an `incE` bucket crossing say so, and the view tier on camera, `mTime` or zoom changes. Both engines use it (`GpuStipple.frame`, `CpuStippleTiers`). Tests hash the stipple samples before and after camera moves, on the GPU and the CPU.
  - `ui/orbit.ts`: v21's orbit controls. They cover drag orbit and tilt, shift- or right-drag roll, pinch and twist, wheel and ctrl-wheel zoom, Safari gestures, double-click, and the arrow, Q/E, +/− and 0 keys. They are tested event for event against v21's own handler code. Camera moves are coalesced to at most one queued frame. The page also takes `?zoom=`, `?az=`, `?incl=` and `?pa=`.
  - Zoom goldens (open question Q8): `capture:reference --extra` has a `zoom` camera (home at `__GEN.zoom(2)`) and `--cameras`. Cases opt in per seed with `"zoom": [7, 4242]`. There are 6 new v21 captures of the M2 stipple-only set, and the golden runner renders each case at its capture's zoom. All 34 required cases pass, including the 6 zoom cases under ADR 0015's moment gate.
  - Review fixes:
    - The model tier's inclination key is a structure signature (ADR 0017), covering L1000's raw cos i switch that `incE` buckets missed. A scan test classifies every use of the inclination in v21.
    - `schedule()` coalesces every frame request.
    - The URL camera parsing is strict.
    - Per-camera run records and per-capture times in the golden manifest.
    - `GpuStipple` keys its model on the drawings' metadata.
    - The GPU hash test covers every model buffer.
    - The plate has an accessible name.
  - `npm run test:gpu`: the tier hash test with indicative orbit timings, and a Playwright check that drags, rolls and zooms the page and compares the camera with v21's formulas.

- M2, the stipple from the model and the comparison harness:
  - `core/params`, `core/schema`, `core/presets`: the typed `DEF` (109 keys, v21's defaults), every key's range (from v21's controls) and cache tier (ADR 0010, with `incE` buckets dirtying the model), and the 45 presets verbatim, checked against `app23.js`.
  - `model/variation`: `makeVariation` on the counter RNG, one index per group of fields (changing the arms no longer changes the hand); the hand of 1–3 readable pens and the knot pool; `dotSprite`.
  - `model/galaxy`, `model/scene`, `model/parts` (the drawn core only): the scene description shared by both engines.
  - `compute/stipple.wgsl`, `project.wgsl`, `scan.wgsl` with CPU twins in `fallback/kernels/`: bulge, halo, bar, ring, disc (with arms, spurs, flocculence, patchiness, irregularity, warp, lopsidedness, dust patches) and Sérsic components with bounded rejection; dot, knot, sparkle-star and drawn-star classification by population; dust optical depth as a pure view cull; deterministic per-class compaction into instance buffers drawn with `drawIndirect`. `sin`, `cos` and the stipple's Gaussian are built from `+ − ×` (`core/f32math`, `common/math.wgsl`) so the GPU and the CPU agree.
  - The page draws the chosen preset and seed (`?preset=`, `?seed=`, `?variant=stipple`).
  - `npm run golden`: the metric of ADR 0013 (`tests/golden/compare/`: density maps, SSIM, stroke widths from the distance transform, counts, HTML reports), WebGPU on SwiftShader and the CPU engine against v21, and the CPU engine against WebGPU; `--calibrate` writes `tests/golden/thresholds.json` and `calibration.json`.
  - `tools/capture-reference`: `--extra` (preset plus overrides, added to the manifest; the capture records v21's hand) and `--reroll` (v21's 0.3° re-roll pairs); 12 stipple-only captures of `Smooth, round`, `Cigar-shaped` and `Disc, no arms`.
  - `npm run test:gpu`: the stipple kernels on the GPU against their CPU twins (L1).
  - After review (ADR 0015, superseding ADR 0013 in part): a moment and extent test (radii, outer ink, axis ratios, position angle) and the coarse SSIM as the structure gate; negative controls in the calibration; Poisson-aware counts that require 0 where v21 has 0; comparisons drawn with v21's variation replayed offline (`tests/golden/compare/v21.ts`), checked against v21's own `armProfile` and recorded hands; 16 more stipple-only captures (`Radio jet`, `Grand design` with arms, two-pen and three-pen seeds) and a drawn-star count gate; the page presents before reading counts back.

- M1, paper and one mark:
  - `gpu/device`: adapter and device request with the adapter's texture-array and buffer limits, device-loss recovery, and `detectBackend()` choosing WebGPU or the CPU engine.
  - `core/rng` and `shaders/common/rng.wgsl`: the counter-based RNG of ADR 0004 (pcg4d keyed by seed, stream, index and draw), named streams in `core/streams`, and shared vectors in `tests/vectors/rng.json`.
  - Struct-layout tests: the TS descriptions of `Instance` and the sprite and composite uniforms checked against the WGSL with `wgsl_reflect`.
  - `tools/pack-atlas` (`npm run prepare-assets`): bitmap sheets to r8 layers with per-layer, coverage-preserving mips in `assets-built/`; `marks/atlas` uploads them as texture arrays, split where a sheet exceeds `maxTextureArrayLayers`.
  - The sprite pipeline (instanced quads, the reference's smoothstep ink edge, premultiplied, no MSAA) into an rgba16float ink target, and the composite onto Paper (multiply) and Chalkboard (soft-light) with the plate's inset rim and vignette, reproducing v21's CSS.
  - `fallback/raster` and `CpuRenderer`: the software rasteriser and composite, f32 twins of the GPU passes, runnable in Node.
  - The page: the plate with one dot and a few more marks, a Paper/Chalkboard switch, the CPU engine where WebGPU is missing or fails (`?backend=cpu` forces it), and redrawing on resize and DPR change (DPR capped at 2, as v21).
  - `npm run test:gpu`: Playwright and Chromium with WebGPU on SwiftShader, run in CI. RNG vectors bit-exact on the GPU; the one-mark render test (CPU raster against GPU raster, within 1/255); an L-shaped cell checking orientation on both engines; the composite against screenshots of v21's own empty plate (within 2/255).
  - `npm run screenshots`, and screenshots in `docs/milestones/m1/`.
  - The TypeGPU evaluation of ADR 0014 (`docs/notes/typegpu-evaluation.md`): it recommends staying with hand-written WGSL and TypeScript twins.

- M0 planning: reference notes for Rosse v21, the architecture and ADRs 0001–0014, the roadmap and open questions.
- Repository skeleton: TypeScript, Vite, vitest, ESLint, Prettier, WGSL files with an import resolver and naga validation, and CI workflows.
- `tools/capture-reference`: 186 golden captures of v21 (45 presets × 2 seeds × 2 cameras, plus Chalkboard).
- `tools/profile-reference`: timings and sizes of v21's stages.
- `spikes/vector-lines`: GPU pen ribbons compared with distance fields.

### Changed

- `inclBucket` moved to `view/camera` and gained a bucket for exactly 80° (L1028 tests `< 80`, L788 `> 80`). `core/schema` re-exports it.
- New binaries are committed as ordinary blobs (no LFS rules) and kept small.
- ADR 0007: Paper is the field `#e6dece` with the paper texture in `multiply` (not `overlay`, which applies only to a dark theme v21 never sets), plus the plate's inset rim; Chalkboard adds a 60 px inset vignette. The DPR cap of 2 is recorded.

### Removed

- The duplicate `rosse-v21.html` at the repository root (identical to `assets/reference/pages/rosse-v21.html`).
