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

So the metric (ADR 0013) compares what must match. All four tests below must pass. They work on the alpha channel α of the ink images:

| test | what | parity threshold (new engine vs v21) | strict threshold (engine vs itself on another adapter, or CPU engine vs GPU) |
| --- | --- | --- | --- |
| a. total ink | Σα | ±5% | ±0.5% |
| b. structure | SSIM of density maps: α blurred with σ = 4 plate px, downsampled 4× to 200², 7 × 7 window | ≥ τ per preset family, calibrated (provisional 0.85) | ≥ 0.98 |
| c. pen weight | stroke widths from the distance transform of α ≥ 0.5 on its medial axis: median and p90 | ±10% | ±2% |
| d. mark counts | instances per class (engine statistics vs `__GEN.stats()`) | ±3% (±10% under 100) | ±0.1% |
| e. self-regression | new engine vs its own goldens, SwiftShader | — | bit-exact |

**Why these four.** They cover the four ways a drawing can be wrong:

- (a) too much or too little ink: density, dot size, missing layers;
- (b) ink in the wrong places, at the scale of arms, bulges, tails and arcs, while ignoring the dots themselves;
- (c) the wrong pen: blurred, thickened or thinned marks, which (a) and (b) can miss;
- (d) the wrong number of each kind of mark, which is independent of placement.

**Calibrating τ.** Two sources of "the same galaxy, different dots":

- v21's partial re-roll under a 0.3° orbit (docs/reference-notes.md);
- the new engine re-keying only its placement streams (ADR 0004), which gives a full re-draw with identical structure.

M2 measures tests (a)–(c) over such pairs and sets τ per family to the 5th percentile of the full re-draws minus 0.02. Values go in `thresholds.json`, the numbers behind them in `calibration.json`. See ADR 0013 and `docs/milestones/m2/README.md`.

## Running it (from M2)

```sh
npm run golden                       # integrity, then every required case on WebGPU and the CPU engine
npm run golden -- --all              # also every preset capture, for information (never fails)
npm run golden -- --report-all       # an HTML report for every case, not only failing ones
npm run golden -- --calibrate        # re-measure and rewrite thresholds.json and calibration.json
npm run golden -- --update-engine    # rewrite engine-hashes.json, the engine's own goldens (test e)
npm run capture:reference -- --extra tests/golden/extra-cases.json   # the variant captures
npm run capture:reference -- --reroll                                # v21 re-roll pairs, for --calibrate
```

What M2 settled, beyond ADR 0013's text:

- **Required cases** are the captures with a `variant` (from `extra-cases.json`): in M2 the stipple-only captures of `Smooth, round`, `Cigar-shaped` and `Disc, no arms` (both seeds, both cameras). Each is compared three ways: WebGPU against v21 and the CPU engine against v21 at the family's parity thresholds, and the CPU engine against WebGPU at the strict ones; WebGPU is also rendered twice (L0) and checked against `engine-hashes.json` (e).
- **The same pen.** v21 picks each galaxy's hand (the pens its dots come from) from its own random stream, and the new engine from its own, so for a given seed they usually draw with different pens, which changes total ink by up to ±25% and stroke width by up to ±30%. That is a discrete choice of drawings (ADR 0005), not structure. The capture tool records v21's hand (`hand` in each capture's JSON) and the engine draws with it for the comparison; the result with the engine's own hand is printed as information.
- **(b′) coarse structure.** At σ = 4 px a full re-draw of a stipple-only galaxy scores only 0.3–0.6, so (b) cannot tell a re-draw from a change of structure. A second SSIM at σ = 16 px (100² map) scores re-draws 0.88–0.96 and a 35° orbit 0.48–0.82; both are gated, each at its calibrated threshold.
- **(c) as band means.** The "median" and "p90" are the means of the 40th–60th and 85th–95th percentiles: distances on a pixel grid take few values, and a single order statistic jumped by 12% between identical distributions.
- **(d) Poisson allowance.** A count may also differ by 3·√reference: v21 drew 1 and 3 sparkle stars for `Disc, no arms` where 0.5 are expected.

**Reports.** A failing case writes `diff/<name>.html`: both renders, both density maps, the signed density difference, and both stroke-width histograms. `diff/` is git-ignored and uploaded by CI as an artifact. Attach the report to your pull request.
