# tools/pack-atlas (M1)

Converts the bitmap sheets in `assets/drawings/bitmap/` into GPU-ready texture arrays: one r8 layer per cell, with a full mip chain per layer, and `strokes` as 60 layers of 512 × 64. Output goes to `assets-built/`, which is generated and not committed. The sources in `assets/` are never modified. See ADR 0006.
