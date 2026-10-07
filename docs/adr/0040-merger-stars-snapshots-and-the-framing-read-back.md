# 40. Merger test stars: the snapshot budget, chunked integration and the model tier's one read-back

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Extends [0009](0009-merger-integration-on-the-gpu.md) (accepted), which it does not change: the core track is still f64 on the CPU, the test stars still f32 on the GPU with KDK at dt 0.012.

## Context

ADR 0009 fixed the shape of the merger and left four things to be settled by building it:

- how many snapshots to keep, and at what precision, once the memory was measured;
- how the integration is cut into chunks, and what the page waits for;
- what v21's `frameOf` needs from the stars (the 90th percentile of their distances from the pair's centre) when the cameras of the two galaxies, which the CPU lays out, depend on it;
- what "the same" means for stars that are chaotic (ADR 0004's L1: at least 99.9% of instances within 0.05 plate px).

## Decision

1. **Initial conditions** are a compute pass on the counter RNG (`mergerInit`, one index per star, fixed draw numbers per role, so a change to one choice cannot shift another). Each galaxy's spin azimuth and log-spiral pitch, which v21 draws from the same sequential stream as its 11,000 stars, are galaxy-level draws on their own indices. The golden runner replays v21's (`compare/v21-merger.ts` runs v21's own `simulateMerger`, cut out of app23.js, to its initial conditions and reads them back); every other draw is a distribution, tested by two-sample Kolmogorov–Smirnov against v21's own initial conditions (`tests/unit/merger.test.ts`, 5 configurations, every coordinate and velocity component and the tidal map's disc coordinates: all KS ≤ 0.029 for samples of 4,000–7,000).
2. **The core track** is `coreTrack` in `src/sim/merger.ts`: v21's expressions in v21's order, f64. It equals v21's own function bit for bit (13 cases run in Chromium, every snapshot, worst relative deviation 0; `tests/vectors/merger.json`, `npm run vectors:merger`). The GPU reads core positions per kick (f32, one `vec4` per core).
3. **Chunks.** `integrate` runs 200 steps per submit (`CHUNK_STEPS`); between submits the model tier awaits `onSubmittedWorkDone` (the page passes a frame wait), and `ready.timeline` is true as soon as the way in is done, before the horizon. The default horizon is 417 more steps (about 1 ms on SwiftShader); 12,000 for a horizon of 30.
4. **Snapshots.** Timeline and future snapshots are f16 positions relative to the nearer core, two words a star (x and y, then z and which core), plus the core's position at that snapshot, added back when blended. The chosen moment and the horizon's end are f32. v21's own spacing is kept (about 90 snapshots in, 84 to 420 out) unless the two f16 tables together would pass **64 MiB**, when the future's spacing is coarsened first and then the timeline's (`snapshotBudget`). The numbers (`memoryBudget`):

   | | stars | timeline | future | closing f32 | total on the GPU |
   | --- | --- | --- | --- | --- | --- |
   | the Mice, defaults | 9,679 | 104 × 77 kB = 7.7 MiB | 83 × 77 kB = 6.1 MiB | 0.3 MiB | 14.7 MiB |
   | `mStars` 30,000, `mRatio` 1, horizon 30 | 26,400 | 19.7 MiB (v21's spacing) | 41.9 MiB (every second of v21's snapshots) | 0.8 MiB | 64.5 MiB |

   The f16 loss is about 2⁻¹¹ of a star's distance to its nearer core: the blends match v21's `snapAt` over v21's own frames to a median of 9 × 10⁻⁵ galaxy units and a p99 of 5 × 10⁻⁴ to 1.6 × 10⁻³ (0.05–0.15 plate px at the Mice's framing).
5. **The model tier's one read-back.** `frameOf` (centre, and the radius `max(rWhole, 0.8 · p90)` of the stars' distances from the cores' midpoint) sets the scale `MS.sc`, hence each galaxy's camera zoom `s0/84`, which feeds CPU-placed rows (vector matrices, ribbon and hatch uniforms, the lane cull's radius). The GPU therefore writes the distances of every fifth star at the chosen moment and at the horizon's end (`radii`, 2 × ⌈N/5⌉ floats, at most 12 kB) and the CPU reads them back once, in the model tier, after the integration, and sorts them. Nothing is read back on the frame path; changing `mTime` only re-blends snapshots and re-runs the view tier (ADR 0010).
6. **L1 for stars.** ADR 0004's L1 is met at the chosen moment where the dynamics are quiet and is restated for the merger as measured (`tests/gpu/merger.ts`, SwiftShader against the CPU twin, 9 cases, 9,679 stars each):

   | | median | p99.9 | worst star |
   | --- | --- | --- | --- |
   | the chosen moment, all 9 cases | 0 px | ≤ 0.04 px in 8 cases; 0.15 px in the 9th (`coalescing`, stage 4.5, friction 0.8) | 0.8 px (`coalescing`) |
   | tails (beyond 1.15 rmax of their core) | 0 px | ≤ 0.063 px | 0.11 px |
   | the horizon's end, quiet cases | 0 px | 0.03–0.22 px | 0.1–1.8 px |
   | the horizon's end, stars orbiting a merged pair for hundreds of steps (`coalescing`, a horizon of 6) | 0 px | 42 px, 0.95 px | 130 px, 15 px |

   At the chosen moment 99.43–100% of the stars are within 0.05 px (L1: 99.9%): eight cases meet it, `coalescing` does not. At the horizon's end 99.4–100% in the quiet cases. The CPU twin and v21's own f64 integrator, from identical starts, differ by a median of 3.5 × 10⁻⁶ galaxy units and a p99 of 5.6 × 10⁻⁵ at the Mice's chosen moment (worst 3.4 × 10⁻⁴: 0.03 px). The gates are therefore: at the chosen moment, at least 99% within 0.05 px and none 1 px out; at the horizon's end of a quiet case, at least 99%; chaotic cases are reported. The goldens do not depend on the individual stars: they compare ink, structure and counts (ADR 0015), and the CPU engine against WebGPU passes at the strict thresholds on every merger case, so what the chaos moves is below those thresholds.

## Consequences

- A merger costs one read-back of at most 12 kB in the model tier. If a platform ever forbids even that, the radii can be reduced on the GPU (31 passes of counting) at the cost of a kernel; the CPU would then read two floats.
- Long horizons never stall a frame: 60 chunks for a horizon of 30.
- Memory is bounded: 64 MiB of f16 snapshots plus 2–3 MiB of state, whatever the star count and horizon; the timeline's spacing is v21's at the default horizon.
- The `coalescing` horizon is chaotic by nature (stars on tight orbits round a merged pair); its drift is reported, not hidden.
