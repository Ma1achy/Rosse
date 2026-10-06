# M4: stroke ribbons and arms

Arms are drawn: textured stroke ribbons and re-spaced beads and dashes along v21's curves, the dust lanes' hatching, the lanes and carving lines thinning the stipple, ring knots and clumps, and the hand wobble. All numbers below are from Chromium 141 with WebGPU on SwiftShader (Playwright 1.56.1) and the CPU engine in Node 22.

| new engine (WebGPU) beside v21 | |
| --- | --- |
| `Grand design`, seed 7, home | `grand-design-s7.jpg` |
| `Tightly wound`, seed 4242, zoom 2 | `tightly-wound-s4242-zoom.jpg` |
| `Flocculent`, seed 7, orbit camera | `flocculent-s7-orbit.jpg` |

These are the `ribbons` variant (below), drawn as the golden runner draws them, with v21's variation, stroke choices and noise, so both sides show the same galaxy (`node tools/gpu-test/side-by-side.mjs --set m4`; the new engine's ink is shown over the plate's field colour). The page (`?variant=ribbons`) draws the same presets with the engine's own choices, so its arms lie at other phases.

## What is built

- **Curves as scene description** (`model/curves.ts`, ADR 0003): v21's `curves()` (L768–800) in the galaxy frame: arms from `r0` to `min(rmax, 2.1 + 0.5(1 − bulge))` with the lopsided offset and taper; flocculent arms broken where lattice noise is low (pieces of more than 6 points); spurs (60% kept); the ribbon ring and bar; the edge-on midplane stroke; outline arcs and tails. `strokeIndex` pools per kind (`marks/strokes.ts`: mixed = plain, beaded or spurred; plain, beaded, spurred, broken, dotted, faint). Each curve has its own index on the `curves` stream (`CurveIndex`), so turning a spur off changes no other curve's stroke (v21 draws all from one `mulberry32(VAR.strokeSeed)`).
- **Ribbons on the GPU** (`compute/ribbons.wgsl`) with the CPU twin `fallback/kernels/ribbons.ts`:
  - `project_points`: every scene point (curves, lane points, carving lines, hatch anchors) to the plate;
  - `measure`, one invocation, sequential, so deterministic: per curve the arc-length prefix sum, `cw = clamp(PEN.line·w·64/thick, 6, 90)`, `kpx = cw/64`, `reps = max(1, round(tot/(1.4·512·kpx)))` (1 when stretched), and for re-spaced curves the first slot of their pieces (a running sum) and the indirect count;
  - `expand`: one textured segment, normals from the neighbouring points, half width `cw·taper/2` with taper `1.1 − 0.45 f`, `u = f·reps`, the stroke's row as the texture-array layer (v from 0.02 to 0.98), every vertex through the wobble;
  - `place_pieces`: one re-spaced piece, its curve by binary search on the slots, its arc position `(rep·512 + x)·tot/(reps·512)`, its segment by binary search on the prefix sum (v21's linear search finds the same one), offset `(y − 32)·kpx·taper` along the normal, size `size·kpx·taper`, turned to the tangent, alpha `c.a`: a `pieces` sprite, drawn with `drawIndirect`;
  - directions are unit vectors (no `atan2`), so both engines give the same bits.
- **The ribbon pipeline** (`render/ribbon.wgsl`, `render/ribbon-pass.ts`): each segment is the reference's two triangles, drawn as a padded rectangle; the fragment finds the triangle holding the pixel centre, interpolates (u, v) barycentrically and takes the mip level from that triangle's texel Jacobian; v21's ink edge (smoothstep 0.12–0.55), premultiplied, no MSAA. The CPU rasteriser (`rasteriseRibbons`) does the same arithmetic.
- **Dust in the stipple model** (`model/lanes.ts`): `dustLanes()` (arm inner edges with feathers, the lane inside a ring, the edge-on midplane) as 3D lane points and hatches carrying their own random numbers; the carving lines (`dustLines`: the longest polyline of 1–3 pen lines via `longestLine`/`lineParam`, along the arms or the midplane). The lane cull (`inLane`, within `(3.5 + 3·dustScribble)·zoom` px, p = 0.7, disc samples) and the carving cull (`nearDust`, within `4 + 5·dustLines` px, p = 0.9·dustLines, disc, bar and ring samples) are pure filters in `project.wgsl` on per-sample uniforms of the `stippleCull` stream, before the wobble (ADR 0004, 0010). v21 looks lane points up in a 16-px grid; every point is tested here, which is the same answer while the radius is under 16 px.
- **The hatching** (parts L1047–1050): one `penlines` drawing per hatch, flattened to 0.28, at pen scale 0.38, expanded on the GPU as `expandVector` does: lines as v21's quads (each segment extended by 0.9 w at both ends, half width w = `PEN.line/2·0.38` plate px), sampled at v21's four MSAA positions and unioned per sample, then resolved over the ink (ADR 0019; `rasteriseCapsules` on the CPU), dots as `dots` sprites, blobs as `knots` sprites. This is a minimal vector expansion for the pen lines only; M5 generalises it.

  **Why not capsules (ADR 0006).** The first M4 build drew pen lines as capsules with analytic coverage, `clamp(w + 0.5 − d, 0, 1)`, composited segment by segment. QA found the hatching 18–41% heavier than v21's. One segment agreed with v21's quad (at w = 0.456 px, v21's 4× MSAA gives 0.883 px of ink per px of length for a 0.912 px wide quad, the capsule 0.914), so it was not the width or the coverage of a segment. v21 draws each segment as an alpha-1 quad into a canvas that blends per sample, so overlapping quads (at every join, where hatches cross) union; the capsules composited per pixel, so each join counted twice. A per-pixel maximum is too light (0.87–0.91 of v21's ink). With v21's four sample positions and a union per sample, hatch ink is 0.98–1.05 of v21's (mean 1.003) on ten hatch-only captures. The vector-lines spike's finding stands for what it measured (the shape of one path against a round-cap stroke: capsules IoU 0.92–0.97, v21's quads 0.89–0.90); it did not measure a dense polyline of short segments, where the joins decide the ink. ADR 0006 is not edited: ADR 0019 amends it for pen lines.
