# 50. The lens: one table of marks, slots per image, a scan per class, and an explicit home

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off on the explicit home (open question Q3, option b). The rest builds on [0008](0008-lens-solver-on-the-gpu.md), which it refines and does not replace.

## Context

ADR 0008 fixed the shape of the lens: a grid, bins with sorted ids, queries and emission, with the home orientation as explicit state. Building it (M9) settled what 0008 left open:

- **What a "mark" is.** v21 lenses a source galaxy as lists of rows: stipple sprites, drawn cores, whole vector drawings, and curves (`lensMarks`, app23.js:L646–671). The engine's source galaxy lives as GPU buffers, not rows.
- **How many marks a source emits** is data-dependent (a dot makes ⌊κ·min(30, |μ|) + u⌋ of them), and the output has to be in a deterministic order with no read-back.
- **The source galaxy.** `buildSourceGalaxy` (L630) builds a galaxy by overwriting the globals `P`, `VAR`, `VIEW.scale` and `SM`, generating, and putting them back.
- **Seeding.** v21 seeds the emission with `mulberry32(P.seed · 733 + round(bc[0] · 997))` (L647), where `bc` is where the source is seen from the current camera: orbiting changes the seed, so the lensed marks are re-drawn from nothing (the lens case of the `INCL_CONTINUOUS` note in src/view/camera.ts).
- **The home orientation.** The sources are fixed in 3D at the camera of the first render of a lens key (`homeFor`, L445), so a drawing depends on how the page was navigated (reference notes, flagged item 2).

## Decision

1. **One table of marks per lensed scene** (src/sim/lens-pack.ts), one 48-byte row each: its source-plane position relative to its source, its drawing, alpha and 2 × 2, its class and its source. The classes are the stipple's (old, disc, young, knot, star, drawn star), then the drawn core (6), the anchor of a warped drawing (7), a point of a curve (8) and the quasar's own position (9). Every point the lens has to solve is a mark, so one query pass (`query_marks`) serves stipple, curves, drawings and the quasar.
2. **A mark has 8 slots, one per image.** `count_marks` gives each slot its number of marks from the counter RNG keyed by (seed, `lens` stream, mark · 8 + image, draw). A deterministic scan per class (a work-group scan over the slots, `scan_local`, then one invocation per class, `scan_blocks`) turns counts into offsets, and `emit_marks` writes each slot's marks at its offset. The result is in (class, slot) order whatever the scheduling, with indirect draw arguments `[4, count, 0, 0]` per class: no read-back (ADR 0003, 0004).
3. **κ is a fixed-point sum.** Each dot mark adds Σ min(30, |μ|) over its images, in units of 2⁻⁸, to its source with an integer atomic add (commutative, so exact). κ = min(1.2, 0.5 · dens / max(1, Σ)) is read from the sum when counting. 2⁻⁸ keeps 70,000 marks of eight images at the cap inside a u32, and its rounding error is about 10⁻⁴ of κ.
4. **Emission never re-rolls.** The draws are keyed by (mark, image), not by where the source is seen from. Orbiting moves the images and keeps every mark's own numbers, as the stipple does (ADR 0004; deliberate divergence 1). A mark's image index changes only when an earlier image appears or disappears at a caustic. v21's orbit re-rolls the lensed marks (`bc` seeds the stream).
5. **The source galaxy is described as any galaxy is.** `sourceParams` applies `buildSourceGalaxy`'s overrides (L632–634) to a copy of the parameters; `buildScene` describes it (variation, curves, parts, stipple); the engine's own stipple samples it and the engine's own projection places it, with its own camera (its inclination, no azimuth, its roll, winding 1, scale 70). Nothing global is swapped, so a source cannot leak into the main galaxy and a scene can hold nine of them. Its samples become marks by `(X − 400) · k` (`ts`, L636).
6. **Curves** are resampled in the source plane at half a grid cell on the CPU (the model tier), and every resampled point is a mark. `track_curves` (one invocation per curve) is v21's greedy matcher over those marks' images: each live branch takes the nearest unused image within four cells, in order, first of equals winning. Branches keep their birth order. `gather_branches` (one invocation) lays the branches of at least three points out as the **line-work's own curves**, in plate units, in 96 slots, and the existing ribbon passes (`measure`, `expand`, `place_pieces`) draw them, so a lensed stroke is the same ink as a stroke. A slot may hold fewer points than its capacity, so `expand` writes empty segments past a curve's end. Caps: 24 branches per curve and 96 slots in all (v21 has none; the presets use a dozen).
7. **Warped drawings** go through the vector expansion's `post` hook (ADR 0006), which takes the image's affine `out = c' + S (q − a)` (L667, with S = U·k·R(pa)·J): the hook's `w` carries the drawing's centre and the translation to the image's own place (`c + t + S (q − c)`; t is zero for the merger tides of M8), and an instance can be switched off (`pad0` = 1). Each drawing has 8 instances, one per image; one whose |μ| > 40 or that does not exist is off. v21's rejection of segments that jump more than 22 px and of those stretched more than 1.8× is the hook's own.
8. **The home is explicit** (open question Q3, option b). `LensHome` (`{ incl, az, w }`, src/core/home.ts) is saved with the parameters. `Params` mirrors v21's `DEF` key for key (a tested invariant), so it is a sibling record, `SceneOptions.lens.home`. Choosing a lens preset sets it from the preset's camera, which is what v21's `homeFor` would have remembered on a fresh page. A render is then a pure function of the parameters, the home, the camera and the zoom: the same on every visit, whatever was done before.
9. **The cap of eight images** (ADR 0008) is kept. v21 has none; its lists have at most five in practice. The id table of each solver has room for 24 ids per triangle (measured: about 3).
10. **Drawn stars.** The quasar's star (`lensStar`'s `sstars` drawing) and the source galaxies' drawn stars are class 5 marks, counted and not yet drawn, until M7. The quasar's carries its pen scale 0.7 + 0.5 B in the alpha field of its instance, as vector marks ignore alpha (reference notes 20.10).

## Consequences

- A view costs queries plus a few scans, about 15,000 marks for a single source and 25,000 for a cluster. The solver is rebuilt only when the lens changes.
- Orbiting never re-rolls a lensed mark. v21's orbit does, so the orbit captures differ from the engine's in which dots, never in structure.
- The home is part of what a saved drawing holds. M11's URL state and saved drawings must carry it, and the page must set it when a lens preset is chosen (src/main.ts does).
- The weak lensing of the deep field is `weakLensing` (src/sim/lens.ts), a documented hook the M7 deep field calls; until then the cluster's captures have the field off (ADR 0052).
- The CPU engine runs the same tables through twins of every kernel and matches at L1 (tests/gpu/lens.ts): how often the two engines' image lists differ is reported there.
