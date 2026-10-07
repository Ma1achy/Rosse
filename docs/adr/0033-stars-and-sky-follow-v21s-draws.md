# 33. Where the stars and the sky follow v21's draws exactly

Date: 2026-10-06

## Status

Accepted. Extends [0021](0021-goldens-drawn-with-v21s-part-picks.md).

## Context

Three places in v21's `starSprites` and `buildSky` draw random numbers in a way that changes the distribution, not just the values. Each is marked `// v21 parity` in the source.

## Decision

1. **Loop bounds drawn afresh at each test.** The faint nearby stars (`f < 3 + Math.floor(r() * …)`) and the cosmic rays (`c < 70 + Math.floor(r() * …)`) redraw their bound at every iteration, so the count is not uniform but a geometric-like truncation. The engine draws the bound the same way, from its named streams; tests/unit/stars.test.ts checks the distribution over 2,000 seeds against v21's own code.
2. **Foreground stars' radius factor is drawn per coordinate**, not per star (`unit3(r).map(x · R_FG · …)`), which makes them slightly flattened. Kept.
3. **Rstars ignore wobble on their centre**: the wobble is applied per vector point, not to the placement.
4. **Zoom length `ZL = zoom^0.45`** for the stars' glare and spikes.

These are not the values v21 draws (the engine has its own counter RNG), only the shapes of the distributions. Reproducing the values themselves is the golden harness's job (`SceneOptions.starPicks`, `sky`), by replay.

## Consequences

- If v21's behaviour is later judged a bug, each place is one line with a `v21 parity` comment to change, and the tests name the distribution they check.
