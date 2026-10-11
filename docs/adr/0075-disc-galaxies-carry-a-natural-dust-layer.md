# 75. Disc galaxies carry a natural dust layer

Date: 2026-10-09

## Status

Proposed. A deliberate divergence from v21, requested by the owner, on the page only: the core, the goldens and the vectors keep v21's dust. It keeps [0010](0010-two-compute-tiers.md)'s tiers: the natural dust is a function of model parameters, never of the camera.

## Context

Real disc galaxies, spirals and lenticulars, almost all carry a thin layer of dust. Seen face-on it is a mild extinction, an optical depth through the centre of about 0.3. Seen edge-on the same layer is the dark midplane lane, and it dims the bulge behind it. Ellipticals and other smooth galaxies have almost none.

v21 has one parameter for it, `dust`, which defaults to 0 (`DEF`, app23.js:L11-19). Only two presets set it (0.85 and 0.7), and `fromVotes` sets it for the edge-on dust-lane galaxies. Every other galaxy is drawn dust-free, so an edge-on spiral has no lane, and ADR 0074's extinction of overlay stars has nothing to work on. The model itself is one smooth slab: `dustTau` (app23.js:L145-152) is `9 * dust * pathLength * exp(-R / 1.6)` over `|z| < 0.06`, `R < 3.2`, face-on `1.08 * dust` through the centre.

## Decision

1. **One new parameter, `dustAuto`** (a 0/1 choice, "Natural dust", model tier, in the dust component's more controls). It is 0 in `DEF`, so every core caller, golden, vector and replay is v21's. `DEF`, the presets and `fromVotes` are untouched; `tests/unit/params.test.ts` pins v21's keys and allows the port's extra keys through one documented list.
2. **One function, `effectiveDust(P) = dustAuto ? max(dust, naturalDust(P)) : dust`** (src/model/dust.ts), the value every reader of `P.dust` takes: the galaxy uniform `g.dust` (`packGalaxy`), which the optical-depth cull, the edge-on lane and carving conditions (`dust > 0.25`, `> 0.3`, app23.js:L227-228) and the overlay stars' `dustTau` (ADR 0074) read on both engines, the edge-on midplane stroke (`faint` above 0.3) and the whole-drawing type (`edge-on:dust-lane`). CPU and GPU get the same f32. An explicit larger `dust` still wins.
3. **`naturalDust(P)`** reads only model parameters (never `incl`, `az`, `pa`, so an orbit or a zoom leaves the model alone). It is 0 for a star or an artefact, and for a smooth galaxy (`sersicN > 0` or `bulge >= 0.95`, the engine's own thresholds for the Sérsic profile and for the end of the arms). Otherwise a base by type, taken down by the bulge:
   - spiral (`arms >= 1`): `DUST_SPIRAL` 0.36, face-on centre optical depth 0.36 x 1.08 x 0.9 = about 0.35 at the default bulge 0.2. It is above 0.3, so an edge-on spiral gets the lane;
   - no arms (a lenticular, a ringed disc): `DUST_LENTICULAR`, half of that, 0.18;
   - irregular (`irr > 0.5`): `DUST_IRREGULAR` 0.2;
   - times `1 - 0.5 * bulge` (`DUST_BULGE_SHARE`): a big bulge is a dust-poor spheroid.
   The spirals of the presets come to 0.25 to 0.34, face-on optical depth 0.27 to 0.37.
4. **Default off in the core, on in the page.** The page lays `dustAuto: 1` over every preset (`variantOverrides` in src/main.ts, which "Surprise me" also takes) and over the catalogue and real galaxies (src/ui/galaxies.ts); not under a golden `?variant=`. A link writes only what differs from the page's base, so it stays short, and `dustAuto=0` in a link is v21's drawing.
5. **Mergers** take it per galaxy: `mergerGalaxyParams` overrides arms, bulge and Sérsic index by each galaxy's type, so `naturalDust` of the merged parameters gives a spiral its layer and an elliptical none, with no new key. **Sources of a lens, the shells' arcs and a scene with no galaxy** set `dustAuto` 0.

## Not modelled

- Dust that follows the arms, in clumps, or a patchy layer: this is v21's smooth slab with a better default. A field of its own is a later step.
- The dust of the deep field's galaxies and of a lensed source.
- Dust in ellipticals (a few have a nuclear disc or lane).
- A merger's overlay star is still not dimmed (ADR 0074).

## Consequences

- On the page, an edge-on spiral shows the dark lane and a dimmer bulge, a face-on one is slightly thinned at the centre, an elliptical does not change. Overlay stars behind a disc are dimmed (ADR 0074) without a preset setting `dust`.
- The comparisons with v21 of any disc galaxy on the page move; the goldens do not (`dustAuto` 0).
- `PARAM_KEYS` has one key more than v21's `DEF`, and the golden records, which are v21's, lack it.
