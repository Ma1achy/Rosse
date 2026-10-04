# M2: the stipple from the model, and the comparison harness

The galaxy's stipple is sampled, projected and compacted on the GPU (`compute/stipple.wgsl`, `project.wgsl`, `scan.wgsl`) and drawn by M1's sprite pass with `drawIndirect`; the CPU engine runs TypeScript twins of the same kernels. `npm run golden` compares both with v21 on the golden metric, ADR 0013 as calibrated in M2 by [ADR 0015](../../adr/0015-golden-metric-as-calibrated-in-m2.md). All numbers below are from Chromium 141 with WebGPU on SwiftShader (Playwright 1.56.1) and the CPU engine in Node 22.

| new engine (WebGPU) beside v21 | |
| --- | --- |
| `Smooth, round`, seed 7 | `smooth-round-s7.jpg` |
| `Cigar-shaped`, seed 4242 | `cigar-shaped-s4242.jpg` |
| `Disc, no arms`, seed 7 | `disc-no-arms-s7.jpg` |

Stipple-only variants (below), home camera, taken with `node tools/gpu-test/side-by-side.mjs`. The page draws with the engine's own variation, so its pens and lopsidedness differ from v21's for the same seed. The golden comparison draws with v21's.

## What is built

- `core/params`, `core/schema`, `core/presets`: all 109 keys of `DEF` with v21's defaults, ranges from v21's controls (13 keys without a control get ranges from their uses), tiers (camera and `mTime` view, `plates` present, the rest model; an `incl` change across an `incE` threshold dirties the model), and the 45 presets verbatim. Tests check all of it against `app23.js` itself.
- `model/variation`: `makeVariation` with the counter RNG, one index of the `variation` stream per group of fields. The hand: 1–3 sources among the pens whose median dot is ≥ 7 px with ≥ 8 dots, all 500 dots when `vary` < 0.15 or fewer than 12 qualify; 24 knots with replacement.
- `model/galaxy`, `model/scene`: the description both engines read (component weights, arms, spurs, dust patches, pools, per-dot quad sizes from `dotSprite`), rounded to f32 once. `GalaxyScalars` is typed from its layout.
- The stipple kernel: one invocation per proposal (`round(stars · stipple · (1 + 0.28 starMix))`). Components by v21's weights; bulge, halo, bar, clumpy ring (≤ 6 tries), disc (≤ 30 tries against `patchy` noise and `armProfile` with spurs and flocculence; v21's last-try rule kept), Sérsic (Marsaglia–Tsang, ≤ 64 tries, 2D as v21), `irr`, warp, lopsidedness, dust patches. Classification as v21: drawn star (classified and counted, not drawn), knot, sparkle star, or dot in the old, disc or young population, with v21's sizes.
- View tier: projection with v21's `project`, the dust optical depth as a pure cull on a stored per-sample uniform, then a deterministic per-class compaction (work-group scan of class counts packed 3 × 10 bits, block offsets, scatter) into one instance buffer, with indirect draw arguments per class. No read-back on the frame path.
- The dust optical-depth cull does change which marks show as you orbit an edge-on dusty galaxy. That is intended: it is occlusion along the line of sight, view-dependent in v21 and in ADR 0010. What orbiting never changes is which samples exist.
- `model/parts`: the drawn core (a bitmap; `Disc, no arms` has one).
- v21 parity, as open question Q13 recommends: `RMAX` is 240 (`// v21 parity:` in `model/galaxy.ts`), so nothing is truncated at 4.2.
- The page: a preset menu and a seed; `?preset=…&seed=…&variant=stipple`. It presents a frame first and reads the counts back afterwards, outside the frame queue. `window.__rosse` records the preset and seed actually drawn, and the controls wrap on a 390 px screen. Wiring the page to the cache tiers (it re-samples on every draw) is M3's.

### Not yet (later milestones)

Not built yet: dust lanes and the lane cull, dust-carving pen lines, ring knots, clumps, drawn stars (the `sstars` vector atlas) and the breathing room round bright ones, and every part other than the drawn core. The kernel keeps slots for them:

- drawn stars are already classified, so dot counts are right;
- view culls will read stored uniforms like `u_tau`;
- ring knots and clumps will be separate passes after the stipple.

The breathing room matters for dot counts. With `starMix` 0.6, v21 clears 2,000–4,000 dots round bright drawn stars in `Smooth, round` and `Cigar-shaped`: 7,785 dots against our 10,322 for `Smooth, round`, seed 7, default parameters. Drawn-star counts do not depend on it, and are gated (below).

