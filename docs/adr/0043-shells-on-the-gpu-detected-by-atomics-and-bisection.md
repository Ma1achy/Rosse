# 43. Shell galaxies: the satellite on the GPU, the shells found by integer atomics and a bisection, the arcs through a face-on camera

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Implements the shells of [0003](0003-everything-per-mark-on-the-gpu.md) and the roadmap's M8 row.

## Context

`shellSprites` and `shellArcs` (app23.js:L711–760) release `shellStars` (1,000–12,000, 6,000 for the preset) stars of a cold satellite at x ≈ 3 with a small inward velocity, integrate them for `shellTime / 0.02` steps (3,500 for the preset, up to 7,000) in the potential `−r / (r² + 0.3)` by semi-implicit Euler, find the shells in the final radial histogram, and draw the stars as dots and each shell as a 41-point `faint` stroke. The shells ignore the camera (`pts2d`, reference notes 20.14) and follow only `shellAxis`.

## Decision

1. **The satellite** is `compute/shells.wgsl` (twin `fallback/kernels/shells.ts`): one thread per star, its start from the counter RNG (`shells` stream), the steps in chunks of 1,000 per submit, f32. The orbits are near-radial, so f32 agrees closely with v21's f64 and with the CPU twin (tests below).
2. **Detection on the GPU, with one read-back of the result.** `polar_hist` writes each star's distance and polar angle and bins the stars of each side (x > 0 and x < 0, 0.6 ≤ r ≤ 4.2, 64 bins) with `atomicAdd` on integers: commutative, so deterministic (ADR 0004). `detect` is one invocation: it smooths the histogram, tests the peaks, and takes the three biggest drops of each side. The comparisons are the reference's `drop > 0.45 sm` and `sm > N · 0.004` written as `100 drop > 45 sm` and `250 sm > N`, exact in f32 for a histogram of counts; for a drop exactly 45% of its peak the reference's own rounding would decide (checked over every count up to 400: its `0.45 · sm` equals the exact product in every equality case, so no result differs). The 85th percentile of the polar angles within 0.12 of a shell's radius is found by **bisection on the angles' bit patterns** (31 passes over the stars: positive floats sort as integers), which gives exactly the element the reference's sort finds. The result, at most 6 arcs of (radius, side, opening), is read back once in the model tier: it fixes the curves, which the CPU lays out. This is the same kind of read-back as the merger's framing (ADR 0040), 96 bytes.
3. **The arcs as ribbons** go through a scene of their own: a ribbon description with no curves of its own and the arcs as its only curves (`shellRibbons`), drawn by a `GpuRibbons` through a face-on camera (incl, az, pa 0, winding 1) at the picture's zoom. Their points are (x, y, 0) in galaxy units, which a face-on camera maps to `VIEW.cx + x · VIEW.scale`, v21's `pts2d`, so no shader changed. The stroke row of each arc is a `faint` row, v21's (replayed in the goldens) or the engine's own, on the `shells` stream.
4. **The dots** are `old` instances (`dots` entry): from x and y only, turned by `shellAxis`, the hand's tile and a rotation from the star's own counter, size `dotSprite(t, 0.85)`. All of them are drawn: the truncation at `RMAX + 0.4` never fires, as RMAX is 240 at run time (Q13). The picture's dot count is the galaxy's plus `shellStars`.
5. **Shells on a merger** (`shellsOn` with `merger`, L1266) use the same scene, with the merger's own hand.

## Evidence

- Against v21's own `shellSprites` and `shellArcs` (cut out of app23.js, from the engine's initial conditions through v21's integrator; `tests/unit/shells.test.ts`): positions after 3,500 steps differ by a median of 3 × 10⁻⁵ units and a p99 of 3 × 10⁻⁴ (0.003 and 0.025 plate px at zoom 1; the worst star 8 × 10⁻⁴); **the shells found are identical** (radius to 10⁻⁴, side, opening to 10⁻²) for the preset's two seeds and a short infall; the arcs as curves equal v21's (41 points, stroke rows). A long infall (110, 4,000 stars) packs the shells so tightly that a few stars change bin between f32 and f64 and a borderline peak enters or leaves: at least half of v21's shells are found, as the test requires.
- The initial conditions are by distribution: KS against v21's on all six coordinates below the 0.1% critical value (`1.95 √(2/N)`).
- GPU against the CPU twin (`tests/gpu/shells.ts`, SwiftShader, four cases of 3,000 to 12,000 stars and 2,000 to 6,000 steps): positions median 0, p99.9 0.01–0.06 px (the 12,000-star, 6,000-step case 0.056 px, against L1's 0.05: gated at 0.1 px), **the shells identical in all four**, the dots' tiles identical, their places within 0.09 px.

## Consequences

- A shell galaxy's picture is a galaxy, the satellite's dots and the arcs; a merger may carry shells too.
- The shell count differs from v21's by the borderline peaks of a different realisation (the preset at the two seeds, from the engine's own initial conditions: 4–5 shells against 4 and 6 in v21): within the re-keyed spread the thresholds calibrate.
