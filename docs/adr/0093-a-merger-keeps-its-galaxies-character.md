# 93. A merger keeps its galaxies' character

Date: 2026-10-10

## Status

Proposed. Opt-in (`mergeAuto`, "Merger keeps its galaxies' character": 0 in the core so v21's goldens hold, 1 on the page). A deliberate divergence from v21, requested by the owner.

## Context

Mergers read as the same two blobs and a jumble: a spiral meeting an elliptical shows no spiral structure, and the dust and arms of each progenitor are lost. Each galaxy is already described by its own type, arms, bar and bulge (`mergerGalaxyParams`), but a spiral's arms are only a half of its test stars (0.25 rad wide, v21's initial conditions) and are thin in contrast, so by the time the tides have acted the arms do not read.

## Decision

With `mergeAuto`:

1. A spiral's initial stars: three quarters sit on the arms (v21: half), 0.16 rad wide (v21: 0.25). `GalaxyIC.crisp` (0 or 1) reaches both the CPU kernel (`src/fallback/kernels/merger.ts`) and `compute/merger.wgsl` as `MGal.p.w`; the sim's key includes `mergeAuto`, so the model tier rebuilds when it changes.
2. A spiral progenitor is drawn with crisper arms: contrast at least 0.95, width 0.7 of the main parameters', knots at least 0.5, and 1.5 times the stars.

Without it nothing changes.

## Not done

- The sim's physics (tidal strength, framing, how much of the disc is disturbed) is v21's; the arm structure still shears out with the tides, so a late merger shows much less than an early one.
- Dust and line-work of each progenitor are still warped by the tidal map, and its torn pieces still read as stray strokes. Culling or fading tears is a follow-up, as is keeping an elliptical's smoothness apart from the spiral's.

## Consequences

- A spiral progenitor's arms read more clearly before and through the first pass. The effect is modest by design: the arm density wave is not a dynamical thing in a test-particle sim.
