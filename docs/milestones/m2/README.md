# M2: the stipple from the model, and the comparison harness

The galaxy's stipple is sampled, projected and compacted on the GPU (`compute/stipple.wgsl`, `project.wgsl`, `scan.wgsl`) and drawn by M1's sprite pass with `drawIndirect`; the CPU engine runs TypeScript twins of the same kernels. `npm run golden` compares both with v21 on the metric of ADR 0013, at thresholds calibrated here. All numbers below are from Chromium 141 with WebGPU on SwiftShader (Playwright 1.56.1) and the CPU engine in Node 22.

| new engine (WebGPU) beside v21 | |
| --- | --- |
| `Smooth, round`, seed 7 | `smooth-round-s7.jpg` |
| `Cigar-shaped`, seed 4242 | `cigar-shaped-s4242.jpg` |
| `Disc, no arms`, seed 7 | `disc-no-arms-s7.jpg` |

Stipple-only variants (below), home camera, taken with `node tools/gpu-test/side-by-side.mjs`. The page draws with the engine's own hand (pens), so its dots can be heavier or lighter than v21's for the same seed; the golden comparison uses v21's hand.

## What is built

- `core/params`, `core/schema`, `core/presets`: all 109 keys of `DEF` with v21's defaults, ranges from v21's controls (13 keys without a control get ranges from their uses), tiers (camera and `mTime` view, `plates` present, the rest model; an `incl` change across an `incE` threshold dirties the model), and the 45 presets verbatim. Tests check all of it against `app23.js` itself.
- `model/variation`: `makeVariation` with the counter RNG, one index of the `variation` stream per group of fields. The hand: 1–3 sources among the pens whose median dot is ≥ 7 px with ≥ 8 dots, all 500 dots when `vary` < 0.15 or fewer than 12 qualify; 24 knots with replacement.
- `model/galaxy`, `model/scene`: the description both engines read (component weights, arms, spurs, dust patches, pools, per-dot quad sizes from `dotSprite`), rounded to f32 once.
- The stipple kernel: one invocation per proposal (`round(stars · stipple · (1 + 0.28 starMix))`). Components by v21's weights; bulge, halo, bar, clumpy ring (≤ 6 tries), disc (≤ 30 tries against `patchy` noise and `armProfile` with spurs and flocculence; v21's last-try rule kept), Sérsic (Marsaglia–Tsang, ≤ 64 tries, 2D as v21), `irr`, warp, lopsidedness, dust patches. Classification as v21: drawn star (classified and counted, not drawn), knot, sparkle star, or dot in the old, disc or young population, with v21's sizes.
- View tier: projection with v21's `project`, the dust optical depth as a pure cull on a stored per-sample uniform, then a deterministic per-class compaction (work-group scan of class counts packed 3 × 10 bits, block offsets, scatter) into one instance buffer, with indirect draw arguments per class. No read-back on the frame path.
- `model/parts`: the drawn core (a bitmap; `Disc, no arms` has one).
- v21 parity, as open question Q13 recommends: `RMAX` is 240 (`// v21 parity:` in `model/galaxy.ts`), so nothing is truncated at 4.2.
- The page: a preset menu and a seed; `?preset=…&seed=…&variant=stipple`.

### Not yet (later milestones)

Dust lanes and the lane cull, dust-carving pen lines, ring knots, clumps, drawn stars (the `sstars` vector atlas) and the breathing room round bright ones, and every other part. The kernel keeps their slots: drawn stars are already classified (so dot counts are right), view culls will read stored uniforms like `u_tau`, and ring knots and clumps will be separate passes after the stipple. Note the breathing room matters for counts: with `starMix` 0.6, v21 clears 2,000–4,000 dots round bright drawn stars in `Smooth, round` and `Cigar-shaped` (7,785 dots against our 10,322 for `Smooth, round`, seed 7, default parameters).

## The acceptance cases

Roadmap M2: `Smooth, round`, `Cigar-shaped` and `Disc, no arms` with `lines: 0, knots: 0, envelope: 0`, both seeds, home and orbit. v21 also draws ink this milestone does not have, so the extra captures (`tests/golden/extra-cases.json`) set three more overrides: **`starMix: 0`** (drawn stars among the dots, vector marks), **`field: 0`** (the deep field, vector drawings) and **`fgstars: 0`** (foreground stars, a sky layer). `trails` is already 0 in these presets. The captures also record v21's hand.

Parity (WebGPU against v21; the CPU engine gives the same numbers to the last digit except where shown). Thresholds: smooth family ink ±5%, SSIM ≥ 0.36, coarse SSIM ≥ 0.89, widths ±10%, counts ±3% (±10% under 100) or 3√n; `Disc, no arms` is in the spiral family: SSIM ≥ 0.29, coarse ≥ 0.87.