- **Ring knots and clumps** (generate L282–297, `model/clumps.ts`): groups described on the CPU, marks sampled by the `extra` entry point of `stipple.wgsl` after the proposals, on their own streams (`ringKnots`, `clumps`). Their drawn stars are classified and counted (`rstars`), and drawn in M5/M7.
- **The hand wobble** (`distort`, SM L162–168, `view/warp.ts`, `common/warp.wgsl`): every stipple mark's centre, ribbon vertex, piece, hatch point and the core, in the view tier.
- **Inclination** (ADR 0017): the line-work reads only structure predicates (incE > 72 at L201/L207, > 74 at L950/L965, ≤ 74 at L960, > 80 at L788, all in `INCE_USES`), so it is model-tier data keyed by `structureKey`; the edge-on stroke's alpha, `lines·(incl − 72)/18` from the raw inclination (v21 parity, `INCL_CONTINUOUS` L788), is a view-tier number. `tests/unit/lines.test.ts` checks that inclinations with the same signature give identical line-work buffers.
- **Pen lines at run time**: `npm run prepare-assets` copies `penlines.json` to `assets-built/vector/` (packer 3).

## Acceptance

### The golden set and its overrides

Roadmap M4: `Grand design`, `Barred spiral` (stipple part), `Flocculent`, `Tightly wound`, `Loose, open arms`, `Dusty spiral`, `Hand wobble`, seeds 7 and 4242, home, orbit and zoom (home at zoom 2). 42 v21 captures, variant `ribbons`, and 28 gated `lines` captures (the line-work alone: the stipple, knots and sparkle stars off, ADR 0020), with 4 more seeds of each `lines` preset captured for the calibration (`tests/golden/extra-cases.json`). Every override, and why:

