# 17. The model tier's inclination key is a structure signature

Date: 2026-10-04

## Status

Accepted. Clarifies [0010](0010-data-flow-and-cache-tiers.md), which stays as written.

## Context

ADR 0010 puts the camera in the view tier and lets the inclination dirty the model tier only through "the `incE` bucket (which side of each threshold the inclination is on)", listing v21's `incE()` thresholds at 70°, 72°, 74°, 78° and 80°.

M3's review found two uses of the inclination in v21 that do not go through `incE()`:

- **L1000** picks the whole drawing `smooth:elongated` when `P.bulgeFlat * Math.max(ci(), 0.05) < 0.5`.
  - This is a discrete switch on the raw cos i, not on the folded `incE()`: 30° and 150° share an `incE` bucket but differ here.
  - For `bulgeFlat` 0.9 the answer flips at 56.25°, inside the first bucket.
  - A key made of `incE` buckets alone would keep a stale whole drawing across that flip.
- **L788** sets the edge-on midplane stroke's alpha to `P.lines · (P.incl − 72) / 18`. That is continuous, so it is a view-tier input like the projection, not a structure switch.

A full scan of `app23.js` finds 36 uses of `P.incl`, `ci()` and `incE()`:

- 12 `incE()` thresholds;
- 1 raw cos i threshold (L1000);
- 23 continuous uses: the projections, flattenings by `max(bulgeFlat, cos i)`, the dust optical depth, cache keys of screen-space passes, the definitions of `ci()` and `incE()`, the page's summary text, and the orbit controls.

## Decision

The model tier's inclination key is a **structure signature**: the answer of every discrete inclination switch in v21, for the current parameters (`structureKey(P)` in `src/view/camera.ts`).

- **The `incE()` thresholds** (`INCE_USES`, 12 uses) are part of it.
- **L1000's cos i test** (`CI_PREDICATES`) is part of it too.
  - It is evaluated only where v21 evaluates it, under its own guard in the same expression: `kind` auto and bulge ≥ 0.95.
  - A galaxy with a disc does not rebuild its model at 56°.
- **`dirtyTier`** rebuilds the model when an inclination change changes the signature.
- **Every other use** is listed in `INCL_CONTINUOUS` and must be computed in the view tier, L788's alpha included.
- **The test** (`tests/unit/camera.test.ts`) scans `app23.js` and requires every `P.incl`, `ci()` and `incE()` to be either a structure predicate or a listed continuous use. A new use in a later milestone's port therefore has to be classified. The scan is token-level: functions that read the inclination indirectly (`orientNow`, `srcNow`, `scenePoint`, `project`, `discM`, `toView`) are classified once, at their definitions, and what they feed is classified by their consumers.

The alternative was to make the choice of whole-drawing type a view-tier part. It was rejected, because:

- it moves a part-placement decision, which draws from the placement streams, out of the tier that owns placement;
- it would leave the next non-`incE` switch to be found the same way.

The signature keeps one rule: discrete switches are model, continuous uses are view. It also costs nothing when no switch changes.

## Consequences

- `inclBucket` remains as a coarser description of the `incE` part and is used in tests. It is no longer the key.
- Orbiting a smooth galaxy (bulge ≥ 0.95, kind auto) across the L1000 flip rebuilds its model once per crossing. This is a change of structure, as in v21.
- When M4 and M5 port the remaining uses, each consumer must read the inclination in the tier this ADR assigns. The scan test fails if a use is added to the reference list without a classification.
