# 41. A merging galaxy is built as a single galaxy and carried by its tides after its own kernels

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Extends [0009](0009-merger-integration-on-the-gpu.md) (accepted) and the `post` hook of M5.

## Context

v21 draws each merging galaxy exactly as a single galaxy (`mergerGalaxyParams`: face-on, its own seed and variation, `VIEW.scale` = `s0 = MS.sc · rmax / 4.2`) and carries it by the tides at the last moment: the screen map `SM` becomes `post ∘ SM` (app23.js:L1248), where `post` interpolates, bilinearly, a 49 × 49 grid of the tidal map `tidal(g)` over a square of `R2 = 2 · 4.2 · s0` plate px (L1241–1245). `SM` is applied to every bitmap mark's centre in `inst` (L171), to every ribbon vertex in `buildCurves` (L831), and, as `post`, to every vector drawing's points in `expandVector` (L1195). Ribbon segments are torn where the warp stretches them (SEAMMAX 30, and a ratio above 1.8 along or across, L832–834); warped vector segments are densified to 0.012 tile units and dropped past 22 px or a stretch above 1.8 (+ 0.8 of slack, L1202–1208).

Two ways to reproduce this: change every kernel of the single-galaxy engine to take a warp, or let those kernels run unchanged and carry their outputs.

## Decision

1. **The kernels stay as they are.** A merging galaxy is a `GalaxyScene` built by `buildScene` from `mergerGalaxyParams` and rendered by an ordinary `GpuStipple` or `CpuStipple` with its own camera (`cameraOf(P_g, s0/84)`). Its marks are then carried **in place**, by the passes of `compute/tide-apply.wgsl` (twin: `fallback/kernels/tide.ts`):
   - `warp_instances`: the centre of every sprite instance: the stipple's projected instances (between `project` and the compaction), the pieces, the cores, a drawn core's nuclear spiral;
   - `warp_ribbons`: the four corners of every ribbon segment, with v21's tears, by setting the segment's alpha to 0;
   - the vector drawings go through `vector-expand` as before, with two new warp kinds that put `tide_post` after the matrix (`tide`, with the drops of `post`) and `tide_nn`, the map itself on the drawing's raw coordinates (`tideScreen`, for `mWarp`).
2. **One buffer of words** (`tide: array<u32>`, floats as bits, binding 31 of every shader that imports `common/tide.wgsl`): a header, the stars' plate positions and initial disc coordinates, the bins, and both galaxies' grids. The bins (21 × 21 cells per galaxy, indices in index order within a cell) are built once per merger by counting and filling per cell, with no atomics; the grids once per view, one thread per vertex, scanning rings of cells until four stars are found and keeping the four smallest `(distance, index)`. v21 sorts the candidates and keeps the first four, so ties differ only by index. The count of storage buffers in `vector-expand`'s expand entry points reaches the default limit of 8.
3. **The hatching of a merging galaxy goes through the vector drawings.** The line-work's own hatching kernels make one capsule per pen-line segment, undensified: stretched 3× by the tides, a 10 px segment tears (ratio 2.8 against 1.8), where v21's pieces of 0.012 tile units pass individually (a stretched 1 px piece is 3 px against 1.8 px allowed). A stretched hatch is a long thin line in v21's tails, so the merging galaxies place their hatches as `penlines` rows with the `tide` warp (`hatchRows`, `hatch_frame` in f64) and the hatching kernels are switched off for them (`nCaps`, `nHDots`, `nHBlobs` are 0). The lanes and carving lines stay with the line-work (the stipple's culls read them).
4. **Order.** v21 applies the tide first and the hand wobble (`distort`) second; the single-galaxy kernels apply the wobble first. The merger presets leave `distort` at 0, and a merger with `distort` above 0 differs from v21 in the order of two smooth maps. Not reproduced.
5. **Verification against v21.** `mergerSprites` is cut out of app23.js and run on the engine's own initial conditions (`tests/unit/merger-view.test.ts`): at six views (home, orbit with zoom 1.5, `mTime` 0.5 and 1.5, an elliptical pair, a spiral and an elliptical) the framing `MS.sc` agrees to 10⁻³, and **100% of both galaxies' 49 × 49 grid vertices are within 0.5 px of v21's `tidal`, the worst 0.1 px**; the screen map of `mWarp` too. The GPU kernels are checked against their twin on synthetic stars (`tests/gpu/tide.ts`): the bins word for word, the grids to 1.8 × 10⁻⁴ px, the carrying of 6,000 instances, 3,000 ribbon segments and 3,000 capsules exactly, with the same tears.

## Consequences

- The single-galaxy engine did not change for mergers except in four small places: `vector-expand.wgsl` (two warp kinds), `describeVectors`/`vectorView` (optional arguments), `GpuStipple`/`CpuStipple` (a `setTide` hook and the carrying passes) and `GpuRibbons` (`encodeTide`).
- A galaxy's passes need the grids before they run: the merger's view tier orders its submits (marks and grids, then each galaxy's view, then `mWarp`).
- The drawn core of a merging galaxy is v21's `inst(L.cores, …)`, carried to the tide's centre. The comment in v21's render() says merging galaxies keep only their simulated bulge stars; its code draws the cores.
