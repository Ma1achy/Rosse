# 7. Render pipeline: ordered ink layers into an offscreen target, then composite onto the surface

Date: 2026-10-03

## Status

Accepted

## Context

The reference draws every layer straight into a transparent WebGL canvas with premultiplied alpha and `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`, in a fixed order (`scene()`, app23.js:L1289–1301). The paper is CSS behind the canvas: the field colour with a texture blended in `multiply`, and a 1 px inset rim. The Chalkboard is `#262b28` with the texture in `soft-light`, a darker rim and a 60 px inset vignette (head23.html:29 and the later `.plate` rules). The `overlay` rules in head23.html apply only under `html[data-theme="dark"]`, which v21 never sets (app23.js:L1149). The canvas is sized to its CSS width × device pixel ratio, with the ratio capped at 2 (app23.js:L1224). Colour modes repeat the scene:

- `slip`: four passes (cyan, magenta and yellow offset by a few pixels at gains 0.3–0.42, then the key ink);
- `colour`: one pass with a different ink per population.

MSAA comes from the canvas (`antialias: true`).

Two properties matter:

- **With one ink, "over" compositing of ink is commutative.** Each mark multiplies the remaining paper by (1 − a), so order changes only rounding. Order matters only _across_ inks: the colour plates, and Chalkboard's lighter population inks.
- **Exporting a plate** (PNG at print size, and later SVG) needs the ink as a layer of its own, independent of the screen.

## Decision

- An **ordered layer list** (`src/render/layers.ts`) mirrors `scene()` one for one. Each layer has its source (a sprite atlas or ribbon buffer), its population (for plates) and its ink-edge thresholds.
- **Ink pass:** layers render into an offscreen `rgba16float` target at plate resolution × device pixel ratio (capped at 2, as v21, and re-rendered when the plate is resized or the ratio changes), premultiplied, `ONE, ONE_MINUS_SRC_ALPHA`, **without MSAA**. Bitmap marks are anti-aliased by their own texture alpha (the quad's border is transparent ink), and ribbons by analytic capsule coverage (ADR 0006, spike variant A2). Not needing MSAA also makes the CPU fallback's rasteriser simple and exact (ADR 0011). Half floats keep the colour plates' low gains from banding and make the order rounding negligible. Vertex positions are in plate units (800 × 800) as in the reference, so every size, including the pen, scales with the plate.
- **Two pipelines:** instanced quads for bitmap marks (`render/sprite.wgsl`, 4 vertices per instance from the instance buffer), and pulled-vertex ribbons for strokes and vector lines (`render/ribbon.wgsl`). Instance and vertex counts come from compute through `drawIndirect`.
- **Composite pass** (`render/composite.wgsl`): draws the surface, then the resolved ink over it, into the swap chain.
  - Paper is the plate's field colour with the paper texture from the pack in `multiply`, and the inset rim `rgba(29,27,25,.16)`, reproducing the CSS. The field is `#e6dece`, the value of `--field` that v21's `.plate` rule uses (the pack's design-token table lists `#e2d9c6`). Inset box-shadows are computed analytically: the shadow covers the plate except a hole inset by its spread, with the hole's edges blurred by a Gaussian of σ = blur / 2, as Chromium does. M1 checks the composite against screenshots of v21's own empty plate (`npm run test:gpu`).
  - **Chalkboard is a palette swap plus a surface swap:** the ink colours come from the reference's dark palette (app23.js:L1145), and the surface is `#262b28` with the texture in soft light, the rim `rgba(29,27,25,.35)` and the vignette `inset 0 0 60px rgba(0,0,0,.35)`.
  - The ink target is unchanged by the surface, so switching surfaces never rebuilds anything (present tier, ADR 0010).
- **Plates:** `slip` is four ink passes with per-pass offset and gain. `colour` selects the ink per layer population. Both reuse the same instance buffers.

## Consequences

- The paper texture moves from CSS into the renderer, so exports and screenshots include it exactly.
- `rgba16float` without MSAA costs 8 bytes per pixel: about 20 MB at 1600 × 1600 (plate at DPR 2).
- Over-blending capsule ribbons darkens their joins slightly: the spike measured +8% ink at 48 px. The spike's A2m variant draws the line layers of one drawing with `max` blending into their own target and then composites them over. It removes that and matched the SDF exactly. We adopt it only if the golden pen-weight metric (ADR 0013) shows the excess at parity sizes.
- Order within one ink is kept anyway, for bit-exactness at L0 (ADR 0004).
