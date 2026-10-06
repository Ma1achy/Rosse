# 19. Pen lines as v21's overlap quads, unioned per sample

Date: 2026-10-06

## Status

Accepted. Amends [0006](0006-drawing-storage-on-the-gpu.md) for pen lines (the dust hatching), which stays as written for everything else: its "parity mode" for the reference's overlap quads is what this ADR turns on.

## Context

ADR 0006 draws a vector drawing's segments as capsules with analytic coverage, clamp(w + 0.5 − d, 0, 1), composited one segment after another. The vector-lines spike chose it because, against a round-cap Canvas2D stroke of the whole path, it matched the shape best (IoU 0.92–0.97, against 0.89–0.90 for the reference's quads). That comparison was of one path's shape, drawn as one stroke.

QA (D2) found M4's dust hatching 18–41% heavier in ink than v21's, with a mean alpha over the hatched pixels of 0.74–0.77 against 0.62–0.66. With v21's dust choices replayed (ADR 0018), the excess is a steady 1.17–1.24 over ten hatch-only captures (stipple, lines and knots off; v21 with and without `dustScribble`, the difference on both sides).

The cause is how overlapping segments add up, not the width or the coverage of one segment:

- v21 draws each segment of a pen line as a quad, extended by 0.9 w at both ends "so the joins stay closed" (`expandVector`, app23.js:L1199–1213), half-width w = `PEN.line`/2 · 0.38, with alpha 1, into a WebGL canvas with `antialias: true`. SwiftShader gives it 4 samples per pixel. Measured in the capture browser, one such quad inks its area per unit of length (0.883 px for 2w = 0.912 px), as a capsule does (0.914). So one segment agrees.
- But the canvas blends per sample, and every quad has alpha 1: where quads overlap (at every join, and where hatches cross), a sample is covered once, whatever the number of quads. The hatching is the union of its quads, sampled four times per pixel.
- The engine blends per pixel. A pixel half covered by two capsules gets 0.5 + 0.5 · (1 − 0.5) = 0.75, not 0.5. Pen lines are short segments of a dense polyline, so most of their pixels are near a join.

On the same segments, a simulation of v21's per-sample union gives a mean alpha of 0.64–0.68 over hatched pixels, which is what the v21 captures show, and the engine's capsules give 1.21–1.25 times its ink, which is the excess QA measured. A per-pixel maximum instead of the over-composite gives 0.89–0.91 times, which is too light.

## Decision

Pen lines (the `capsules` layer: the dust hatching) are drawn as v21 draws them, and unioned per sample:

1. **Geometry.** Each segment a→b is v21's quad: from a − 0.9 w·t to b + 0.9 w·t along the unit direction t, half-width w across it. A segment of length 0 has no area and draws nothing, as in v21.
2. **Samples.** Each pixel has v21's 4 sample positions (the standard 4× pattern: (−0.125, −0.375), (0.375, −0.125), (−0.375, 0.125), (0.125, 0.375) from the pixel centre). A quad covers a sample when the sample lies inside it.
3. **Union.** The layer's quads are drawn into a coverage target of four channels, one per sample, each 0 or 1, with MAX blending: a sample is covered if any quad covers it. Then the layer is resolved onto the ink: coverage = the number of covered samples / 4, alpha = coverage · gain, premultiplied ink over what is there. The CPU rasteriser does the same with a 4-bit mask per pixel.
4. Everything else (ribbons, sprites, pieces) is unchanged, and so are the hatches' dots and blobs (sprites, as in v21).

The capsule model of 0006 stays for other vector drawings until their milestones (M5) decide; this ADR is the precedent for drawings whose v21 counterparts are dense polylines.

## Consequences

- Hatch ink matches v21's per unit of length and at the joins (docs/milestones/m4/README.md has the ratios).
- A pen-line layer costs a second render target (rgba8unorm, the plate's size) and two more passes: the coverage pass, and a full-plate resolve. Only scenes with hatches pay it.
- Coverage is quantised to quarters, as v21's is. The ink edge of a pen line is as v21's: aliased to four levels, which is the reference's look.
- The GPU and the CPU decide each sample from the same f32 arithmetic (the quad's frame at the sample), so they agree sample for sample on SwiftShader; on other adapters, fused multiply-adds can move a sample that lies on a quad's edge (ADR 0004's L1).
