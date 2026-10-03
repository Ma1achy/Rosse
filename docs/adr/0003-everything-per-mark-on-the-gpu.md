# 3. Everything per mark runs on the GPU; the CPU only describes the scene

Date: 2026-10-03

## Status

Accepted. The owner asked for "everything on the GPU" at kickoff.

## Context

Today every stage runs on the CPU on every render, including every frame of an orbit drag. Figures are on SwiftShader (docs/reference-notes.md and `docs/data/reference-profile.json`):

- A default spiral is about 8k dots, 1.6k drawn stars, about 100 ribbon segments and a few thousand vector-line quads, and takes about 300 ms per render.
- A galaxy cluster lens is about 14k dots, 4k drawn stars and 1k knots, and takes 1.6 s.

The work splits into two kinds:

1. **Scene description**: a few hundred numbers. These are:
   - per-galaxy variation (`makeVariation`, L96);
   - arm, spur and curve control points (`curves`, L768);
   - which drawings to place, and where (`parts`, L987);
   - the lens halos (`lensModel`, L594);
   - the sky catalogue (`buildSky`, up to 6,000 + 2,500 objects, L867);
   - the merger's two-core track (two bodies, at most about 2,000 steps).

   It is sequential, branchy, and costs microseconds.

2. **Per-mark work**: tens of thousands to a few hundred thousand items. These are:
   - stipple sampling with rejection (`generate`, L221);
   - projection and screen-space culls;
   - ribbon and piece expansion (`buildCurves`, L802);
   - vector expansion (`expandVector`, L1190);
   - test-star integration (11k stars by default and up to 30k; up to 1,400 steps to the chosen moment, plus 417 steps into the future at the default horizon, or up to about 12,000 at the maximum horizon of 30; L340–376);
   - the lens grid (44k–63k vertices), triangle binning (88k–125k triangles), image queries and lensed-mark emission (L608–670);
   - deep-field per-galaxy dots (up to 6,000 galaxies × 10–150 dots, L891);
   - star glare (up to about 9,000 dots per star, L408).

The alternatives considered were:

- **(a)** Keep the model on the CPU (a straight port) and use the GPU only to draw. This is low risk, but orbiting still rebuilds on the CPU, and it is not what was asked.
- **(b)** Everything on the GPU, including scene description: a compute pass with one thread for each sequential step. This is possible, but harder to test, and it gains nothing measurable.
- **(c)** Everything per mark on the GPU, with scene description in shared TypeScript.

## Decision

Option (c).

- The CPU turns parameters into a **scene description**: a few kilobytes of uniforms and small storage buffers (variation, curve control points, part placements, lens halos, sky catalogue, merger core track). This code is shared, unchanged, by the WebGPU engine and by the CPU fallback (ADR 0011).
- **Everything per sample, per mark, per vertex or per pixel runs in WGSL compute or render passes:**
  - model sampling;
  - projection and culls;
  - instance generation and compaction;
  - curve, ribbon and piece expansion;
  - vector expansion and warps;
  - merger test-star integration and the tidal warp grid;
  - the lens grid, bins, queries and emission;
  - deep-field galaxies;
  - star glare, spikes, rings and bleed;
  - shells.
- Nothing produced by a compute pass is read back to the CPU on the frame path. Counts reach draws through `drawIndirect`. Read-back happens only in tests and for statistics.

Expected GPU costs on a mid-range integrated GPU, to be measured in M10:

| work | items | expected |
| --- | --- | --- |
| stipple sampling (model tier) | 10–51k samples (stars ≤ 40,000 × (1 + 0.28·starMix)), ≤ 30 tries each | < 1 ms, only on parameter change |
| projection, culls and compaction (view tier) | 10–51k | < 0.3 ms per frame |
| ribbons, pieces and vectors (view tier) | ≤ 50k segments | < 0.3 ms per frame |
| merger integration (model tier) | 11–30k stars × ≤ 1,817 steps (default horizon) | 5–30 ms once per merger parameter change; long horizons (up to about 13k steps) run spread over frames |
| lens grid and bins (model tier) | 63k vertices, 125k triangles | < 2 ms, once per lens change |
| lens queries and emission (view tier) | ≤ 30k queries | < 0.5 ms per frame |
| drawing | ≤ 100k instanced quads, 4× MSAA | 1–2 ms per frame |

## Consequences

- An orbit frame costs only the view and present tiers (ADR 0010) and needs no CPU work beyond uniforms.
- Sequential algorithms in the reference have to become parallel ones:
  - rejection sampling with shared RNG streams (handled by ADR 0004);
  - the lens's greedy branch tracking along a curve (one thread per curve);
  - the merger's 4-nearest-neighbour warp (a grid search per warp vertex, ties broken by index);
  - the bright-star "breathing room" filter (a grid pass).
- Scene description stays in TypeScript, so it is unit-testable in Node and shared with the fallback.
- Debugging GPU passes needs read-back tooling. A `debug/readback` helper and per-pass statistics arrive in M2.
