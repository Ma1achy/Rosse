# tools/pack-atlas

`npm run prepare-assets` converts the bitmap sheets in `assets/drawings/bitmap/` into GPU-ready texture-array data: one r8 layer per cell (ink is the sheets' alpha), with a full mip chain per layer, and `strokes` as 60 layers of 512 × 64. It also writes the plate's paper texture (`assets/embedded-other/rosse_000_asset.png`, the image in v21's `.plate` CSS) as raw RGBA8. See ADR 0006. From M4 it also copies the vector drawings the engine reads on the CPU (`penlines`, the pen lines of the dust hatching) as JSON.

Output goes to `assets-built/`, which is generated and not committed. Vite serves it as its public directory, and `npm run dev` and `npm run build` run the packer first. The run is skipped when `assets-built/index.json` already matches the sources and the packer's own code (by SHA-256) and the packer version, and every output file exists; `--force` rebuilds. The sources in `assets/` are never modified.

## Format

- `assets-built/index.json`: for each atlas, its file, cell size, layer count, `repeatU` (strokes), the sheet's per-drawing metadata (`src`, `size`, `kind`, `thick`, …) and its levels (`width`, `height`, byte `offset` and `byteLength`); and the paper surface.
- `assets-built/atlas/<name>.bin`: the levels in order; within a level, the layers in order, each `width × height` bytes.
- `assets-built/surface/paper.bin`: 512 × 512 RGBA8.
- `assets-built/vector/<name>.json`: `{ n, src, vec }` of the vector sheet, unchanged (`vec[i]` holds lines `l`, dots `d` and blobs `b`, as in `assets/README.md`). `index.json` lists them under `vectors`.

## Mips

Each level is an area-weighted box filter of the level above, on alpha. Alpha is coverage, so averaging it keeps a cell's total ink at every level. Odd sizes (48 → 24 → 12 → 6 → 3 → 1, 96 → … → 3 → 1) use fractional source footprints, so they stay coverage-preserving. Sizes follow WebGPU: level _l_ is max(1, floor(size / 2^_l_)). The pure functions are in `pack-lib.js` and are unit-tested (`tests/unit/atlas.test.ts`).

## Layer limits

`pieces` has 638 cells, above WebGPU's default `maxTextureArrayLayers` of 256. The packer writes all layers into one file; `src/marks/atlas.ts` splits them across as many texture arrays as the device needs, and `src/gpu/device.ts` asks for the adapter's own limit, which is usually 2048 on real hardware (SwiftShader: 256, so the GPU test draws pieces across three arrays).
