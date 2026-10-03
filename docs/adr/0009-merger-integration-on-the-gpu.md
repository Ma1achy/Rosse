# 9. Merger integration: core track on the CPU in double precision, test stars on the GPU with the reference's leapfrog

Date: 2026-10-03

## Status

Accepted

## Context

The reference simulates a merger as a restricted three-body problem with many test particles (`simulateMerger`, app23.js:L304–380):

- Two cores of mass 1 and q follow a parabolic orbit (or an elliptic or hyperbolic one, via `mEcc`) in a tilted plane, with optional dynamical friction. They interact through Plummer-softened gravity (softening² 0.02).
- Test stars (default 11,000; up to 30,000) start as discs, or as hot spheroids for ellipticals, round each core. They feel both cores, which are Plummer spheres of scale 0.22 and 0.22√q, and not each other.
- The integrator is **kick-drift-kick leapfrog** with dt = 0.012. It takes T/dt steps (capped at 1,400) up to the chosen moment, keeping about 90 snapshots for the timeline. It then carries on to `mHorizon` (5·(H − 1)/dt steps: 417 at the default, about 12,000 at H = 30), keeping up to 420 more snapshots.
- It is cached by a key of the merger parameters (L305).

After that:

- the snapshots are blended for the timeline (`snapAt`);
- each galaxy is drawn as a single galaxy would be, then **carried by the tides**: a 4-nearest-neighbour inverse-distance warp from initial disc coordinates to current screen positions (`tidal`, L538–551), sampled into a 49 × 49 grid (L1242–1245);
- strokes are torn where the warp stretches them more than 1.8× (L834, L1208).

Two parts behave differently:

- The **core track** is two bodies, at most about 13,500 steps. It is sequential and tiny, and it decides everything downstream.
- **Test stars** are independent given the core track: embarrassingly parallel, and 11k–30k × up to 13,500 steps.

## Decision

- **The core track is computed on the CPU in f64** (`src/sim/merger.ts`), with the reference's equations, initial conditions and step sequence (the half kick at start and end, L360–376). It is uploaded as a buffer of core positions per step. Being sequential f64 JavaScript, it is identical on every machine (it uses only `+ − × ÷ sqrt exp`, which JavaScript specifies exactly or as correctly rounded). The same function feeds the CPU fallback.
- **Test stars are integrated on the GPU** (`compute/merger.wgsl`): one thread per star, KDK with dt = 0.012 in f32, reading the core positions per step from the track. The work is dispatched in chunks of about 200 steps per submit, so a long horizon never stalls a frame, and progress is shown. Snapshot positions are written to a ring of `array<vec4<f32>>` per snapshot (about 30k × 16 B × 510 snapshots ≈ 245 MB at the maximum). That is too much, so the budget is:
  - _timeline_ snapshots are stored at **f16 positions relative to the nearer core**, with half the snapshots of the reference, interpolated with `snapAt`'s linear blend: 30k × 8 B × 255 ≈ 61 MB at the very worst, about 6 MB at defaults;
  - the chosen moment and the end of the horizon are stored in f32.
- **Initial conditions** come from the counter RNG (ADR 0004), keyed by star index, in a compute pass.
- **The tidal warp grid** (49 × 49 per galaxy) is computed in a compute pass per view: one thread per grid vertex, a fixed-order scan of the 20 × 20 initial-coordinate bins, the 4 nearest by (distance, index), and inverse-distance weights. The tear test is applied per segment in `vector-expand.wgsl` and `ribbons.wgsl`.
- The friction term and the core softening are kept bit-for-bit as the reference's formulas, in f64 on the CPU.

## Consequences

- The cores are exactly reproducible everywhere. Test stars are deterministic per adapter (L0).
- f32 test stars on different GPUs drift apart through rounding, and close passages amplify it. Over 1,400 steps we expect sub-pixel differences for most stars. Stars flung into tails are the most sensitive. This is measured in M8 and covered by the L1 tolerance.
- f16 timeline storage loses precision far out in tails: 11 bits of mantissa at radii of about 10 units is about 0.005 units, or 0.4 plate px. That is acceptable for an animated preview, while the chosen moment stays f32.
- Changing the timeline position (`mTime`) never re-integrates. It only re-blends snapshots and re-runs the view tier.
