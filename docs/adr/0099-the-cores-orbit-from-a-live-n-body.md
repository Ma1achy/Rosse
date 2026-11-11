# 99. The cores' orbit comes from a live N-body

Date: 2026-11-11

## Status

Proposed. Opt-in (`nbody`, "Live N-body cores": 0 in the core so v21's goldens hold, 1 on the page). A deliberate divergence from v21, requested by the owner.

## Context

v21's merger is a restricted problem: two Plummer point masses on a Kepler orbit with a made-up friction on their relative velocity, and test stars that follow them. Nothing in the galaxies pulls on anything else, so the orbit is the same whatever the galaxies are made of and a merger can neither build a tidal bridge's pull nor lose orbital energy to the discs' wakes.

## Decision

With `nbody` each galaxy is a live system (`src/sim/live.ts`, f64, in the same pre-pass that makes the core track): a softened core of 65% of its mass plus `n` massive tracer particles, a disc (or, for an elliptical, a hot ball) of the other 35%, placed from the counter RNG on the galaxy's own frame, each on the circular speed the system's own pull gives. All particles pull on all others by direct summation (a symmetric pair counts once; core–core softened as v21's, core–tracer by the core's softening, tracer–tracer by `LIVE_SOFT2`); the dark halos of ADR 0096 ride on their cores, pull the tracers and the cores take the reaction; v21's friction term is kept on the cores' relative velocity.

`n` per galaxy is chosen so the whole run costs at most `LIVE_PAIR_BUDGET` pair interactions (60 to 400, about 170 for a 2,600-step merger, under a second), so the track is a pure function of the parameters and the seed. The same leapfrog (opening half kick, drift, kick) that makes v21's track steps the live system, and the cores' positions at each kick and snapshot are read back into the `CoreTrack`: the engines are unchanged, because the visible test stars still follow the cores, the halos and the gas as before.

## Consequences

- The core is v21's: without `nbody` the track is the point-mass one, bit for bit.
- The cores' orbit now depends on the discs: a closer first pass (the extended mass pulls harder than a point), tides that return the cores to each other more or less than the point-mass track does, and a remnant that is a dense core in a spread of tracers.
- Momentum is conserved exactly by the pair forces (a test); the halos are rigid and ride on their cores, so the reaction on a core stands in for their own.
- Not a full N-body of every visible star: the ~10,000 test stars (and the gas) still do not pull on one another or on the cores, because a direct sum over them costs on the order of 10^11 interactions per merger, far more than the CPU engine could repeat (the engines must agree, ADR 0004). The massive component is the part of a galaxy whose self-gravity moves its centre, so it is the part made live; a tree or particle-mesh scheme in both engines would be the next step.
- A live track costs about a second on the main thread when its parameters change; the last four are cached, so the thinned track and the union frame reuse them.
