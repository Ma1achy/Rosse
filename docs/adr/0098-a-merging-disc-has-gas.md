# 98. A merging disc has gas

Date: 2026-10-13

## Status

Proposed. Opt-in (`mergeAuto`, ADR 0093: 0 in the core so v21's goldens hold, 1 on the page). A deliberate divergence from v21, requested by the owner.

## Context

v21's test stars (and, with ADR 0096, their dark halos) are collisionless: they never lose orbital energy. A real merger is not: the discs' gas collides, shocks, loses angular momentum, falls into the nuclei and lights a starburst. Without that, a merger's centre stays as diffuse as its outskirts and the remnant never builds the dense core a coalescence leaves.

## Decision

With `mergeAuto` `MERGER_GAS_FRAC` (0.3) of each disc galaxy's test stars (never an elliptical's) are gas, picked on the init stream (`u01(i, 220) < 0.3`, one function in each engine). A gas star differs from the others in two ways:

1. **It dissipates** (`gas_relax` in `merger.wgsl`, `relax` in `src/fallback/kernels/merger.ts`). After every kick it relaxes toward the circular motion about the nearer core, in that core's own plane: `v ← (v + h κ vt) / (1 + h κ)`, with `vt` the core's velocity plus the circular speed (point mass and halo, the start's own `circular`) along `n × r̂`, `κ = MERGER_GAS · w · v_c / r` (0.25 of the local orbital rate), and `w` fading to zero between the disc's edge and 1.6 of it. A disc in equilibrium has `v = vt` and feels nothing; a tidally disturbed one is damped toward the nearer core's disc and sinks into the nucleus. The semi-implicit step is unconditionally stable.
2. **It lights up** (`merger-sprites`): gas near a nucleus (within 0.8 of its disc radius) is a bright knot, with a probability that peaks at the core and rises as the discs overlap, a nuclear starburst.

## Consequences

- The core is v21's: without `mergeAuto` the rate is 0 and no star is gas.
- The gas of a close pass concentrates (the median distance from the nearer core falls to a fraction of the stars'), and a coalescing pair's remnant has a dense, bright centre.
- Still a restricted problem: the stars, the gas and the halos do not pull on the cores or on each other, so there is no live N-body (the cores' orbit is v21's point-mass track), and the gas does not collide with gas of the other galaxy except through the shared nearer-core relaxation. Self-gravity, a hydrodynamic or sticky-particle gas, and the cores feeling the halos are out of scope.
- Cost: one nearest-core choice and a square root per gas star per step.