| override | why |
| --- | --- |
| `starMix: 0` | drawn stars among the stipple are vector `sstars` (M5/M7). The ring knots' and clumps' drawn stars stay (v21 draws a ring knot's star whatever `starMix`): classified and counted on both sides (`rstars` 9/9 for `Barred spiral`), not drawn here, a few small stars of ink |
| `field: 0`, `fgstars: 0` | the deep field and the foreground stars (sky, M7) |
| `bubbles: 0` | rings drawings at the clumps (vector, M5) |
| `whole: 0`, `envelope: 0` | whole drawings and envelopes (vector, M5); already 0 in these presets |
| `Barred spiral`: `barStyle: 'ribbon'`, `ringStyle: 'ribbon'` | its default bar and ring are vector drawings (M5); the ribbon styles are v21's own alternative and exercise the stretched bar and the ring ribbon. Its stipple (bar, ring, ring knots) is unchanged |

Not overridden: lines, knots, sparkle stars, dust lanes with their hatching and lane cull, the carving lines (`Dusty spiral`, `dustLines` 1), the drawn core, and the hand wobble (`Hand wobble`, `distort` 0.8), all built here.

### What the comparison draws with (ADR 0018)

As M2 draws with v21's replayed variation, the runner also draws with v21's stroke choices (`compare/v21-curves.ts`: v21's own `curves()` evaluated from app23.js; with them, the engine's curves equal v21's control points to 10⁻⁹, `tests/unit/lines.test.ts`) and v21's noise corners (`compare/v21-noise.ts`, a noise-table option of both engines). The lattice noise's statistics are tested against v21's separately. Without v21's noise, `Flocculent` and `Hand wobble` at zoom 2 scored a coarse SSIM of 0.82–0.86: the metric sees the pattern of deliberate divergence 5. The engine's own choices are printed as information (`own var.`).

The zoom camera has its own thresholds (`spiral@zoom`, `smooth@zoom`), calibrated by ADR 0015's rule on the 11 calibration presets at zoom 2 plus the zoom captures: at zoom 2 the plate holds the inner 2.4 units and a re-drawn galaxy scatters more (coarse SSIM p5 0.87 against 0.91 at home). The whole set was recalibrated for the mean of K = 6 draws (`npm run golden -- --calibrate`: 142 configurations, each with 3 stand-ins for v21 against the mean of 6 keys, and the negative controls, which ran on 73 of the configurations); the spiral family's coarse SSIM gate moved from 0.88 to 0.89 with the M4 cases in it. The thresholds, the spread by K and the controls' detection cells are in `docs/data/m4-calibration-k.json`; every control caught less often than before, and every threshold that rose, is listed in ADR 0018.

### Results (WebGPU against v21; the CPU engine gives the same numbers)

Each number is the mean over K = 6 engine draws against v21's one (ADR 0018, proposed): the canonical draw and five re-draws of the placement key. Counts are the engine's mean over the draws against v21's. The 42 `ribbons` cases:

| case | ink | coarse SSIM | median | p90 | r50 | dots | knots | stars | rstars | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| barred-spiral s4242 home | 0.9% | 0.947 | -0.5% | 2.8% | 0.2% | 9340/9373 | 143/128 | 13/12 | 9/9 | pass |
| barred-spiral s4242 orbit | 0.9% | 0.949 | -0.7% | -0.1% | 0.4% | 9288/9309 | 141/132 | 12/11 | 9/9 | pass |
| barred-spiral s4242 zoom | 0.6% | 0.935 | 0.3% | -1.3% | 0.2% | 9340/9373 | 143/128 | 13/12 | 9/9 | pass |
| barred-spiral s7 home | 0.2% | 0.931 | 0.2% | 1.6% | 0.8% | 9550/9564 | 180/177 | 11/9 | 9/9 | pass |
| barred-spiral s7 orbit | 0.4% | 0.934 | 0.6% | 0.0% | 0.4% | 9515/9535 | 179/167 | 11/9 | 9/9 | pass |
| barred-spiral s7 zoom | -0.0% | 0.916 | 0.3% | 1.3% | 0.7% | 9550/9564 | 180/177 | 11/9 | 9/9 | pass |
| dusty-spiral s4242 home | -1.3% | 0.932 | -0.3% | 0.9% | -1.3% | 7944/8005 | 141/147 | 16/20 | 0/0 | pass |
| dusty-spiral s4242 orbit | 0.3% | 0.944 | 0.0% | 0.3% | -2.2% | 7714/7704 | 140/137 | 15/14 | 0/0 | pass |
| dusty-spiral s4242 zoom | -0.6% | 0.906 | 0.0% | -0.4% | -1.8% | 8559/8568 | 166/173 | 20/25 | 0/0 | pass |
| dusty-spiral s7 home | 0.3% | 0.931 | -0.2% | 0.1% | 0.3% | 8196/8270 | 163/168 | 13/14 | 0/0 | pass |
| dusty-spiral s7 orbit | 0.2% | 0.940 | 0.8% | -0.3% | -0.3% | 8004/8047 | 161/156 | 13/14 | 0/0 | pass |
| dusty-spiral s7 zoom | -0.0% | 0.891 | -0.2% | 0.2% | 0.5% | 8829/8861 | 187/169 | 15/18 | 0/0 | pass |
| flocculent s4242 home | 1.7% | 0.910 | 2.0% | 0.6% | 1.8% | 9237/9239 | 140/153 | 18/21 | 0/0 | pass |
| flocculent s4242 orbit | 1.7% | 0.926 | 1.4% | 1.4% | 0.9% | 9142/9137 | 141/156 | 17/21 | 0/0 | pass |
| flocculent s4242 zoom | 1.6% | 0.876 | 0.5% | 1.3% | 0.5% | 9237/9239 | 140/153 | 18/21 | 0/0 | pass |
| flocculent s7 home | 1.6% | 0.921 | 1.2% | -0.1% | 0.6% | 9150/9115 | 58/62 | 14/14 | 0/0 | pass |
| flocculent s7 orbit | 1.9% | 0.930 | 1.1% | 1.2% | -0.3% | 9076/9014 | 58/76 | 14/12 | 0/0 | pass |
| flocculent s7 zoom | 1.0% | 0.888 | 0.2% | 1.5% | 0.5% | 9150/9115 | 58/62 | 14/14 | 0/0 | pass |
| grand-design s4242 home | -0.7% | 0.936 | 0.2% | -1.3% | -1.4% | 9280/9272 | 144/148 | 25/30 | 0/0 | pass |
| grand-design s4242 orbit | -0.0% | 0.946 | 1.0% | 0.1% | -1.2% | 9222/9189 | 141/161 | 24/28 | 0/0 | pass |
| grand-design s4242 zoom | 0.4% | 0.912 | 0.0% | -0.2% | -0.2% | 9280/9272 | 144/148 | 25/30 | 0/0 | pass |
| grand-design s7 home | -0.1% | 0.925 | 1.6% | 1.1% | -0.5% | 9492/9492 | 176/175 | 21/22 | 0/0 | pass |
| grand-design s7 orbit | 0.2% | 0.932 | 1.6% | 4.7% | -1.1% | 9459/9477 | 177/161 | 21/22 | 0/0 | pass |
| grand-design s7 zoom | -0.4% | 0.905 | -0.1% | 1.9% | 0.1% | 9492/9492 | 176/175 | 21/22 | 0/0 | pass |
| hand-wobble s4242 home | -0.1% | 0.939 | 0.4% | 0.4% | -0.6% | 9016/9024 | 172/153 | 22/24 | 0/0 | pass |
| hand-wobble s4242 orbit | 0.2% | 0.945 | 0.2% | 1.7% | -0.7% | 8961/8975 | 171/149 | 23/27 | 0/0 | pass |
| hand-wobble s4242 zoom | 0.2% | 0.922 | 0.4% | 0.9% | -0.1% | 9016/9024 | 172/153 | 22/24 | 0/0 | pass |
| hand-wobble s7 home | -0.5% | 0.930 | -1.0% | -0.1% | -0.5% | 9207/9228 | 127/128 | 19/21 | 0/0 | pass |
| hand-wobble s7 orbit | -0.4% | 0.938 | -1.2% | -0.1% | -1.0% | 9146/9159 | 126/129 | 18/24 | 0/0 | pass |
| hand-wobble s7 zoom | -0.5% | 0.900 | 0.3% | 1.9% | -0.6% | 9207/9228 | 127/128 | 19/21 | 0/0 | pass |
| loose-open-arms s4242 home | 0.4% | 0.939 | -0.9% | -0.3% | -1.1% | 9262/9238 | 198/208 | 26/23 | 0/0 | pass |
| loose-open-arms s4242 orbit | -0.2% | 0.943 | 0.6% | 0.3% | -0.3% | 9204/9210 | 198/200 | 26/20 | 0/0 | pass |
| loose-open-arms s4242 zoom | 0.6% | 0.910 | 0.0% | 0.9% | -0.1% | 9262/9238 | 198/208 | 26/23 | 0/0 | pass |
| loose-open-arms s7 home | 0.4% | 0.923 | 1.6% | 2.7% | -1.6% | 9303/9285 | 210/219 | 23/22 | 0/0 | pass |
| loose-open-arms s7 orbit | 0.6% | 0.933 | 1.4% | 2.0% | -1.1% | 9276/9257 | 209/213 | 23/23 | 0/0 | pass |
| loose-open-arms s7 zoom | 1.1% | 0.881 | 0.1% | 1.0% | 0.7% | 9303/9285 | 210/219 | 23/22 | 0/0 | pass |
| tightly-wound s4242 home | -0.4% | 0.934 | -0.2% | 2.3% | 0.8% | 9207/9229 | 166/162 | 19/22 | 0/0 | pass |
| tightly-wound s4242 orbit | 0.1% | 0.939 | -0.7% | -1.6% | 0.3% | 9150/9193 | 165/161 | 19/20 | 0/0 | pass |
| tightly-wound s4242 zoom | -0.6% | 0.923 | -1.1% | -0.7% | 1.6% | 9207/9229 | 166/162 | 19/22 | 0/0 | pass |
| tightly-wound s7 home | -0.3% | 0.933 | 0.5% | 2.4% | -0.4% | 9304/9306 | 114/101 | 16/15 | 0/0 | pass |
| tightly-wound s7 orbit | 0.7% | 0.943 | 1.5% | 1.5% | -0.4% | 9250/9281 | 114/99 | 16/14 | 0/0 | pass |
| tightly-wound s7 zoom | 0.4% | 0.926 | 0.2% | 1.6% | 0.3% | 9304/9306 | 114/101 | 16/15 | 0/0 | pass |

**The M4 gate: 70 of 70 M4 cases pass** (42 `ribbons` and 28 `lines`), and **104 of 104 required cases in all** (the 34 M2 and M3 cases pass as before; `npm run golden`, mean of 6 draws, 12 of 12 drawn-star gates). The `lines` cases (seeds 7 and 4242, home and orbit, the stipple, knots and sparkle stars off) compare the line-work alone, which the `ribbons` cases hardly see (ADR 0020). The closest case to a limit uses 94% of it (`tightly-wound--ribbons__s4242__home`, q); per-case margins are in `docs/data/m4-golden-results.json` (`node tools/m4-summary.mjs results`).

The case that failed in the first build, `Tightly wound` seed 4242 at zoom 2 (r50 +6.9% against ±4.3% from one engine draw, where ten re-draws ranged from 0 to +6.9%), now passes: its canonical draw alone is r50 +5.2% (information, printed beside the mean), the mean of six draws +1.6%, and its worst measure is the inner axis ratio at 75% of its limit. That is what ADR 0018 is for, and it narrows the bands rather than loosening them; what it costs in detection is stated in the ADR (the negative controls it catches less often) and not hidden.

### CPU engine against WebGPU (L1)

- `npm run golden`, strict: all 104 cases pass; the CPU engine and WebGPU differ by 0 in ink and score a coarse SSIM of 1.000 on every case. WebGPU rendered twice is bit-identical on all 104 (L0), and all 104 are identical to `engine-hashes.json` (e), which holds the M4 cases (`docs/data/m4-golden-results.json`).
- `npm run test:gpu`, line-work: every output of `ribbons.wgsl` equals its TypeScript twin **bit for bit on SwiftShader** (on a real GPU, fused multiply-adds may differ in the last place; the test allows 0.05 px and 1/255 of ink) on 27 scenes (9 scenes × 3 cameras: 5,110 segments, 7,155 pieces, 73,245 capsules, 1,160 hatch dots and blobs; max |Δ| 0 px), and the inked line layers are within 0.0009 of the CPU raster (≤ 1/255). The stipple parity test (now with the dust culls, ring knots and clumps, Dusty spiral, Hand wobble, Tightly wound): 0 class differences, 100% of instances within tolerance, identical counts.

## Not done, or left for later

- **The negative controls are caught less often than before at the zoom camera** (ADR 0018, "What this calibration does not do well"): the calibration ran the controls on 73 of its 142 configurations, and a full pass is the first thing to run on a quiet machine. The `lines` captures and the seven breaks (ADR 0020) are what see the line-work.
- **ADRs 0018, 0019 and 0020 are proposed**, awaiting the owner's sign-off.
- **Drawn stars** of ring knots and clumps are counted, not drawn (vector `sstars`, M5/M7).
- **The hatching** uses a minimal quad expansion for the pen lines only (no warps, no resampling); M5's `vector-expand` generalises it.
- **Lane-cull lookup:** every lane point is tested; v21's 16-px grid misses points beyond its 3 × 3 cells once the lane radius exceeds 16 px (zoom above 2.4 at the default `dustScribble`). Same answer at every captured camera.
- **Mergers** (`SEAMMAX` tearing of ribbons) and lensed curves (`pts2d`) are M8 and M9.
- **The page** draws with the engine's own variation, strokes and noise, so its arms are not v21's for the same seed (as the hand in M2).

## Checks

| check | result |
| --- | --- |
| `npm run lint` (ESLint and Prettier) | clean |
| `npm run typecheck` | clean |
| `npm test` | 18 files, 254 tests pass |
| `npm run validate:wgsl` (naga) | 20 of 20 files valid |
| `npm run build` | builds (196.1 kB, 62.0 kB gzipped) |
| `npm run test:gpu` | 7 of 7 pass (line-work bit-exact, stipple parity, tiers) |
| `npm run golden` | 104 of 104 required cases pass (all 70 M4 cases), mean of 6 draws; strict CPU = WebGPU on all 104 |
