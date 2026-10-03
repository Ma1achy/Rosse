# 10. Data flow: model, view and present tiers, rebuilt only when their inputs change

Date: 2026-10-03

## Status

Accepted

## Context

The reference recomputes everything on every render (`render`, app23.js:L1220). That includes every pointer-move while orbiting (L1841–1858), so an orbit frame of a cluster lens takes 1.6 s on SwiftShader. It has a few ad hoc caches keyed by joined parameter strings: the merger (`MCACHE`, L303), shells (`SCACHE`, L710), the sky (`SKY`, L857), dust clouds and lanes (`CLOUDS`, `LANES`, L922, L943), and the lens home (`LHOME`, L444).

Some of what looks like model is view-dependent in the reference:

- Dust optical depth depends on the line of sight (`dustTau(p, c, s)`, L145; L262).
- Dust lanes and the stipple culled beneath them are computed in screen space (L194–198, L265).
- The breathing room round bright stars is computed in screen space (L275–281).
- Structure switches at fixed inclinations, through `incE()` thresholds at 70°, 72°, 74°, 78° and 80°. These decide edge-on lanes versus arm lanes (L201, L950), whole-drawing type (L1001), cores (L1028–1031), and edge-on midplane strokes (L788).
- The deep field is a perspective view of a 3D catalogue (L884).
- Lensed sources move with the camera (`srcNow`, L450).

## Decision

Three cache tiers, each a set of GPU resources with a key made from exactly its inputs:

| tier | inputs | contents | rebuilt when | expected cost |
| --- | --- | --- | --- | --- |
| **Model** | every parameter except the camera and the present ones; the `incE` bucket (which side of each threshold the inclination is on) | scene description (CPU, ADR 0003); stipple samples in the galaxy frame, each with its stored per-sample random numbers for later culls; curve control points; part placements; sky catalogue; merger core track and test-star snapshots; lens grid, bins and source-galaxy marks; shells | a model parameter changes, or the inclination crosses an `incE` threshold | 1–30 ms; long merger horizons are spread over frames |
| **View** | camera (incl, az, pa, winding, zoom), merger timeline position `mTime`, and the model tier | projection, the view-dependent culls (dust optical depth, dust lanes, breathing room), instance compaction, ribbon and piece expansion, vector expansion with warps, sky perspective and weak-lensing distortions, lens source offset, queries and emission, tidal warp grids, overlays placed from their explicit home orientation | the camera moves or `mTime` changes | < 2 ms GPU |
| **Present** | surface (Paper or Chalkboard), plates mode, device pixel ratio, canvas size | ink target, composite | any present input changes | < 1 ms |

Parameters are tagged with their tier in `src/core/schema.ts`. A change marks its tier and every tier below it dirty. `render/frame.ts` records only dirty passes. Inside the model tier, sub-caches (merger, lens, shells, sky) are keyed separately, as in the reference, so changing the arm pitch never re-integrates a merger.

## Consequences

- An orbit drag runs the view and present tiers only, with no CPU work beyond uniforms and no read-back.
- Crossing an `incE` threshold while orbiting rebuilds the model tier once. That is a visible change of structure, as in the reference (edge-on dust lanes appear), not a re-roll.
- View-dependent culls must be pure filters over stored per-sample random numbers (ADR 0004). This changes behaviour from the reference, where they shift the RNG stream (docs/reference-notes.md, flagged item 1).
- The tier tags in the schema become an invariant that tests check: changing a view parameter must leave the model buffers' hashes unchanged.
