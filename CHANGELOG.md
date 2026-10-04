# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will use [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from its first release.

## [Unreleased]

### Added

- M2, the stipple from the model and the comparison harness:
  - `core/params`, `core/schema`, `core/presets`: the typed `DEF` (109 keys, v21's defaults), every key's range (from v21's controls) and cache tier (ADR 0010, with `incE` buckets dirtying the model), and the 45 presets verbatim, checked against `app23.js`.
  - `model/variation`: `makeVariation` on the counter RNG, one index per group of fields (changing the arms no longer changes the hand); the hand of 1–3 readable pens and the knot pool; `dotSprite`.
  - `model/galaxy`, `model/scene`, `model/parts` (the drawn core only): the scene description shared by both engines.
  - `compute/stipple.wgsl`, `project.wgsl`, `scan.wgsl` with CPU twins in `fallback/kernels/`: bulge, halo, bar, ring, disc (with arms, spurs, flocculence, patchiness, irregularity, warp, lopsidedness, dust patches) and Sérsic components with bounded rejection; dot, knot, sparkle-star and drawn-star classification by population; dust optical depth as a pure view cull; deterministic per-class compaction into instance buffers drawn with `drawIndirect`. `sin`, `cos` and the stipple's Gaussian are built from `+ − ×` (`core/f32math`, `common/math.wgsl`) so the GPU and the CPU agree.
  - The page draws the chosen preset and seed (`?preset=`, `?seed=`, `?variant=stipple`).
  - `npm run golden`: the metric of ADR 0013 (`tests/golden/compare/`: density maps, SSIM, stroke widths from the distance transform, counts, HTML reports), WebGPU on SwiftShader and the CPU engine against v21, and the CPU engine against WebGPU; `--calibrate` writes `tests/golden/thresholds.json` and `calibration.json`.
  - `tools/capture-reference`: `--extra` (preset plus overrides, added to the manifest; the capture records v21's hand) and `--reroll` (v21's 0.3° re-roll pairs); 12 stipple-only captures of `Smooth, round`, `Cigar-shaped` and `Disc, no arms`.
  - `npm run test:gpu`: the stipple kernels on the GPU against their CPU twins (L1).

- M1, paper and one mark:
  - `gpu/device`: adapter and device request with the adapter's texture-array and buffer limits, device-loss recovery, and `detectBackend()` choosing WebGPU or the CPU engine.
  - `core/rng` and `shaders/common/rng.wgsl`: the counter-based RNG of ADR 0004 (pcg4d keyed by seed, stream, index and draw), named streams in `core/streams`, and shared vectors in `tests/vectors/rng.json`.
  - Struct-layout tests: the TS descriptions of `Instance` and the sprite and composite uniforms checked against the WGSL with `wgsl_reflect`.
  - `tools/pack-atlas` (`npm run prepare-assets`): bitmap sheets to r8 layers with per-layer, coverage-preserving mips in `assets-built/`; `marks/atlas` uploads them as texture arrays, split where a sheet exceeds `maxTextureArrayLayers`.
  - The sprite pipeline (instanced quads, the reference's smoothstep ink edge, premultiplied, no MSAA) into an rgba16float ink target, and the composite onto Paper and Chalkboard reproducing v21's CSS blends.
  - `fallback/raster` and `CpuRenderer`: the software rasteriser and composite, f32 twins of the GPU passes, runnable in Node.
  - The page: the plate with one dot and a few more marks, a Paper/Chalkboard switch, and the CPU engine where WebGPU is missing (`?backend=cpu` forces it).
  - `npm run test:gpu`: Playwright and Chromium with WebGPU on SwiftShader, run in CI. RNG vectors bit-exact on the GPU; the one-mark render test (CPU raster against GPU raster, within 1/255); the composite against Chromium's rendering of the reference CSS.
  - `npm run screenshots`, and screenshots in `docs/milestones/m1/`.
  - The TypeGPU evaluation of ADR 0014 (`docs/notes/typegpu-evaluation.md`): it recommends staying with hand-written WGSL and TypeScript twins.

- M0 planning: reference notes for Rosse v21, the architecture and ADRs 0001–0014, the roadmap and open questions.
- Repository skeleton: TypeScript, Vite, vitest, ESLint, Prettier, WGSL files with an import resolver and naga validation, and CI workflows.
- `tools/capture-reference`: 186 golden captures of v21 (45 presets × 2 seeds × 2 cameras, plus Chalkboard).
- `tools/profile-reference`: timings and sizes of v21's stages.
- `spikes/vector-lines`: GPU pen ribbons compared with distance fields.

### Changed

- New binaries are committed as ordinary blobs (no LFS rules) and kept small.
- ADR 0007: the Paper field colour is `#e6dece`, the value v21's CSS uses.

### Removed

- The duplicate `rosse-v21.html` at the repository root (identical to `assets/reference/pages/rosse-v21.html`).
