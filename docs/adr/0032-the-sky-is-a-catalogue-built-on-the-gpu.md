# 32. The sky is a model-tier catalogue, drawn by GPU passes

Date: 2026-10-06

## Status

Accepted. Builds on [0010](0010-model-view-tiers.md) (tiers) and the M5 vector-expand path.

## Context

v21's deep field is up to 6,000 galaxies, each a drawing with up to 150 dots and a few blobs, placed in perspective (CAM 30), plus a drawing at pen scale 0.42, foreground stars and companions. Up to 6,000 × (267 vertices + 150 dots + 6 blobs) rows is far more than the view needs: most galaxies are off screen or smaller than a pixel.

## Decision

1. **The catalogue is a model-tier product** (`describeSky`, src/model/sky.ts): the choices v21 makes once per seed (positions, drawings, orientations, sizes, dot picks), packed as `BG_WORDS` = 12 and `FG_WORDS` = 8 floats per record. A camera move never rebuilds it.
2. **The view culls and draws on the GPU.** `sky_cull` marks the visible galaxies, the stipple's scan compacts them, `sky_dots` makes up to 150 dots per galaxy (slots a galaxy does not use get zero-size instances), `rows_sky` writes three rows per galaxy (outline, dots, blobs) as `VInst` records at fixed strides, and the vector expansion draws them with the `INACTIVE` guard. `sky_fg` does the same for the foreground stars. The CPU twin (src/fallback/kernels/sky.ts) runs the same arithmetic in f32 (`Math.fround`, `cosF`, `sinF`), so the CPU and WebGPU drawings agree at L1.
3. **Dispatch and draw sizes follow the view.** `skyBound` (CPU, 3 % slack) bounds the visible galaxies and `visibleCapacity = min(n, ceil(0.35 n) + 32)` sizes the compaction, so that a view that shows 400 galaxies does not dispatch 6,000 × 150 dots. `GpuVectors.setView` takes per-view live slot counts.
4. **No decimating ribbon LOD.** The measured vertex load of the full field (tests/gpu/sky.ts prints the timings) is within the budget of the CPU and SwiftShader renderers once the dispatches are sized per view; a level of detail would change the drawing for no gain, so it is not built. It stays an option if a later milestone adds vertices per galaxy.
5. **Weak lensing is a hook.** `weak_lens` is the identity here and is the one place M9 applies the shear and magnification to the field.

## Consequences

- The sky costs a few passes and a few kilobytes of model data; a seed change rebuilds the catalogue (CPU, milliseconds).
- The used-drawings count includes the field's galaxies, dots, foreground stars and companions.
