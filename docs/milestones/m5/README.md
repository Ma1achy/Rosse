# M5: vector marks

The drawn parts are drawn: envelopes, whole drawings (rewound to the galaxy's pitch), drawn arms, bars and rings, bubbles at the clumps, the nuclear spiral, arcs, shells, the tail, trails and cosmic rays, the arrow, the jet and the stellar streams, every one a hand-drawn vector drawing expanded into pen capsules, dots and blobs on the GPU. All numbers below are from Chromium 141 with WebGPU on SwiftShader (Playwright 1.56.1) and the CPU engine in Node 22.

| new engine (WebGPU) beside v21 | |
| --- | --- |
| `Hand-drawn arms`, seed 7, home | ![Hand-drawn arms, seed 7, home](hand-drawn-arms-s7.jpg) |
| `Barred spiral`, seed 4242, orbit camera | ![Barred spiral, seed 4242, orbit camera](barred-spiral-s4242-orbit.jpg) |
| `Radio jet`, seed 7, zoom 2 | ![Radio jet, seed 7, zoom 2](radio-jet-s7-zoom.jpg) |

These are the `vectors` variant (below), drawn as the golden runner draws them, with v21's variation, stroke choices, noise and part picks, so both sides show the same galaxy (`node tools/gpu-test/side-by-side.mjs --set m5`; the new engine's ink is shown over the plate's field colour). The page (`?variant=vectors`) draws the same presets with the engine's own picks.

## What is built

- **The library on the GPU** (`marks/vector.ts`, ADR 0006): all 12 vector sheets (429 drawings) packed once into shared tables: 23,431 segments, 6,038 dots and 328 blobs, a per-drawing range table, and the prefix of each segment's densified piece count (86,280 pieces at ≤ 0.012 tile units, used only under a warp). The packer copies every sheet with its metadata (packer 4).
- **Parts placement as scene description** (`model/parts.ts`):
  - The model tier (`describeParts`) makes every choice of v21's `parts()` (L987–1086) by v21's rules:
    - envelopes, halo or disc;
    - whole drawings matched to the type (`wholeTypeOf`: the structure predicates of ADR 0017, including L1000's `smooth:elongated`), with v21's doubled spiral pool;
    - drawn arms by tightness class, each copying the first or not;
    - non-solid bars, rings, the nuclear spiral;
    - arcs, drawn shells, the tail's pen line;
    - trails and cosmic rays and the field-gated arrow, at v21's fixed plate positions (v21 parity: they ignore the zoom, reference notes 20.15);
    - bubbles (a `rings` curve at a clump, with probability 0.6 · bubbles), the jet (the `misc` spring, both ways);
    - the streams (a pen line's longest polyline bent round the galaxy, in the plate: v21 parity, it ignores the camera).

    Each part has its own index on the `parts` stream (`PartIndex`), so turning the jet on no longer changes the bar.
  - The view tier (`vectorRows`) lays out v21's rows `[x, y, tile, alpha, m, ps, warp]` for a camera (`discM`, the scale, the bubbles' projected clumps), in the `MAGNIFIED` order, a few dozen per galaxy.
  - The drawn core of M2 is extended with the nuclear spiral (`coreInstances`).
- **`compute/vector-expand.wgsl`** with its CPU twin `fallback/kernels/vector.ts`:
  - `expand_caps`: one capsule slot per segment, or, under a warp, per densified piece. Its instance is found by binary search on the slots, its piece by binary search on the densified prefix. Both ends go through `tf`: the warp, the column-major matrix and translation, then the hand wobble. The capsule's half width is `PEN.line/2 · ps` plate px (spike variant A2's coverage).
  - The warps:
    - `rewind`, θ += dk · ln(r/0.08), mirrored first for a Z-wise drawing, nothing within 0.015 of the centre (`rewindFn`, L842–845), turned by `cos_f`/`sin_f` with no `atan2`;
    - a generic `post` hook (a plate affine about a centre) for the tides and lens Jacobians of M8 and M9.

    Under a warp, segments longer than 22 px are dropped; under `post`, also those stretched more than 1.8× (L1207–1208).
  - `expand_dots`: a vector dot becomes a `dots` sprite from the hand, `VAR.dotPool[|round(997x + 131y)| % len]`, sized `dotSprite(t, clamp(2r·sc·0.42/2.6, 0.8, 1.6)·max(0.55, ps))`.
  - `expand_blobs`: a blob becomes a `knots` sprite, `VAR.knotPool[|round(991 cx)| % 24]`, with the matrix `M·R(θ)·S(max(1.7 rx, 3/sc), …)`.
  - `stream_marks`: the streams' dots and knots, one slot per 2.4 px of the bent pen line, kept with probability 0.55 + 0.45 · streams, one in 25 a knot, jittered by 1.4 px, on their own stream (`partMarks`) keyed by the placement key.
  - Two deterministic compactions (`scan_local`, `scan_blocks`, scatter; ADR 0004): the kept capsules, and the streams' dots and knots, in slot order, with indirect draw arguments. Capsules are drawn with `drawIndirect` (`[6n, 1, 0, 0]`); the stream marks as indirect sprites.
  - v21 parity: every vertex, dot and blob is drawn at alpha 1, whatever the row's alpha (reference notes 20.10: the ring at 0.55 is drawn at full strength).
- **Draw order** exactly as `scene()` (L1289–1301): stroke ribbons; every vector drawing's lines, dots and blobs (the hatching's, then the parts'), in line ink; pieces; the stipple's old, disc and young dots; the streams' dots and knots (old ink); knots; sparkle stars; the core and the nuclear spiral (old ink). v21 expands every vector sheet, the bars, rings and arcs included, into the one line-ink layer and empties their own sprite layers (L1287), so they are drawn there and not in `old` or `young` ink.
- **Both engines** draw the same layers (`GpuStipple.inkLayers`, `CpuStipple.view`).
- **The used-drawings count** (`model/used.ts`): the sources v21's `USED` collects, counted from what the CPU engine draws. It does not yet count the drawn stars (M7) or the carving lines' pen lines.
- **The page** draws every part with the engine's own picks (`?variant=vectors` gives the golden overrides).

## Acceptance

### The golden set and its overrides

Roadmap M5: `Hand-drawn arms`, `Ringed`, `Disc, no arms`, `Barred spiral` (with its drawn bar and ring), `Edge-on with dust`, `Radio jet` (with the jet), `Stellar streams`, `Shell galaxy` (its drawn part), seeds 7 and 4242, home, orbit and zoom (home at zoom 2). 48 v21 captures, variant `vectors` (`tests/golden/extra-cases.json`, captured with `npm run capture:reference -- --extra tests/golden/extra-cases.json --variant vectors`). Every override, and why (ADR 0022, proposed):

| override | why |
| --- | --- |
| `starMix: 0` | drawn stars among the stipple are vector `sstars` placed by `generate()` (M7). The ring knots' and clumps' drawn stars stay, because v21 draws them whatever `starMix`. Both sides classify and count them (`rstars` 15/15 for `Ringed`, 9/9 for `Barred spiral`); they are not drawn yet |
| `field: 0`, `fgstars: 0` | the deep field and the foreground stars (the sky, M7). `field: 0` also turns off the arrow, which v21 draws only in a deep field |
| `Shell galaxy`: `shellsOn: 0`, `shells: 1` | its simulated shells are an N-body integration (M8). Its drawn part is the `shells` sheet, which the preset leaves at 0 |

Not overridden: envelopes, drawn arms, the drawn bar and ring, bubbles (v21's default 0.4, at the clumps of every preset with arms), the jet, the streams, the ribbons, the dust lanes and their hatching, and the core.

### What the comparison draws with (ADR 0021, proposed)

M2 and M4 draw with v21's replayed variation, strokes and noise. The runner now also draws with v21's **part picks** (`compare/v21-parts.ts`). These are `parts()`'s draws replayed on v21's own stream `mulberry32(seed · 57 + 3)`, at the capture's zoom, including the streams' mark draws that sit between one stream's picks and the next.

`tests/unit/parts.test.ts` checks the replay against v21's own `parts()`, cut out of app23.js and evaluated as written. It runs 17 configurations (the M5 presets, and parameter sets with every part on) at 4 cameras, and requires:

- the same drawings in the same order;
- the same positions and matrices, to 10⁻⁶;
- the same pen scales and rewind warps;
- the same cores and nuclear spiral;
- every v21 stream mark within 6.3 px of the engine's streams.

`tests/unit/parts-distribution.test.ts` checks the engine's own picks against v21's over 2,000 seeds: a χ² test at 0.1% for every choice of drawing and every count, and 4 standard errors for every spin, size and place. The engine's own picks are printed as `own var.`.

The thresholds were recalibrated with the M5 cases among the configurations (`npm run golden -- --calibrate`: 190 configurations × 3 re-keys plus the negative controls, against 142 in M4). The per-preset axis-ratio tolerances now cover `Hand-drawn arms` and `Stellar streams`, and at the zoom camera also `Ringed`, `Edge-on with dust`, `Radio jet` and `Shell galaxy`.

### Results (WebGPU against v21; the CPU engine gives the same numbers)

| case | ink | coarse SSIM | median | p90 | r50 | dots | knots | stars | rstars | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| barred-spiral s4242 home | 2.3% | 0.942 | 0.1% | 4.8% | 1.4% | 9368/9373 | 146/128 | 19/12 | 9/9 | pass |
| barred-spiral s4242 orbit | 2.2% | 0.946 | 0.7% | 3.4% | 2.0% | 9302/9309 | 144/132 | 20/11 | 9/9 | pass |
| barred-spiral s4242 zoom | 2.0% | 0.918 | 0.1% | 1.5% | 2.1% | 9368/9373 | 146/128 | 19/12 | 9/9 | pass |
| barred-spiral s7 home | 0.8% | 0.936 | 0.9% | 0.5% | 1.3% | 9567/9564 | 180/177 | 10/9 | 9/9 | pass |
| barred-spiral s7 orbit | 0.8% | 0.940 | 1.1% | 3.4% | -0.1% | 9517/9535 | 179/167 | 10/9 | 9/9 | pass |
| barred-spiral s7 zoom | 1.1% | 0.906 | 1.5% | 4.2% | 1.0% | 9567/9564 | 180/177 | 10/9 | 9/9 | pass |
| disc-no-arms s4242 home | 0.1% | 0.922 | 0.5% | 1.2% | 1.3% | 9472/9469 | 0/0 | 0/3 | 0/0 | pass |
| disc-no-arms s4242 orbit | 0.0% | 0.956 | 0.5% | 0.4% | 0.3% | 9472/9469 | 0/0 | 0/3 | 0/0 | pass |
| disc-no-arms s4242 zoom | -0.6% | 0.899 | 2.7% | 0.7% | -0.1% | 9472/9469 | 0/0 | 0/3 | 0/0 | FAIL axis ratio -0.0382 (±0.0370) |
| disc-no-arms s7 home | -0.7% | 0.919 | 1.6% | 1.0% | -0.1% | 9459/9442 | 0/0 | 0/1 | 0/0 | pass |
| disc-no-arms s7 orbit | -0.9% | 0.936 | 0.4% | 0.4% | -0.5% | 9459/9442 | 0/0 | 0/1 | 0/0 | pass |
| disc-no-arms s7 zoom | -0.5% | 0.899 | 0.1% | 1.0% | -1.4% | 9459/9442 | 0/0 | 0/1 | 0/0 | pass |
| edge-on-with-dust s4242 home | -1.0% | 0.963 | -0.9% | -5.1% | 2.1% | 3347/3377 | 71/87 | 3/1 | 0/0 | FAIL axis ratio 0.0278 (±0.0270) |
| edge-on-with-dust s4242 orbit | 1.5% | 0.954 | -1.2% | -0.2% | 0.1% | 5657/5695 | 105/83 | 13/13 | 0/0 | FAIL position angle 2.21° (±1.98°) |
| edge-on-with-dust s4242 zoom | -1.3% | 0.961 | -0.3% | -1.2% | 3.3% | 3347/3377 | 71/87 | 3/1 | 0/0 | pass |
| edge-on-with-dust s7 home | -0.7% | 0.968 | 0.0% | 2.4% | -4.2% | 3492/3484 | 119/137 | 8/3 | 0/0 | pass |
| edge-on-with-dust s7 orbit | 0.5% | 0.941 | 2.8% | 0.9% | 0.7% | 5922/5836 | 142/151 | 12/13 | 0/0 | FAIL axis ratio -0.0305 (±0.0270) |
| edge-on-with-dust s7 zoom | 1.5% | 0.963 | 1.3% | 11.3% | -4.1% | 3492/3484 | 119/137 | 8/3 | 0/0 | FAIL p90 width 11.30% (±10.00%) |
| hand-drawn-arms s4242 home | 0.3% | 0.936 | 0.4% | 1.5% | -0.1% | 9132/9133 | 152/187 | 19/23 | 0/0 | pass |
| hand-drawn-arms s4242 orbit | 0.6% | 0.937 | 1.2% | 1.7% | 0.3% | 9073/9080 | 151/187 | 19/25 | 0/0 | pass |
| hand-drawn-arms s4242 zoom | 0.5% | 0.922 | 0.1% | -0.7% | 2.7% | 9132/9133 | 152/187 | 19/23 | 0/0 | pass |
| hand-drawn-arms s7 home | 0.1% | 0.932 | 0.2% | -1.9% | 0.6% | 9245/9216 | 91/115 | 24/20 | 0/0 | pass |
| hand-drawn-arms s7 orbit | 0.2% | 0.939 | -0.4% | 1.4% | -2.3% | 9167/9135 | 91/114 | 25/17 | 0/0 | pass |
| hand-drawn-arms s7 zoom | 0.2% | 0.913 | 0.3% | -0.2% | 1.2% | 9245/9216 | 91/115 | 24/20 | 0/0 | pass |
| radio-jet s4242 home | 0.7% | 0.940 | -1.2% | 1.0% | -0.6% | 9500/9500 | 0/0 | 0/0 | 0/0 | pass |
| radio-jet s4242 orbit | 0.7% | 0.940 | -1.1% | 2.2% | -0.4% | 9500/9500 | 0/0 | 0/0 | 0/0 | pass |
| radio-jet s4242 zoom | 1.4% | 0.932 | -2.5% | 1.8% | -0.5% | 9500/9500 | 0/0 | 0/0 | 0/0 | pass |
| radio-jet s7 home | 1.2% | 0.945 | -0.5% | -1.0% | -1.2% | 9500/9500 | 0/0 | 0/0 | 0/0 | pass |
| radio-jet s7 orbit | 1.1% | 0.944 | -0.3% | -0.4% | -1.3% | 9500/9500 | 0/0 | 0/0 | 0/0 | pass |
| radio-jet s7 zoom | 1.8% | 0.937 | -0.8% | 0.3% | 1.0% | 9500/9500 | 0/0 | 0/0 | 0/0 | pass |
| ringed s4242 home | 1.3% | 0.921 | -1.8% | 1.1% | 0.9% | 9467/9460 | 69/47 | 13/5 | 15/15 | pass |
| ringed s4242 orbit | 2.5% | 0.946 | -1.4% | -0.2% | 2.3% | 9455/9459 | 69/47 | 13/5 | 15/15 | pass |
| ringed s4242 zoom | 0.7% | 0.916 | 4.3% | 3.8% | 1.4% | 9467/9460 | 69/47 | 13/5 | 15/15 | pass |
| ringed s7 home | 1.1% | 0.926 | -0.2% | 4.9% | 0.1% | 9498/9479 | 74/57 | 7/4 | 15/15 | pass |
| ringed s7 orbit | 1.8% | 0.934 | 0.3% | 1.7% | 1.4% | 9483/9463 | 74/57 | 7/4 | 15/15 | FAIL axis ratio -0.0332 (±0.0300) |
| ringed s7 zoom | 1.5% | 0.912 | 0.5% | 1.3% | 0.4% | 9498/9479 | 74/57 | 7/4 | 15/15 | pass |
| shell-galaxy s4242 home | 1.1% | 0.944 | -0.4% | 2.1% | -0.2% | 9000/9000 | 0/0 | 0/0 | 0/0 | pass |
| shell-galaxy s4242 orbit | 1.1% | 0.945 | 0.1% | 2.5% | 0.2% | 9000/9000 | 0/0 | 0/0 | 0/0 | pass |
| shell-galaxy s4242 zoom | 0.8% | 0.937 | 0.1% | 0.3% | 0.6% | 9000/9000 | 0/0 | 0/0 | 0/0 | pass |
| shell-galaxy s7 home | 0.9% | 0.946 | 1.7% | 0.9% | 0.1% | 9000/9000 | 0/0 | 0/0 | 0/0 | pass |
| shell-galaxy s7 orbit | 1.0% | 0.945 | 1.8% | 0.5% | -0.7% | 9000/9000 | 0/0 | 0/0 | 0/0 | pass |
| shell-galaxy s7 zoom | 1.6% | 0.937 | 1.2% | 1.6% | 0.5% | 9000/9000 | 0/0 | 0/0 | 0/0 | pass |
| stellar-streams s4242 home | 0.9% | 0.950 | -0.9% | -3.1% | 1.9% | 7000/7000 | 0/0 | 0/0 | 0/0 | pass |
| stellar-streams s4242 orbit | 1.1% | 0.951 | -0.5% | -2.7% | 2.2% | 7000/7000 | 0/0 | 0/0 | 0/0 | pass |
| stellar-streams s4242 zoom | -0.1% | 0.941 | -0.4% | -0.2% | 0.4% | 7000/7000 | 0/0 | 0/0 | 0/0 | pass |
| stellar-streams s7 home | 0.9% | 0.952 | 1.9% | 3.1% | 1.6% | 7000/7000 | 0/0 | 0/0 | 0/0 | pass |
| stellar-streams s7 orbit | 1.0% | 0.952 | 1.6% | 1.4% | 0.7% | 7000/7000 | 0/0 | 0/0 | 0/0 | pass |
| stellar-streams s7 zoom | 1.5% | 0.943 | -0.0% | 1.0% | 1.5% | 7000/7000 | 0/0 | 0/0 | 0/0 | pass |

**42 of the 48 M5 cases pass, and 117 of the 124 required cases in all.** The M2, M3 and M4 cases are unchanged: all 76 engine hashes are identical (test e). The one M4 failure (`Tightly wound` s4242 zoom, r50) is as M4 reported it.

Each of the six M5 failures is one moment measure just past its band; every other measure of the case passes:

| case | measure | v21 against the engine's draw | re-keyed (8 placement keys): mean, range | with the vector parts removed |
| --- | --- | --- | --- | --- |
| Disc, no arms s4242 zoom | axis ratio | −0.038 (±0.037) | −0.023, −0.045 to +0.001 | (the envelope is the only part) |
| Edge-on with dust s4242 home | axis ratio | +0.028 (±0.027) | +0.024, +0.011 to +0.043 | identical (no part is drawn) |
| Edge-on with dust s4242 orbit | position angle | 2.21° (±1.98°) | 1.56°, 0.39° to 2.63° | — |
| Edge-on with dust s7 orbit | axis ratio | −0.031 (±0.027) | −0.028, −0.046 to −0.013 | identical (mean −0.028) |
| Edge-on with dust s7 zoom | p90 width | +11.3% (±10%) | +8.2%, +4.6% to +12.3% | — |
| Ringed s7 orbit | axis ratio | −0.033 (±0.030) | −0.023, −0.042 to −0.006 | worse (mean −0.025) |

- These failures come from the stipple's re-draw scatter, not from the vector marks. Removing the parts leaves the measures where they are, and in four of the six cases the seed's own placement key sits at the edge of its re-keys' range. M4's review fixes compare against the mean of the re-keys; against that mean, five of the six pass.
- The one left is `Edge-on with dust` s7 orbit, which is about 0.001 past its band even as a mean. `Edge-on with dust` is new to the goldens: M2 and M4 never compared it. Its axis ratio within r90 is set by the edge-on stipple and the dust's optical depth, which M5 does not touch. It is reported as failing, not hidden by a looser band.

### CPU engine against WebGPU (L1)

- `npm run golden`, strict: all 124 cases pass. On the 48 M5 cases the worst differences are:
  - ink 0.0%;
  - coarse SSIM 1.000;
  - median and p90 width 0.1%;
  - identical counts.

  WebGPU rendered twice is bit-identical on every case (L0), and `engine-hashes.json` now holds the M5 cases.
- `npm run test:gpu`, vector kernels: every output of `vector-expand.wgsl` against its TypeScript twin, on 9 scenes × 3 cameras. That covers 96 placed drawings, 6,543 capsules, 462 dots, 54 blobs and 3,141 stream marks.
  - Max |Δ| is 1.8 × 10⁻⁴ px; it is 0 for unwarped drawings, and the rewind uses `log`.
  - Compaction keys, counts and drawings are identical.
  - The inked vector layers are within 0.00054 of the CPU raster (≤ 1/255).

### Pen weight

- **Width at three zooms** (`tests/unit/pen-weight.test.ts`, CPU engine, equal to WebGPU at L1). The lines of a whole drawing placed by the parts are measured as golden test (c) measures pen weight: the band median of the medial-axis widths of α ≥ 0.5, upsampled 4×.

  | drawing | zoom 0.5 | zoom 1 | zoom 3 |
  | --- | --- | --- | --- |
  | whole drawing, pen 2.4 (157 capsules) | 2.500 px | 2.500 px | 2.500 px |
  | whole drawing, pen 4 | 4.026 px | 4.016 px | 4.015 px |
  | rewound whole drawing (warped), pen 2.4 | 2.500 px | 2.500 px | 2.500 px |

  The width is PEN.line at every zoom, within the measure's 1/4-px resolution: 2.500 is the grid value next to 2.4. At zoom 3 the rewound drawing keeps 131 of its 308 densified pieces, because v21 drops warped segments longer than 22 px (v21 parity).
- **Ink per unit length against v21** (`tests/gpu/pen-ink.ts`). The same segments are drawn two ways on the same SwiftShader: as the engine's capsules (WebGPU), and as v21's own quads (0.9w overlap, alpha 1, WebGL2 with 4× MSAA, premultiplied). The measure is Σα per px of centreline:

  | drawings | half width | engine | v21 | difference |
  | --- | --- | --- | --- | --- |
  | whole drawings, 554 px, ps 1 | 1.2 px | 2.501 | 2.499 | +0.1% |
  | drawn arms, 380 px, ps 1 | 1.2 px | 2.495 | 2.496 | −0.0% |
  | whole drawings, 160 px, ps 1 | 1.2 px | 2.552 | 2.527 | +1.0% |
  | bubbles, 30 px, ps 0.6 | 0.72 px | 1.637 | 1.503 | +8.9% |
  | deep-field drawings, 60 px, ps 0.42 | 0.50 px | 1.184 | 1.069 | +10.8% |
  | hatches, 15 × 4 px, ps 0.38 | 0.46 px | 1.053 | 0.910 | +15.8% |

  - The test gates at ±10% where the pen is at least about a pixel wide (ps ≥ 0.6). The parts at ps 1 carry almost all of M5's line ink, and match v21 within 1%.
  - Below that width, the capsules' anti-aliased fringes add up over many short, overlapping segments, where v21's MSAA quads take only the union of the coverage. This is the excess M4's QA measured on the hatching: 18–41% in the lanes, where hatches also overlap each other.
  - The coverage model is one function per engine, `fs_capsule` in render/ribbon.wgsl and `rasteriseCapsules` in src/fallback/raster.ts. The hatching and every placed drawing share it; `vector-expand` writes only each capsule's ends and half width. M4's fix for sub-pixel pens therefore applies to the parts unchanged, and the gate can then extend to every pen scale.

## Not done, or left for later

- **Six M5 cases fail by a hair** (above). One of them, `Edge-on with dust` s7 orbit, fails even against a re-key mean.
- **Sub-pixel pen ink** (ps < 0.6: bubbles, the deep field's drawings, the hatching) is 9–16% heavier than v21's, pending M4's coverage decision.
- **Drawn stars and the sky are M7.** That covers the `sstars` sheet (the stipple's drawn stars, and the ring knots' and clumps' ones that are already counted) and the sky's parts (the deep field, foreground stars and companions).
- **Warps.** The rewind is built. The `post` hook is built and tested in the kernels, but nothing places it yet: merger tides are M8, and lens Jacobians and weak lensing are M9. v21's `screen` warp (`mWarp`) is M8.
- **The hatching keeps its M4 kernels** (`hatch_caps`, `hatch_dots` and `hatch_blobs` in ribbons.wgsl), whose frames come from projected anchor points on the GPU. It already shares the capsule pipeline, its coverage, and the dot and blob rules with `vector-expand`. Folding it into `vector-expand`'s instance table waits until M4's review fixes have landed, to keep this change additive.
- **The used-drawings count** is computed only by the CPU engine. It does not yet count the drawn stars or the carving lines' pen lines.
- **A ribbon level of detail** for tiny drawings (ADR 0006) is M10.

## Checks

| check | result |
| --- | --- |
| `npm run lint` (ESLint and Prettier) | clean |
| `npm run typecheck` | clean |
| `npm test` | 20 files, 251 tests pass |
| `npm run validate:wgsl` (naga) | 20 of 20 files valid |
| `npm run build` | builds (241.9 kB, 73.3 kB gzipped) |
| `npm run test:gpu` | 9 of 9 pass (vector kernels, pen ink, line-work bit-exact, stipple parity, tiers, surface, orbit) |
| `npm run golden` | 117 of 124 required cases pass (42 of 48 M5 cases); strict CPU = WebGPU on all 124; 12 of 12 drawn-star gates |
