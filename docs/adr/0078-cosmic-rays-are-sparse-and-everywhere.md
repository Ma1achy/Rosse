# 78. Cosmic rays are sparse and everywhere

Date: 2026-10-09

## Status

Proposed. A deliberate divergence from v21, requested by the owner, on the page only: the core, the goldens and the vectors keep v21's hits. It keeps [0010](0010-two-compute-tiers.md)'s tiers: the hits are model data, never a function of the camera.

## Context

A cosmic ray is a fast particle that strikes a camera sensor and leaves a short, straight, bright streak (sometimes with a bright knot where it stopped). They fall at random over the whole frame and have nothing to do with the stars. v21 draws 70 to 130 hits (`70 + floor(r * 60)`, app23.js:L433) in a box of 5.2 galaxy units round the star: 470 px of the 800 px plate. Next to the star's spikes, rings and glare they read as part of the star effect, a halo of short dashes round it, and the owner found that "weird".

## Decision

1. **One new parameter, `cosmicAuto`** (a 0/1 choice, "Natural cosmic rays", model tier, in the star or artefact component's more controls). It is 0 in `DEF`, so every core caller, golden, vector and replay is v21's. v21's own hits, replayed by the golden runner (`StarPicks`), are not touched.
2. **40 to 70 hits, spread over the whole plate.** With the flag, the engine's own picks draw `40 + floor(r * 31)` hits, each placed uniformly over `PLATE / UNIT_SCALE` = 9.52 units on a side (the plate at zoom 1), so the hits fall anywhere in the picture. A hit's length (3 to 33 px), angle and knot are drawn as v21's, on the same counters, so only the number and the place change.
3. **Fixed to the camera as before** (ADR 0055): they are placed at the zoom-1 scale and do not move with the star or grow with the zoom.
4. **Default off in the core, on in the page**, as ADR 0075 to 0077.

## Not modelled

- Hits that follow the sensor's grain, or an exposure time.
- Hot pixels and other single-pixel defects.

## Consequences

- On the page, an artefact of cosmic rays, and any overlay that carries them, is a sparse scatter of streaks over the whole picture, with the star's own marks readable.
- The comparisons with v21 of a cosmic-ray picture move; the goldens do not (`cosmicAuto` 0).
- `PARAM_KEYS` has four keys more than v21's `DEF`.
