# Golden images

The reference page, Rosse v21 (`assets/reference/pages/rosse-v21.html`), is the oracle. This folder holds renders of it, and from M2 the harness that compares the new engine against them.

## Reference captures (`reference/`)

Made by `npm run capture:reference` (`tools/capture-reference/capture.mjs`):

- **Cases.** All 45 presets × seeds **7** and **4242** × two cameras. That is 180 cases, plus 6 on the Chalkboard surface (`Grand design`, `Merger: the Mice` and `Lens: Einstein ring` at seed 7), for **186 captures**.
  - **home** is the preset's own inclination, azimuth and position angle.
  - **orbit** is az + 35° and incl + 20° (clamped to 0–180°). It is reached by orbiting _from_ home, so lensed sources and overlays, which v21 fixes in the scene at the view where it first placed them, are seen from a new angle.
- **Per capture:**
  - `<name>.ink.png`: 800 × 800, premultiplied ink on transparent, read straight from v21's WebGL canvas. **This is the comparison input.**
  - `<name>.plate.jpg`: the canvas as it looks on the page, over Paper or Chalkboard, for people to look at.
  - `<name>.json`: the full parameter set, camera, `__GEN.stats()` (dots, knots, stars, drawn stars, curves, drawings used, ms), the exact capture sequence, and a pixel hash.
- `manifest.json`: every capture's pixel hash and stats, the reference page's SHA-256, and the browser build and flags.
- **Naming:** `<preset-slug>__s<seed>__<home|orbit>[__chalk]`.

**How the captures are made reproducible:**

- Chromium is pinned through Playwright 1.56.1 and renders WebGL with SwiftShader (`--use-angle=swiftshader`), a software renderer that gives the same pixels on every machine.
- The canvas is forced to 800 × 800 CSS px at device pixel ratio 1, matching v21's 800-unit plate.
- The page is reloaded for every (preset, seed), because v21 keeps hidden state (`homeFor`).

`npm run capture:reference -- --verify` captures everything again and compares pixel hashes with the manifest. On 3 October 2026 an independent second run reproduced all 186 ink images bit for bit.

## The comparison (from M2)

v21 places every dot from a sequential random stream. The new engine uses a parallel, counter-based one (ADR 0004), so **its dots land in different places**. That is by design: parity is statistical (ADR 0005). This rules out two obvious tests:

- **Pixel-exact comparison** fails by construction.
- **Plain SSIM on the ink** is the wrong test too. With 2–3 px dots in different places, two equally correct drawings of the same galaxy are penalised, because at SSIM's window size the "structure" is the random dots themselves. Measured on v21:
  - pairs that re-roll only _part_ of the stipple score 0.70–0.81 plain SSIM;
  - the density-map SSIM below scores those same pairs 0.97–0.98, and a genuine change of structure (a 35° orbit) 0.37–0.50.

So the metric (ADR 0013, as calibrated in M2 by ADR 0015) compares what must match. It works on the alpha channel α of the ink images. The gated tests are (a), (b′), (c), (d) and (f):

| test | what | parity (new engine vs v21), spiral / smooth | strict (CPU engine vs WebGPU) |
| --- | --- | --- | --- |
| a. total ink | Σα | ±5% / ±5% | ±0.5% |
| b. fine structure (reported, not gated) | SSIM of density maps: σ = 4 px, downsampled 4× to 200², 7 × 7 windows with ink | — | — |
| b′. structure | the same SSIM on coarse density maps: σ = 16 px, downsampled 8× to 100² | ≥ 0.88 / ≥ 0.91 | ≥ 0.98 |
| c. pen weight | stroke widths from the distance transform of α ≥ 0.5 (α upsampled 4×) on its medial axis: band means of the 40th–60th ("median") and 85th–95th ("p90") percentiles | ±10% / ±10% | ±2% |
| d. mark counts | per class (dots, knots, stars, drawn stars), engine statistics vs `__GEN.stats()` | 0 in both where the parameters make the class impossible; else ±3% (±10% under 100), or 3·√(v21 + engine) below 2,000 (v21 drawing none included) | ±0.1% |
| e. self-regression | WebGPU vs its own goldens (`engine-hashes.json`), SwiftShader; and twice in a row | — | bit-exact |
| f. moments and extent | about the plate centre: radii holding 25%, 50%, 90% of the ink; ink beyond v21's r90; axis ratio within v21's r90 and r50; position angle | r25 ±4.1% / ±3.7%, r50 ±4.6% / ±5.6%, r90 ±5.1% / ±9.0%, outer ±1.6 / ±1.9 points; q and inner q per preset (family ±0.037, ±0.044 / ±0.057, ±0.039); pa ≤ paA / (ε − ε₀), ε the ellipticity of v21's drawing, paA 1.27° / 1.37°, ε₀ per preset, ungated when that exceeds 90° | ±0.5%, ±0.2 points, ±0.003, pa ≤ 0.1° / ε |

The values are in `thresholds.json` (merger, lens, star and artefact are provisional until their engines land), the numbers behind them in `calibration.json`, and the reasoning in ADR 0015 and `docs/milestones/m2/README.md`.

**Why these.** They cover the ways a drawing can be wrong:

- (a) too much or too little ink: density, dot size, missing layers;
- (b′) ink in the wrong places, at the scale of arms, bulges, tails and arcs, while ignoring the dots themselves;
- (f) the wrong size or shape: a bulge too big, a galaxy too round, a halo missing, a disc truncated, a wrong position angle, which density maps hardly see;
- (c) the wrong pen: blurred, thickened or thinned marks;
- (d) the wrong number of each kind of mark, which is independent of placement.

**Calibrating.** Two sources of "the same galaxy, different dots":

