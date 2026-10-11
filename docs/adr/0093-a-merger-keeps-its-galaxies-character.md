# 93. A merger keeps its galaxies' character

Date: 2026-10-10

## Status

Proposed. Opt-in (`mergeAuto`, "Merger keeps its galaxies' character": 0 in the core so v21's goldens hold, 1 on the page). A deliberate divergence from v21, requested by the owner.

## Context

Mergers read as the same two blobs and a jumble: a spiral meeting an elliptical shows no spiral structure, and the dust and arms of each progenitor are lost. Each galaxy is already described by its own type, arms, bar and bulge (`mergerGalaxyParams`), but a spiral's arms are only a half of its test stars (0.25 rad wide, v21's initial conditions) and are thin in contrast, so by the time the tides have acted the arms do not read.

## Decision

With `mergeAuto`:

1. **Crisper progenitors.** A spiral's initial stars: three quarters sit on the arms (v21: half), 0.16 rad wide (v21: 0.25), and it is drawn with contrast at least 0.95, 0.7 of the usual arm width, knots at least 0.5 and 1.5 times the stars. `GalaxyIC.crisp` (0 or 1) reaches both kernels as `MGal.p.w`; the sim's key includes `mergeAuto`.
2. **Nothing is pinned.** An earlier version blended a disc's inner stars toward where they started, so its arms stayed fixed while the rest of the merger evolved and then rearranged as the hold let go. That is not what a merger does and it was removed: every star is drawn where the simulation puts it, so the discs rotate and the tides tear them.
3. **An elliptical is a soft glow.** Its dots are 0.55 to 1 of their size (smallest at the centre) and 1.5 times as many are kept.
4. **Dust lanes that travel.** A disc star whose initial angle lies on the trailing edge of an arm (0.22 rad behind it, 0.09 wide) is dropped with probability 0.85 times the lane strength (`P.dust`, plus 0.35 with `dustAuto`, cap 0.8; 0.6 of that for a lenticular). The lanes are carried with the stars, so they stretch into the tails. A bridge: stars within a tube about the line between the cores (0.1 of its length, between 0.12 and 0.88 along it) are thinned while the galaxies are still apart.
5. **Tails and star formation.** Tail knots are 3 times as likely, a fifth of them are tidal dwarfs (11 tight, larger knots), and where a disc lies inside 0.9 of the other galaxy's radius it forms knots 1.6 times as often as the outer disc.
6. **Strokes taper out.** In the tidal map (header word 9) ribbon segments and capsules thin from 1.05 times their length to a sixth of their width at the tear (1.8), instead of ending in a dash.
7. **A thicker disc.** The initial thickness of a disc is 2.5 times v21's, so a tilted one has depth along its normal.
8. **A more extended disc.** The scale length is 0.37 √M (v21: 0.32) and the truncation radius 2.3 √M (v21: 1.7), so the outer disc, which the tides pull the tails and the bridge from, holds more stars. `GalaxyIC.rd` and `rmax` carry it to every kernel. Tail knots are twice v21's (not three times).

Without it nothing changes.

## Not done

- The sim's physics (tidal strength, framing) is v21's. Shells and a stellar bridge of their own (more stars, not fewer) are not drawn.
- Stage cues are the bridge's and the lanes' fade, not a separate set per stage.

## Consequences

- A spiral progenitor reads as a spiral through the first pass, an elliptical as a smooth halo, and dust lanes stretch with the tails. The merger kernel's uniform grows by six `vec4` and two scalars; the tidal map's header by one word (10).