| case | ink | SSIM | coarse SSIM | median width | p90 width | dots (ours/v21) | sparkle stars | result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| smooth-round s7 home | −0.7% | 0.590 | 0.953 | +1.0% | +0.5% | 9,500/9,500 | 0/0 | pass |
| smooth-round s7 orbit | +0.1% | 0.590 | 0.951 | +0.3% | −0.5% | 9,500/9,500 | 0/0 | pass |
| smooth-round s4242 home | −0.3% | 0.588 | 0.947 | +0.2% | +1.3% (CPU +1.2%) | 9,500/9,500 | 0/0 | pass |
| smooth-round s4242 orbit | 0.0% | 0.580 | 0.947 | 0.0% | +1.5% (CPU +1.3%) | 9,500/9,500 | 0/0 | pass |
| cigar-shaped s7 home | −0.7% | 0.619 | 0.959 | +0.9% | +3.0% | 9,500/9,500 | 0/0 | pass |
| cigar-shaped s7 orbit | −1.5% | 0.615 | 0.953 | +0.6% | +5.5% (CPU +5.4%) | 9,500/9,500 | 0/0 | pass |
| cigar-shaped s4242 home | −1.0% | 0.617 | 0.950 | −0.6% | −2.5% | 9,500/9,500 | 0/0 | pass |
| cigar-shaped s4242 orbit | −0.9% | 0.615 | 0.949 | −0.3% | −0.9% | 9,500/9,500 | 0/0 | pass |
| disc-no-arms s7 home | −1.3% | 0.392 | 0.903 | −0.9% (CPU −1.0%) | +0.4% | 9,355/9,442 (−0.9%) | 0/1 | pass |
| disc-no-arms s7 orbit | −1.7% | 0.464 | 0.916 | +1.2% | +0.6% | 9,355/9,442 (−0.9%) | 0/1 | pass |
| disc-no-arms s4242 home | +0.8% | 0.402 | 0.912 | +1.9% | +0.6% | 9,500/9,469 (+0.3%) | 0/3 | pass |
| disc-no-arms s4242 orbit | +0.8% | 0.513 | 0.895 | +0.9% | +0.4% | 9,500/9,469 (+0.3%) | 0/3 | pass |

**12/12 required cases pass**, on WebGPU and on the CPU engine. Knots and drawn stars are 0 in both. The 0 against 1–3 sparkle stars passes by the Poisson allowance (below): 0.5 are expected.

With the engine's own hand instead of v21's (printed by `npm run golden`, not gated) the ink differs by −8% to +26% and widths by up to ±25%: for seeds 7 and 4242 v21 happens to draw these presets with the same 25-dot pen (DG-4), the new engine with other pens.

### CPU engine against WebGPU (L1)

- `npm run test:gpu`, stipple kernels on 14 scenes (the 6 stipple-only cases; Grand design, Barred spiral, Flocculent, Ringed, Edge-on with dust, Lens: Einstein ring, Shell galaxy at seed 7; and a scene with every branch on: patchy, irregular, flocculent, dusty, ringed, barred, 4 arms, incl 70, az 40): **0 class differences** in 145,184 samples and in their projected instances, **100.000%** of instances within 0.05 px, 0.1% size and 1e-3 rad, **identical per-class counts** (0.000%), every compacted slot matching; worst position difference **3.5 × 10⁻³ px** (Sérsic tails), typically 1–2 × 10⁻⁴ px.
- `npm run golden`, images: at most 0.0% ink, SSIM 1.000, coarse 1.000, widths within 0.2%, identical counts on every case (strict thresholds: ±0.5%, ≥ 0.98, ±2%, ±0.1%). WebGPU twice: bit-identical (L0); against `engine-hashes.json`: identical (e).

Getting there needed `sin`, `cos` and the stipple's Gaussian built from `+ − ×` (`core/f32math.ts`, `common/math.wgsl`; Cephes `sinf`/`cosf`): with WGSL's built-ins (allowed 2⁻¹¹ absolute error) only 91–98% of instances were within 0.05 px, up to 1.8 px off for Sérsic galaxies and 0.4 px for haloes, and 2–4 samples per scene changed class.

## Calibration (ADR 0013)

Two sources of "the same galaxy, other dots", per family (`tests/golden/calibration.json`):

1. **The new engine re-keying its placement stream** (a full re-draw, every structural choice kept): 14 single-galaxy presets plus the 3 stipple-only variants × 2 seeds × 2 cameras = 68 configurations × 4 keys.
2. **v21's re-roll** (`npm run capture:reference -- --reroll`): every preset at home and az + 0.3°; 71 of the 90 pairs (45 presets × 2 seeds) changed their counts (the stipple re-rolled from the first lane cull or breathing-room change) and were used.

For the margin, "other structure" pairs: the orbit camera (az + 35°, incl + 20°) against home, re-keyed.