- v21's partial re-roll under a 0.3° orbit (docs/reference-notes.md);
- the new engine re-keying only its placement stream (ADR 0004) while drawing v21's own variation, which gives a full re-draw with identical structure.

Since ADR 0018 the comparison is one v21 draw against the mean of K engine draws, and the calibration measures that statistic: per configuration, three stand-in draws for v21 against the mean of the K draws of the comparison's keys, and each negative control drawn with the same K keys. Thresholds are 1.5 × the 95th percentile of each measure over the engine's re-draws (ink and widths keep ADR 0013's ±5% and ±10% as floors), and (b′) the 5th percentile minus 0.02. Negative controls (pa ±30°, `bulgeFlat` ±0.15, `bulgeSize` × 1.5, halo off, truncation at 4.2 units, `thick` × 3, dot size × 1.3, a 35° orbit) are measured against them; `calibration.json` records which are caught.

## Running it (from M2)

```sh
npm run golden                       # integrity, then every required case on WebGPU and the CPU engine
npm run golden -- --all              # also every preset capture, for information (never fails)
npm run golden -- --report-all       # an HTML report for every case, not only failing ones
npm run golden -- --calibrate        # re-measure (4 processes; --jobs n) and rewrite thresholds.json, calibration.json (hours; --resume after a stop)
npm run golden -- --calibrate --reuse-shards --keys 4   # re-aggregate the last calibration for another K
npm run golden -- --calibrate --controls-every 2   # the negative controls on every other configuration (default: all); --resume adds them later
npm run golden -- --update-engine    # rewrite engine-hashes.json, the engine's own goldens (test e)
npm run capture:reference -- --extra tests/golden/extra-cases.json   # the variant captures
npm run capture:reference -- --extra tests/golden/extra-cases.json --cameras zoom   # only the zoom camera
npm run capture:reference -- --reroll                                # v21 re-roll pairs, for --calibrate
```

- **Required cases** are the captures with a `variant` (from `extra-cases.json`): the stipple-only captures of `Smooth, round` and `Disc, no arms` (seeds 7, 4242, 3 and 11), `Cigar-shaped` and `Radio jet` (Sérsic), and `Grand design` with `vary: 0` (arms), at seeds 7 and 4242 otherwise, home and orbit cameras; and, from M3, the **zoom camera** (open question Q8) for `Smooth, round`, `Cigar-shaped` and `Disc, no arms` at seeds 7 and 4242: the home view at zoom 2 through v21's `__GEN.zoom(2)` (`VIEW.scale` = 168), recorded as `"zoom": 2` in the capture and the manifest and rendered by the engine at the same zoom; and, from M4, the `ribbons` cases (`Grand design`, `Barred spiral`, `Flocculent`, `Tightly wound`, `Loose, open arms`, `Dusty spiral`, `Hand wobble`, seeds 7 and 4242, home, orbit and zoom; overrides in `extra-cases.json` and docs/milestones/m4/README.md); and, from M5, the `vectors` cases (`Hand-drawn arms`, `Ringed`, `Disc, no arms`, `Barred spiral`, `Edge-on with dust`, `Radio jet`, `Stellar streams`, `Shell galaxy`, seeds 7 and 4242, home, orbit and zoom; overrides in ADR 0022), drawn with v21's part picks too (`compare/v21-parts.ts`, ADR 0021). Each is compared three ways: WebGPU and the CPU engine against v21 at the family's parity thresholds, and the CPU engine against WebGPU at the strict ones. WebGPU is rendered twice (L0) and checked against `engine-hashes.json` (e).
- **The mean of K draws** (ADR 0018). Every parity measure is the mean over K draws (K = `keys` in `thresholds.json`, 6): the engine's canonical draw and K − 1 re-draws of the placement key, which the CPU engine renders first in parallel processes (`--jobs`). The canonical draw alone is printed for information (`key 0`), and L0, (e) and the strict comparison use it only.
- **Drawn-star gate.** The drawn-star counts of the full captures of the three acceptance presets are compared with v21's (`STATS.rstars` does not depend on v21's breathing room), on the CPU engine.
- **v21's variation.** The runner replays v21's `makeVariation` offline on v21's own stream (`compare/v21.ts`) and draws with it, so both engines draw the same galaxy with the same pens. The engine's own variation is printed for information. From M4 it also draws with v21's other discrete random choices (ADR 0018): its stroke picks and outline and tail angles (v21's own `curves()`, `compare/v21-curves.ts`), its noise corners (`compare/v21-noise.ts`), its dust choices (the numbers of v21's own `dustLanes()` stream, recorded in the order it used them, and the hatches' and carving lines' pen lines) and its ring-knot clusters, so that only the marks differ. The capture tool still records v21's hand (`hand`, truncated by the page at 400 tiles) as a cross-check of the replay (`tests/unit/v21-replay.test.ts`).

**Reports.** A failing case writes `diff/<name>.html`: both renders, both density maps, the signed density difference, and both stroke-width histograms. `diff/` is git-ignored and uploaded by CI as an artifact. Attach the report to your pull request.

## Lens goldens (M9)

`variant=lens` captures the six `Lens: …` presets and `A sketch, lensed` at seeds 7 and 4242, home then orbit, each on a fresh page (v21 fixes its lensed sources at the view where it first placed them, so the order matters). The runner draws them with v21's lens picks (`compare/v21-lens.ts`, ADR 0051), and the thresholds of the `lens` family come from `npm run golden -- --calibrate --only-family lens` (ADR 0015's procedure; the other families are left as they are). The overrides are in ADR 0052, the inner axis-ratio band in ADR 0054. `Layered: lensed merger` (lens on, the same overrides) is in the set since M8 merged; it is a `merger` family case. Results: `docs/milestones/m9/README.md`.
