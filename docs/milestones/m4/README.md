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

Roadmap M4: `Grand design`, `Barred spiral` (stipple part), `Flocculent`, `Tightly wound`, `Loose, open arms`, `Dusty spiral`, `Hand wobble`, seeds 7 and 4242, home, orbit and zoom (home at zoom 2). 42 v21 captures, variant `ribbons` (`tests/golden/extra-cases.json`). Every override, and why:

| override | why |
| --- | --- |
| `starMix: 0` | drawn stars among the stipple are vector `sstars` (M5/M7). The ring knots' and clumps' drawn stars stay (v21 draws a ring knot's star whatever `starMix`): classified and counted on both sides (`rstars` 9/9 for `Barred spiral`), not drawn here, a few small stars of ink |
| `field: 0`, `fgstars: 0` | the deep field and the foreground stars (sky, M7) |
| `bubbles: 0` | rings drawings at the clumps (vector, M5) |
| `whole: 0`, `envelope: 0` | whole drawings and envelopes (vector, M5); already 0 in these presets |
| `Barred spiral`: `barStyle: 'ribbon'`, `ringStyle: 'ribbon'` | its default bar and ring are vector drawings (M5); the ribbon styles are v21's own alternative and exercise the stretched bar and the ring ribbon. Its stipple (bar, ring, ring knots) is unchanged |

Not overridden: lines, knots, sparkle stars, dust lanes with their hatching and lane cull, the carving lines (`Dusty spiral`, `dustLines` 1), the drawn core, and the hand wobble (`Hand wobble`, `distort` 0.8), all built here.

### What the comparison draws with (ADR 0015, M4 addendum)

As M2 draws with v21's replayed variation, the runner also draws with v21's stroke choices (`compare/v21-curves.ts`: v21's own `curves()` evaluated from app23.js; with them, the engine's curves equal v21's control points to 10⁻⁹, `tests/unit/lines.test.ts`) and v21's noise corners (`compare/v21-noise.ts`, a noise-table option of both engines). The lattice noise's statistics are tested against v21's separately. Without v21's noise, `Flocculent` and `Hand wobble` at zoom 2 scored a coarse SSIM of 0.82–0.86: the metric sees the pattern of deliberate divergence 5. The engine's own choices are printed as information (`own var.`).

The zoom camera has its own thresholds (`spiral@zoom`, `smooth@zoom`), calibrated by ADR 0015's rule on the 11 calibration presets at zoom 2 plus the zoom captures: at zoom 2 the plate holds the inner 2.4 units and a re-drawn galaxy scatters more (coarse SSIM p5 0.87 against 0.91 at home). The whole set was recalibrated (`npm run golden -- --calibrate`, 142 configurations × 3 re-keys plus the negative controls); the spiral family's coarse SSIM gate moved from 0.88 to 0.89 with the M4 cases in it.

### Results (WebGPU against v21; the CPU engine gives the same numbers)

| case | ink | coarse SSIM | median | p90 | r50 | dots | knots | stars | rstars | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| barred-spiral s4242 home | 1.9% | 0.941 | -0.4% | 5.6% | 1.3% | 9368/9373 | 146/128 | 19/12 | 9/9 | pass |
| barred-spiral s4242 orbit | 2.1% | 0.946 | 0.0% | 3.7% | 1.7% | 9302/9309 | 144/132 | 20/11 | 9/9 | pass |
| barred-spiral s4242 zoom | 1.9% | 0.917 | 1.2% | 2.1% | 1.8% | 9368/9373 | 146/128 | 19/12 | 9/9 | pass |
| barred-spiral s7 home | 0.7% | 0.936 | 0.3% | 1.0% | 1.2% | 9567/9564 | 180/177 | 10/9 | 9/9 | pass |
| barred-spiral s7 orbit | 0.8% | 0.940 | 1.5% | 3.7% | -0.1% | 9517/9535 | 179/167 | 10/9 | 9/9 | pass |
| barred-spiral s7 zoom | 1.1% | 0.905 | 1.5% | 3.9% | 0.9% | 9567/9564 | 180/177 | 10/9 | 9/9 | pass |
| dusty-spiral s4242 home | -0.8% | 0.908 | -0.8% | -1.1% | -0.3% | 7968/8005 | 135/147 | 10/20 | 0/0 | pass |
| dusty-spiral s4242 orbit | 1.7% | 0.924 | -0.9% | -1.6% | -2.6% | 7751/7704 | 135/137 | 10/14 | 0/0 | pass |
| dusty-spiral s4242 zoom | -1.8% | 0.883 | 0.0% | -0.7% | 0.5% | 8565/8568 | 152/173 | 10/25 | 0/0 | pass |
| dusty-spiral s7 home | 0.7% | 0.923 | -0.0% | -0.7% | -1.6% | 8249/8270 | 164/168 | 12/14 | 0/0 | pass |
| dusty-spiral s7 orbit | 0.9% | 0.939 | 1.5% | -0.3% | -0.9% | 8063/8047 | 162/156 | 11/14 | 0/0 | pass |
| dusty-spiral s7 zoom | 0.1% | 0.864 | 0.6% | 2.2% | 1.2% | 8856/8861 | 182/169 | 13/18 | 0/0 | pass |
| flocculent s4242 home | 1.1% | 0.911 | 1.7% | 0.3% | 1.8% | 9226/9239 | 131/153 | 13/21 | 0/0 | pass |
| flocculent s4242 orbit | 1.2% | 0.919 | 1.2% | -0.5% | 1.4% | 9127/9137 | 129/156 | 13/21 | 0/0 | pass |
| flocculent s4242 zoom | 1.8% | 0.871 | 0.7% | 1.7% | 1.1% | 9226/9239 | 131/153 | 13/21 | 0/0 | pass |
| flocculent s7 home | 3.2% | 0.920 | 2.1% | 1.6% | -0.1% | 9194/9115 | 54/62 | 17/14 | 0/0 | pass |
| flocculent s7 orbit | 3.5% | 0.936 | 2.5% | 4.7% | -0.8% | 9121/9014 | 53/76 | 17/12 | 0/0 | pass |
| flocculent s7 zoom | 4.5% | 0.864 | 1.2% | 3.4% | 0.7% | 9194/9115 | 54/62 | 17/14 | 0/0 | pass |
| grand-design s4242 home | 0.5% | 0.932 | 0.1% | -1.4% | 0.2% | 9295/9272 | 132/148 | 25/30 | 0/0 | pass |
| grand-design s4242 orbit | 0.7% | 0.943 | 1.0% | -1.9% | 0.2% | 9228/9189 | 130/161 | 24/28 | 0/0 | pass |
| grand-design s4242 zoom | 1.2% | 0.905 | 0.0% | -0.6% | 2.2% | 9295/9272 | 132/148 | 25/30 | 0/0 | pass |
| grand-design s7 home | 0.6% | 0.927 | 2.2% | -0.5% | -0.7% | 9501/9492 | 177/175 | 19/22 | 0/0 | pass |
| grand-design s7 orbit | 1.0% | 0.935 | 1.8% | 6.1% | -1.7% | 9482/9477 | 177/161 | 20/22 | 0/0 | pass |
| grand-design s7 zoom | 0.7% | 0.905 | 0.5% | 3.3% | 0.0% | 9501/9492 | 177/175 | 19/22 | 0/0 | pass |
| hand-wobble s4242 home | 0.1% | 0.933 | -0.1% | -0.1% | -0.1% | 9023/9024 | 157/153 | 23/24 | 0/0 | pass |
| hand-wobble s4242 orbit | 0.5% | 0.940 | 0.1% | 1.0% | -0.2% | 8983/8975 | 153/149 | 23/27 | 0/0 | pass |
| hand-wobble s4242 zoom | 1.6% | 0.915 | 0.4% | 2.2% | 2.1% | 9023/9024 | 157/153 | 23/24 | 0/0 | pass |
| hand-wobble s7 home | 0.3% | 0.938 | 0.3% | 0.1% | 0.3% | 9210/9228 | 103/128 | 19/21 | 0/0 | pass |
| hand-wobble s7 orbit | 0.3% | 0.942 | -0.6% | -1.3% | -1.1% | 9146/9159 | 104/129 | 19/24 | 0/0 | pass |
| hand-wobble s7 zoom | -0.5% | 0.894 | 0.7% | 3.7% | 0.2% | 9210/9228 | 103/128 | 19/21 | 0/0 | pass |
| loose-open-arms s4242 home | 0.4% | 0.932 | -1.1% | -0.4% | 0.3% | 9289/9238 | 183/208 | 25/23 | 0/0 | pass |
| loose-open-arms s4242 orbit | 0.2% | 0.938 | 1.3% | 0.0% | 0.9% | 9231/9210 | 181/200 | 26/20 | 0/0 | pass |
| loose-open-arms s4242 zoom | 0.9% | 0.910 | 0.2% | 1.6% | 1.9% | 9289/9238 | 183/208 | 25/23 | 0/0 | pass |
| loose-open-arms s7 home | 1.3% | 0.917 | 3.3% | 2.6% | -2.5% | 9330/9285 | 217/219 | 25/22 | 0/0 | pass |
| loose-open-arms s7 orbit | 1.4% | 0.932 | 2.3% | 3.3% | -1.7% | 9311/9257 | 216/213 | 25/23 | 0/0 | pass |
| loose-open-arms s7 zoom | 2.8% | 0.880 | 0.3% | 2.1% | 1.0% | 9330/9285 | 217/219 | 25/22 | 0/0 | pass |
| tightly-wound s4242 home | 0.3% | 0.928 | -0.4% | 2.4% | 3.1% | 9244/9229 | 142/162 | 18/22 | 0/0 | pass |
| tightly-wound s4242 orbit | 1.4% | 0.939 | -1.6% | -0.4% | 2.6% | 9190/9193 | 141/161 | 18/20 | 0/0 | pass |
| tightly-wound s4242 zoom | -0.2% | 0.914 | 0.0% | 0.4% | 6.9% | 9244/9229 | 142/162 | 18/22 | 0/0 | FAIL r50 6.86% (±4.30%) |
| tightly-wound s7 home | 0.8% | 0.931 | 0.8% | 5.3% | 0.0% | 9308/9306 | 114/101 | 20/15 | 0/0 | pass |
| tightly-wound s7 orbit | 1.4% | 0.943 | 2.8% | 2.7% | -0.3% | 9233/9281 | 117/99 | 20/14 | 0/0 | pass |
| tightly-wound s7 zoom | 2.0% | 0.916 | 0.8% | 4.5% | 1.7% | 9308/9306 | 114/101 | 20/15 | 0/0 | pass |

**41/42 M4 cases pass; 75/76 required cases in all** (the M2 and M3 cases are unchanged: their engine hashes are identical). The one failure:

- **`Tightly wound` seed 4242, zoom 2: r50 +6.9% against ±4.3%.** Everything else of the case passes (coarse SSIM 0.914, ink −0.2%, widths, counts). It is the engine's draw, not its structure: the same configuration re-drawn with 10 placement keys gives r50 between −0.0% and +6.9% against v21 (mean +3.3%), and the seed's own key is the extreme of the ten (it is also the one with the fewest knots, 142 against 149–177). The radial ink profile against the mean of six re-draws is within ±4% everywhere inside the plate (centre −3.7%). The calibrated band (1.5 × p95 of re-draw pairs over the family) is narrower than this configuration's own scatter. ADR 0015's future work (comparing against the mean of K re-keys) would remove such single-draw outliers; it is not implemented, and the case is reported as failing rather than hidden by a looser band.

### CPU engine against WebGPU (L1)

- `npm run golden`, strict: all 76 cases pass; on the 42 M4 cases the worst differences are ink 0.002%, coarse SSIM 1.000, median width 0.02%, p90 0.08%, identical counts. WebGPU rendered twice is bit-identical on every case (L0); the M2 and M3 cases are identical to their engine hashes (e), and `engine-hashes.json` now holds the M4 cases.
- `npm run test:gpu`, line-work: every output of `ribbons.wgsl` equals its TypeScript twin **bit for bit on SwiftShader** (on a real GPU, fused multiply-adds may differ in the last place; the test allows 0.05 px and 1/255 of ink) on 9 scenes × 3 cameras (4,630 segments, 7,038 pieces, 76,597 capsules, 1,433 hatch dots and blobs; max |Δ| 0 px), and the inked line layers are within 0.0009 of the CPU raster (≤ 1/255). The stipple parity test (now with the dust culls, ring knots and clumps, Dusty spiral, Hand wobble, Tightly wound): 0 class differences, 100% of instances within tolerance, identical counts.

## Not done, or left for later

- **One golden case fails** (above).
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
| `npm test` | 17 files, 177 tests pass |
| `npm run validate:wgsl` (naga) | 20 of 20 files valid |
| `npm run build` | builds (191.8 kB, 60.4 kB gzipped) |
| `npm run test:gpu` | 7 of 7 pass (line-work bit-exact, stipple parity, tiers) |
| `npm run golden` | 75 of 76 required cases pass (41 of 42 M4 cases); strict CPU = WebGPU on all 76 |