## The acceptance cases

Roadmap M2: `Smooth, round`, `Cigar-shaped` and `Disc, no arms` with `lines: 0, knots: 0, envelope: 0`. v21 also draws ink this milestone does not have, so the extra captures (`tests/golden/extra-cases.json`) set three more overrides. These are recorded in ADR 0015 as awaiting the owner's sign-off:

- **`starMix: 0`**: drawn stars among the dots, which are vector marks;
- **`field: 0`**: the deep field, vector drawings;
- **`fgstars: 0`**: foreground stars, a sky layer.

`trails` is already 0 in these presets. Since review, the required set also has:

- `Smooth, round` and `Disc, no arms` at seeds 3 and 11, where v21's hand has 2 and 3 pens;
- **`Radio jet`**, a Sérsic profile, with `jet: 0` as well;
- **`Grand design`** with `vary: 0` and `dustScribble: 0`: arms. `vary: 0` gives no spurs, clumps, dust patches, lopsidedness or warp, and every dot drawing (checked by replaying v21's variation); `dustScribble: 0` gives no dust lanes.

That is 28 cases, each at home and orbit. The engine draws them with v21's own variation, replayed offline.

Parity, WebGPU against v21. The CPU engine gives the same values within the strict thresholds, as shown further down. Thresholds:

- **ink:** ±5%;
- **(b′) coarse SSIM:** ≥ 0.88 (spiral) or ≥ 0.91 (smooth);
- **widths:** ±10%;
- **radii r25, r50, r90:** ±4.1%, ±4.6%, ±5.1% (spiral) or ±3.7%, ±5.6%, ±9.0% (smooth);
- **outer ink:** ±1.6 or ±1.9 points;
- **axis ratio q:** ±0.037 or ±0.057; **inner q:** ±0.044 or ±0.039;
- **pa:** ±3.8° or ±4.5°, gated only where v21's q < 0.8;
- **counts:** as ADR 0015 item 4.

`Disc, no arms` and `Grand design` are spirals. (b) is reported, not gated.

| case | ink | (b) | (b′) | median w | p90 w | r25 | r50 | r90 | outer | Δq | Δq inner | Δpa (v21 q) | dots ours/v21 | sparkle stars |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cigar s4242 home | −1.0% | 0.617 | 0.950 | −0.6% | −2.5% | +0.3% | +0.4% | +0.5% | +0.13 | +0.014 | +0.019 | +0.4° (0.51) | 9500/9500 | 0/0 |
| cigar s4242 orbit | −0.9% | 0.615 | 0.949 | −0.3% | −0.9% | −0.3% | −0.7% | +3.3% | +0.59 | +0.026 | +0.008 | +2.6° (0.59) | 9500/9500 | 0/0 |
| cigar s7 home | −0.7% | 0.619 | 0.959 | +0.9% | +3.0% | −1.2% | −1.6% | −3.9% | −0.85 | +0.009 | +0.001 | −1.2° (0.53) | 9500/9500 | 0/0 |
| cigar s7 orbit | −1.5% | 0.615 | 0.953 | +0.6% | +5.5% | −0.3% | −0.3% | −1.5% | −0.58 | −0.007 | −0.021 | 0.0° (0.61) | 9500/9500 | 0/0 |
| disc s11 home | +1.7% | 0.486 | 0.933 | +0.1% | −0.7% | +0.6% | +1.7% | +0.4% | +0.12 | +0.016 | +0.015 | — (0.83) | 9499/9498 | 1/2 |
| disc s11 orbit | +1.6% | 0.523 | 0.949 | +0.3% | +1.1% | +1.4% | +0.1% | −0.1% | −0.03 | +0.014 | +0.024 | −1.1° (0.57) | 9499/9498 | 1/2 |
| disc s3 home | +1.9% | 0.450 | 0.931 | +2.4% | +1.3% | +1.6% | −1.3% | −2.0% | −0.61 | −0.001 | +0.021 | — (0.83) | 9461/9457 | 0/0 |
| disc s3 orbit | +2.7% | 0.576 | 0.955 | +2.6% | +2.3% | +1.0% | −0.9% | −1.5% | −0.57 | +0.007 | −0.008 | −1.1° (0.51) | 9461/9457 | 0/0 |
| disc s4242 home | +0.3% | 0.422 | 0.920 | +1.4% | +1.1% | −1.1% | +2.4% | +1.2% | +0.41 | −0.009 | −0.009 | — (0.83) | 9472/9469 | 0/3 |
| disc s4242 orbit | +0.1% | 0.555 | 0.955 | +0.9% | −0.4% | +1.8% | +0.1% | +0.2% | +0.04 | +0.007 | +0.019 | +0.3° (0.50) | 9472/9469 | 0/3 |
| disc s7 home | −0.8% | 0.420 | 0.918 | +1.6% | +1.1% | −0.8% | 0.0% | 0.0% | −0.02 | −0.008 | −0.011 | — (0.82) | 9459/9442 | 0/1 |
| disc s7 orbit | −0.9% | 0.477 | 0.936 | +0.6% | +0.3% | −0.5% | −0.5% | +3.5% | +0.92 | −0.008 | −0.011 | −1.8° (0.58) | 9459/9442 | 0/1 |
| grand design arms s4242 home | −0.3% | 0.487 | 0.928 | −0.4% | +0.8% | +0.4% | +0.4% | −1.6% | −0.41 | −0.018 | −0.017 | — (0.83) | 9474/9470 | 26/30 |
| grand design arms s4242 orbit | +0.4% | 0.517 | 0.935 | +0.9% | −1.9% | +0.7% | +0.7% | +1.2% | +0.38 | −0.019 | +0.004 | +0.7° (0.77) | 9474/9470 | 26/30 |
| grand design arms s7 home | +1.2% | 0.496 | 0.925 | −0.8% | +1.2% | +1.5% | −0.9% | +0.3% | +0.10 | +0.008 | −0.014 | — (0.82) | 9478/9475 | 22/25 |
| grand design arms s7 orbit | +1.3% | 0.506 | 0.929 | 0.0% | +0.6% | +2.3% | −0.8% | −2.3% | −0.57 | +0.017 | −0.007 | +0.7° (0.76) | 9478/9475 | 22/25 |
| radio jet s4242 home | +0.5% | 0.501 | 0.934 | 0.0% | +0.2% | −0.5% | −0.5% | −0.1% | −0.03 | +0.001 | 0.000 | — (0.93) | 9500/9500 | 0/0 |
| radio jet s4242 orbit | +0.5% | 0.504 | 0.934 | 0.0% | +1.9% | −0.1% | −0.3% | −0.5% | −0.17 | −0.001 | +0.006 | — (0.93) | 9500/9500 | 0/0 |
| radio jet s7 home | +1.1% | 0.508 | 0.940 | −0.3% | −0.2% | +1.1% | −1.2% | −2.7% | −0.60 | −0.006 | +0.014 | — (0.91) | 9500/9500 | 0/0 |
| radio jet s7 orbit | +0.9% | 0.504 | 0.940 | −0.4% | +0.9% | +0.8% | −1.4% | −3.1% | −0.68 | −0.012 | +0.017 | — (0.92) | 9500/9500 | 0/0 |
| smooth s11 home | −2.6% | 0.639 | 0.948 | −0.8% | +0.5% | −2.6% | −1.6% | −4.5% | −1.22 | +0.027 | 0.000 | — (0.97) | 9500/9500 | 0/0 |
| smooth s11 orbit | −2.9% | 0.650 | 0.960 | −0.1% | +0.4% | −1.6% | −2.3% | −4.3% | −1.03 | +0.022 | +0.004 | — (0.96) | 9500/9500 | 0/0 |
| smooth s3 home | −1.1% | 0.609 | 0.946 | 0.0% | +0.8% | −0.3% | +0.5% | +0.7% | +0.16 | +0.010 | +0.008 | — (0.95) | 9500/9500 | 0/0 |
| smooth s3 orbit | 0.0% | 0.603 | 0.954 | 0.0% | +1.3% | +0.4% | +0.2% | −2.1% | −0.39 | +0.026 | +0.007 | — (0.97) | 9500/9500 | 0/0 |
| smooth s4242 home | −0.3% | 0.588 | 0.947 | +0.2% | +1.3% | −0.1% | −0.9% | +0.1% | +0.04 | +0.026 | +0.018 | — (0.97) | 9500/9500 | 0/0 |
| smooth s4242 orbit | 0.0% | 0.580 | 0.947 | 0.0% | +1.5% | −0.3% | −1.5% | +2.0% | +0.35 | +0.023 | −0.008 | — (0.96) | 9500/9500 | 0/0 |
| smooth s7 home | −0.7% | 0.590 | 0.953 | +1.0% | +0.5% | +0.2% | −0.2% | −4.9% | −1.22 | +0.005 | +0.002 | — (0.99) | 9500/9500 | 0/0 |
| smooth s7 orbit | +0.1% | 0.590 | 0.951 | +0.3% | −0.5% | −0.4% | −0.9% | −5.3% | −1.19 | +0.004 | −0.015 | — (0.97) | 9500/9500 | 0/0 |

**28/28 required cases pass**, on WebGPU and on the CPU engine. Knots and drawn stars are 0 in both. Every "outer" value is in points of the total ink.

Counts:

- **Sparkle stars:** 0–2 against 0–3 pass by the Poisson allowance, which expects about 0.5 for `Disc, no arms`. The 22–26 against 25–30 for the arms case are within ±10%.
- **Drawn-star gate** (full captures, CPU engine, v21's variation): 12/12 pass. These are:
  - `Smooth, round` 774/720 and 749/756;
  - `Cigar-shaped` 805/714 and 775/781;
  - `Disc, no arms` 1095/1016 and 1085/1055.

  The `Disc, no arms` seed 7 pair (+79) is 1.8 standard deviations of the difference of two binomial draws. It fails ±3% (±30), which is why the Poisson allowance reaches to 2,000 (ADR 0015 item 4).

Drawn with the engine's own variation instead of v21's (printed by `npm run golden`, not gated), the ink differs by up to ±26% and the widths by up to ±25% for the same seed.

### CPU engine against WebGPU (L1)

- `npm run test:gpu`, stipple kernels on 14 scenes:
  - **scenes:** the 6 stipple-only cases; Grand design, Barred spiral, Flocculent, Ringed, Edge-on with dust, Lens: Einstein ring and Shell galaxy at seed 7; and a scene with every branch on (patchy, irregular, flocculent, dusty, ringed, barred, 4 arms, incl 70, az 40);
  - **result:** 0 class differences in 145,184 samples and in their projected instances, 100.000% of instances within 0.05 px, 0.1% size and 1e-3 rad, identical per-class counts, and every compacted slot matching;
  - **positions:** worst difference 3.5 × 10⁻³ px (Sérsic tails), typically 1–2 × 10⁻⁴ px;
  - **where it holds:** structurally exact on SwiftShader only. On other adapters the test falls back to L1 (ADR 0015 item 8).
- `npm run golden`, images, worst over the 28 cases:
  - ink 0.002%, widths 0.15%, radii 0.0015%, axis ratios 1e-5, position angle 0.13°;
  - coarse SSIM 1.000, identical counts (strict thresholds: ±0.5%, ±2%, ±0.5%, ±0.003, ±1°, ≥ 0.98, ±0.1%);
  - WebGPU twice is bit-identical (L0), and matches `engine-hashes.json` (e).

Getting there needed `sin`, `cos` and the stipple's Gaussian built from `+ − ×` (`core/f32math.ts`, `common/math.wgsl`; Cephes `sinf`/`cosf`). With WGSL's built-ins (allowed 2⁻¹¹ absolute error) only 91–98% of instances were within 0.05 px, up to 1.8 px off for Sérsic galaxies and 0.4 px for haloes, and 2–4 samples per scene changed class.

### Against v21's code

`tests/unit/v21-replay.test.ts` checks the engine against v21's own source:

- **`armProfile`:** evaluated verbatim from app23.js:L127–144 with the same variation, over a 48 × 90 grid of R × θ on 7 configurations: Grand design, Barred spiral, Flocculent (with lattice noise), Tightly wound, Loose, Hand-drawn arms, and 6 wide arms. The largest difference is 6.4 × 10⁻⁶.
- **The offline replay of v21's `makeVariation`:** it reproduces every hand recorded from v21's page, and v21's `mulberry32` stream itself.

## Calibration (ADR 0015)

Sources of "the same galaxy, other dots", per family (`tests/golden/calibration.json`):

1. **The new engine, drawing v21's variation, re-keying its placement stream:** a full re-draw with every structural choice kept. There are 72 configurations: 11 single-galaxy presets × 2 seeds × 2 cameras, plus the 28 stipple-only cases. Each has 3 keys, giving 120 spiral and 96 smooth pairs.
2. **v21's re-roll** (`npm run capture:reference -- --reroll`): every preset at home and at az + 0.3°. 71 of the 90 pairs changed their counts and were used.

| family | source | (b) p5–p95 | (b′) p5–p95 | p95 \|Δ\| ink | widths (median, p90) | r25, r50, r90 | outer | q, inner q | pa |
| --- | --- | --- | --- | ---: | --- | --- | ---: | --- | ---: |
| spiral | engine re-draw | 0.350–0.582 | 0.906–0.959 | 2.2% | 2.1%, 4.1% | 2.7%, 3.0%, 3.4% | 1.0 pt | 0.024, 0.029 | 2.6° |
| spiral | v21 re-roll | 0.896–0.977 | 0.975–0.999 | 0.3% | 1.0%, 3.0% | 0.3%, 0.5%, 0.6% | 0.2 pt | 0.008, 0.007 | 0.4° |
| smooth | engine re-draw | 0.480–0.643 | 0.932–0.959 | 3.2% | 1.2%, 5.5% | 2.5%, 3.7%, 6.0% | 1.3 pt | 0.038, 0.026 | 3.0° |
| smooth | v21 re-roll | 0.895–0.985 | 0.975–0.999 | 0.7% | 1.4%, 4.7% | 0.4%, 0.8%, 1.5% | 0.3 pt | 0.018, 0.010 | 0.3° |
| merger | v21 re-roll | 0.929–0.975 | 0.986–0.997 | | | | | | |
| lens | v21 re-roll | 0.873–0.976 | 0.972–0.995 | | | | | | |

Thresholds are 1.5 × p95 of the engine re-draws, with two exceptions. Ink and widths keep ADR 0013's ±5% and ±10% as floors. (b′) is gated at p5 − 0.02. The pa threshold is computed only over pairs where the reference's q < 0.8. At σ = 4 px (b) scores re-draws as low as real changes of structure (spiral re-draws 0.35–0.58 against 35° orbits 0.32–0.48), which is why it is no longer gated.

### Negative controls

Each control changes one thing and is re-keyed, then evaluated against the thresholds above. A control counts where it changes the drawing: a disc's thickness needs a disc, a position angle or orbit needs an axis ratio below 0.8, and the bulge controls need a bulge of at least 0.3.

| control | spiral: caught | smooth: caught | its median effect, where missed, against the re-draw noise (p95) |
| --- | ---: | ---: | --- |
| pa +30°, −30° | 22/22, 22/22 | 8/8, 8/8 | |
| 35° orbit | 22/22 | 8/8 | |
| dot size × 1.3 | 40/40 | 32/32 | |
| truncation at 4.2 units | 40/40 | 1/32 | smooth: r90 3.9% against 6.0%, outer 0.9 pt against 1.3; the halo beyond 4.2 units is 0.2% of a smooth galaxy's dots |
| `bulgeSize` × 1.5 | 4/24 | 20/20 | spiral (bulge 0.3–0.4): r25 1.1% against 2.7%, ink 3.0% against 2.2%, inner q 0.011 against 0.029 |
| `bulgeFlat` +0.15 | 2/24 | 12/12 | spiral: inner q 0.012 against 0.029 |
| `bulgeFlat` −0.15 | 3/24 | 12/24 | smooth, missed only on `Smooth, round` (incl 10–30°): seen nearly face-on, flattening along the line of sight barely shows; q 0.034 against 0.038 |
| halo off | 8/40 | 7/32 | spiral: r25 1.6% against 2.7%; smooth: r50 1.5% against 3.7%, q 0.017 against 0.038 (halo 0.10–0.25, 2.4–5.9% of the proposals, spread thinly over the plate) |
| `thick` × 3 | 15/40 (the edge-on views but one, and about half at incl 50–65°) | — | spiral, at incl 30–45°: q 0.022 against 0.024, inner q 0.018 against 0.029 |

The structure gate catches every control whose effect exceeds the noise of re-drawing the dots. These cases were missed by v21 parity before review and are now caught:

- `Cigar-shaped` made rounder (`bulgeFlat` +0.15);
- a bigger smooth bulge;
- every truncation at 4.2 of a disc;
- every turn of the sky and orbit.

The misses are effects smaller than that noise, as the last column shows. A single drawing of 9,500 dots cannot show them, whatever the measure. They are listed per configuration in `calibration.json`.

## Checks

| check | result |
| --- | --- |
| `npm run lint`, `typecheck` | clean |
| `npm test` | 104 tests |
| `validate:wgsl` | 18 files |
| `build` | OK |
| `test:gpu` | 4/4: one mark, RNG vectors, stipple kernels, surface |
| `golden` | 214/214 captures intact; 28/28 required cases; 12/12 drawn-star gates |
