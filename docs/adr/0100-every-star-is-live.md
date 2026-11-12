# 100. Every star is live

Date: 2026-11-11

## Status

Proposed. Rides on `nbody` (ADR 0099): off in the core so v21's goldens hold, on in the page. Amends ADR 0099's "not a full N-body of every visible star".

## Context

ADR 0099 made a sample of massive tracers live and left the ~10,000 visible test stars as passive. That stopped short only for cost: a direct sum over them is ~10^8 interactions a step. The GPU can pay that; the CPU engine cannot, and the engines must agree (ADR 0004).

## Decision

With `nbody`, every star of a merger pulls on every other star and on the cores.

- **Mass.** Stars carry `LIVE_DISC` (0.35) of their galaxy's mass, `starMass` each; the core carries the rest. A disc starts on the circular speed of the core plus the enclosed star mass (exponential disc or spheroid, times `MERGER_DISC_BOOST` 1.25), not the point mass alone.
- **Impulse scheme.** The star-star acceleration `ae[i]` is recomputed once per block of `MERGER_SELF_STEPS` (4) steps and held constant over it; the cores and halos stay per-step. Sources are every `MERGER_SELF_STRIDE`th (4th) star at four times the mass, Plummer-softened (`MERGER_SELF_SOFT2` 0.012).
- **GPU** (`self_gravity` in `merger.wgsl`): direct sum over the sources with workgroup tiles.
- **CPU** (`selfgrav.ts`): a Barnes–Hut octree, θ 0.7, monopole plus a softened quadrupole, cells that contain the target always opened, f64 inside, f32 out. The exact sum (`exactSelf`) is its test twin.

## Consequences

- Field agreement, GPU direct vs CPU exact, is rms 6e-7; tree vs exact is under 0.6%. Orbits drift apart through chaos: median 0.97 px at the chosen moment, p99.9 64 px, so the live parity gates are relaxed (median ≤ 2 px, p99.9 ≤ 100 px, field rms < 2e-4). Non-live cases keep their gates.
- The self-force is subsampled by 4 and held across 4 steps; it is a field, not a close-encounter integrator. Gas shares the force but keeps its dissipation.
- The cores' orbit still comes from ADR 0099's tracers; the stars' own pull acts on the cores' neighbourhood, not back on the track.
- Cost: a full-size live merger runs ~9 s on the CPU and ~29 s under SwiftShader on a loaded machine; the CPU tree speed has not yet been measured on an idle one.