| family | source | pairs | SSIM p5 / median / p95 | coarse SSIM p5 / median / p95 | \|Δink\| p95 | \|Δmedian\| p95 | \|Δp90\| p95 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: |
| spiral | engine re-key | 160 | 0.313 / 0.414 / 0.570 | 0.894 / 0.919 / 0.951 | 2.4% | 2.2% | 3.7% |
| spiral | other structure (35° orbit) | 40 | 0.256 / 0.336 / 0.475 | 0.526 / 0.699 / 0.781 | 27% | 8.6% | 24% |
| spiral | v21 re-roll | 32 | 0.896 / 0.969 / 0.977 | 0.975 / 0.997 / 0.999 | 0.3% | 1.0% | 3.0% |
| smooth | engine re-key | 112 | 0.385 / 0.517 / 0.627 | 0.913 / 0.941 / 0.960 | 2.6% | 0.6% | 5.1% |
| smooth | other structure (35° orbit) | 28 | 0.395 / 0.509 / 0.610 | 0.909 / 0.930 / 0.951 | 12% | 0.6% | 6.5% |
| smooth | v21 re-roll | 9 | 0.895 / 0.952 / 0.985 | 0.975 / 0.994 / 0.999 | 0.7% | 1.4% | 4.7% |
| merger | v21 re-roll | 18 | 0.929 / 0.964 / 0.975 | 0.986 / 0.995 / 0.997 | 0.3% | 2.5% | 3.8% |
| lens | v21 re-roll | 12 | 0.873 / 0.934 / 0.976 | 0.972 / 0.980 / 0.995 | 1.0% | 1.6% | 2.5% |

(A 35° orbit of a near-round smooth galaxy barely changes its structure, so its "other structure" pairs score like re-draws, as they should.)

What the numbers say:

- **Test (b) at σ = 4 px does not separate re-draws from changes of structure** once the whole stipple is re-drawn: spiral re-draws score 0.31–0.57, 35° orbits 0.26–0.48. ADR 0013's 0.97 was measured on v21's re-roll, which is a partial re-draw (here 0.90–0.98, reproduced). At σ = 4 px the map still resolves single dots in all but the core.
- **(b′) coarse SSIM (σ = 16 px, 100² map)** does: spiral re-draws 0.89–0.96, 35° orbits 0.53–0.78 (p95 0.78 against a threshold of 0.87).
- Ink and widths of re-draws differ by at most 2–5% (p95), well inside the ADR's ±5% and ±10%.

Thresholds set (`tests/golden/thresholds.json`), as ADR 0013 says where it is specific:

| family | ink | SSIM (τ) | coarse SSIM | median, p90 | counts |
| --- | --- | --- | --- | --- | --- |
| spiral | ±5% | ≥ 0.29 (p5 0.313 − 0.02) | ≥ 0.87 (p5 0.894 − 0.02) | ±10% | ±3% (±10% under 100), or 3√n |
| smooth | ±5% | ≥ 0.36 (p5 0.385 − 0.02) | ≥ 0.89 (p5 0.913 − 0.02) | ±10% | the same |
| merger, lens, star, artefact | ±5% | ≥ 0.85 (provisional) | ≥ 0.85 (provisional) | ±10% | the same |
| strict (CPU against WebGPU) | ±0.5% | ≥ 0.98 | ≥ 0.98 | ±2% | ±0.1%, no allowance |

- Ink and widths: ADR 0013 asks for "p95 plus a margin"; 1.5 × p95 is 3.7–7.7%, below the ADR's own ±5% and ±10% for all but one, so the ADR values are kept as floors. They also have to cover what re-draws do not: the renderers' deliberate differences (per-drawing mipmaps, no MSAA, f16 accumulation against v21's 8-bit canvas).
- Families with no engine yet keep the ADR's provisional values, and are recalibrated when their milestone lands.

### Changes to the metric, and why

Each is a decision for the owner to confirm (ADR 0013 said the thresholds were provisional until M2):

1. **(b′) added** (σ = 16 px, 8× downsampling, the same 7 × 7 SSIM), gated with (b). Without it, a galaxy drawn with the wrong structure would pass (b) at its calibrated τ. Recommendation: make (b′) the structure test and keep (b) for information.
2. **SSIM over windows with ink.** Windows where both maps are below 10⁻³ are left out: they score 1 for any pair of drawings and dilute the mean on mostly empty plates.
3. **(c) as band means.** Median and p90 are the means of the 40th–60th and 85th–95th percentiles of the widths, which come from α upsampled 4× (bilinear) before the distance transform. With single order statistics, `Disc, no arms` s4242 home failed at +11.8% median width between two width distributions whose means differ by 2%: a third of the widths are exactly 2.000 px and the median flipped to the next value, 2.236.
4. **(d) Poisson allowance** of 3√n per class (parity only): v21's 1 and 3 sparkle stars in `Disc, no arms` where 0.5 are expected.
5. **The reference's hand.** The engine draws with v21's dot pool (recorded at capture) for the comparison; see "The acceptance cases".

## Checks

`npm run lint`, `typecheck`, `test` (93 tests), `validate:wgsl` (18 files), `build`, `test:gpu` (4/4: one mark, RNG vectors, stipple kernels, surface), `golden` (198/198 captures intact; 12/12 required cases).
