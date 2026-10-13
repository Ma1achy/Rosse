# 96. A merging galaxy has a dark halo

Date: 2026-10-13

## Status

Proposed. Opt-in (`mergeAuto`, ADR 0093: 0 in the core so v21's goldens hold, 1 on the page). A deliberate divergence from v21, requested by the owner.

## Context

v21's merger is a restricted problem: each galaxy is a Plummer point mass (the core), its stars are test particles that feel both cores and not each other. A point mass has a Keplerian rotation curve, which falls with radius; real galaxies' curves are flat, because dark matter holds the outer disc. With a falling curve the outer stars orbit slowly and the inner ones fast, so a disc shears quickly and its arms wind up and blur; and the tides of the other galaxy meet stars bound only by a point mass.

## Decision

With `mergeAuto` each galaxy also has a dark halo, an isothermal sphere of circular speed √(0.3 M) and core radius √0.5, felt by the test stars:

1. **The pull**: each star is accelerated toward both cores by `h d / (d² + rc²)` in addition to the Plummer terms, `h = 0.3 M` (`MSim.h0`, `h1`, `hrc2`; `merger.wgsl` `accel` and its twin in `src/fallback/kernels/merger.ts`). The halo of the other galaxy therefore tides a disc at long range too.
2. **The start**: a star's circular speed adds the halo's (`h r² / (r² + rc²)`) to the Plummer square, so the disc starts on the flat curve it then lives on (`circular`, both engines).

The cores' own orbit is v21's (the halo is not in the cores' force or friction): the encounter's geometry and timing are unchanged, and the cores' track still equals v21's.

## Consequences

- The core is v21's: without `mergeAuto` `h` is 0 and nothing changes.
- Discs rotate with a flat curve, so their arms stay coherent longer and the first pass throws wider tidal arcs.
- The cores do not feel the halos (no extra friction or deeper merger), and the halos are not live: they do not respond to the stars. Gas, star formation and a live N-body are not drawn; the restricted problem is kept.
