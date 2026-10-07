# 24. Plates are present-tier passes over population-tagged layers

Date: 2026-10-06

## Status

Proposed, awaiting the owner's sign-off. Implements the plates row of the tier table in [0010](0010-data-flow-and-cache-tiers.md) and the "ink target holds premultiplied ink, the composite colours it" split of [0007](0007-render-pipeline.md). It changes neither.

## Context

v21 prints a galaxy in one of three ways (`P.plates`, app23.js:L1302–1307):

- `ink`: `scene()` once, every layer in the key ink;
- `slip`: `scene()` four times, three process plates (cyan, magenta, yellow) each slipped a little and printed light, then the key ink. Cyan at gain 0.32 and offset (−3.6, −1.2) plate units, magenta at 0.3 and (3.4, 1.0), yellow at 0.42 and (0.6, 3.8), then the theme's key ink at gain 1;
- `colour`: `scene()` once, with each layer in the ink of its population: `old` (the stipple's old dots, the streams' marks and the drawn core) in the old ink, `disc`, `young` (the stipple's young dots, the pieces and the sparkle stars), `hii` (the knots), and everything else, including the line work (every vector drawing, its bars, rings and arcs too, which v21 expands into the line layer) and `star`, in the key ink.

The inks of the `colour` plate and the key ink come from the theme's palette, so the Chalkboard's are the lighter, warmer ones. The process inks do not change with the theme.

ADR 0010 gives plates to the present tier: switching them must not re-run anything below it. ADR 0007 has the ink target hold ink α with (1, 1, 1) as its colour, which the composite turns into the palette's key ink, so that a change of surface re-runs the composite alone. That cannot hold for coloured plates: a colour plate's target holds several colours.

## Decision

1. **Layers carry their population.** Every `InkLayer` has an optional `pop` (`old`, `disc`, `young`, `hii`, `star` or, when absent, `line`). The engine sets it where `scene()` chooses the ink: the stipple's classes by `STIPPLE_LAYERS` (old, disc, young; knots as `hii`; sparkle stars as `young`), the pieces as `young`, the streams' dots and knots and the drawn core as `old`. The vector drawings, the stroke ribbons, the hatching and the pen lines stay `line`. The sky's `star` layer comes with M7.
2. **A plates mode is a list of passes** (`render/plates.ts` `platePasses`): each pass gives the ink of a population, a plate offset and a gain, from the palette. The ink target is cleared and every layer is drawn once per pass, in `scene()` order, so the passes of `slip` print one over the other as v21's canvas does.
3. **Batches keep their instance data and make one set of uniforms per pass style** (`render/pass-style.ts`). The sprite and ribbon shaders gain an offset in plate units, added before the scale as v21 adds `uOff` to the position, and the ink and gain were already per batch. A batch makes the uniform buffer and bind group of a style the first time that style is drawn and keeps it, so switching plates builds a few uniform buffers and re-records one render pass. No storage buffer, instance buffer or compute pass is touched (`tests/gpu/plates.ts` counts the buffers created).
4. **The target holds the colours on the coloured plates.** On `slip` and `colour` the passes carry the real inks, so the composite's key ink is white (`compositeInk`); on `ink` nothing changes. A change of surface re-inks the coloured plates, because the palette is part of their ink; on `ink` it still re-runs only the composite. Both belong to the present tier, whose inputs ADR 0010 lists as the surface, the plates mode, the DPR and the canvas size.
5. **Both engines do the same.** `CpuRenderer.drawInk` runs the same passes with the rasteriser, which takes the offset, the ink and the gain per call; the offset is added in f32 before the scale, as the shaders do, and is zero on the `ink` plate, so the engine's hashes of the `ink` goldens are unchanged.
6. **The page** has a Plates menu (v21's: ink, slipped CMY plates, colour by population). The choice is a parameter of the present tier: `dirtyTier` is `present`, the frame runs no tier, and the plate is re-inked and composited.

## Consequences

- The `Plates slipped` and `Stellar populations` presets draw as v21's, on both surfaces. The golden alpha of a slipped plate is the union of its four passes, as v21's canvas alpha is.
- `tests/unit/plates.test.ts` compares the passes, the population inks and the ink images with v21's own draw calls (`tools/capture-reference/plates.mjs`), with negative controls: a plate slipped a pixel, a gain 30% off and a wrong ink all fail.
- SVG export for pen plotters (M12) prints the `ink` plate, as v21's `exportSVG` does.
- A future plate (a duotone, a riso overprint) is a new list of passes.
