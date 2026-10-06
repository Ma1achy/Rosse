// @ts-check
/**
 * `npm run prepare-assets`: converts the bitmap sheets in assets/drawings/bitmap/ into GPU-ready
 * texture-array data under assets-built/ (generated, not committed; ADR 0006).
 *
 * For each sheet `<name>.png` + `<name>.json`:
 * - one r8 layer per cell (alpha only: ink is the alpha channel), row-major as the sheet;
 * - `strokes` is 60 layers of 512 × 64 (one stroke per row), sampled with repeat along u;
 * - a full mip chain per layer (pack-lib.js), so no cell bleeds into another.
 *
 * Also the plate's paper texture (assets/embedded-other/rosse_000_asset.png, the image in
 * head23.html's `.plate` rule) as raw RGBA8, so the GPU and CPU paths read identical bytes.
 *
 * Also every vector sheet (from M5: all 12, 429 drawings; M4 read only `penlines`), copied as
 * JSON to assets-built/vector/<name>.json: the records (lines, dots, blobs), their sources, and
 * the per-drawing metadata the part placement reads (`type`, `winding`, `pitch` of `whole`,
 * `meta` of `arms`, `solid` of `bars`, `kind` of the others), unchanged.
 *
 * Output: assets-built/atlas/<name>.bin (levels in order; within a level, layers in order, each
 * width × height bytes), assets-built/surface/paper.bin, and assets-built/index.json describing
 * them. Vite serves assets-built/ as its public directory, so the page fetches `index.json`.
 * The run is skipped when the index already matches the sources (by SHA-256) and packer version.
 * The sources in assets/ are never modified.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import pngjs from 'pngjs';
import { cutCells, mipChain } from './pack-lib.js';

const PACKER_VERSION = 4;
const ROOT = resolve(import.meta.dirname, '../..');
const SHEETS = join(ROOT, 'assets/drawings/bitmap');
const PAPER = join(ROOT, 'assets/embedded-other/rosse_000_asset.png');
const OUT = join(ROOT, 'assets-built');
const NAMES = ['dots', 'knots', 'stars', 'cores', 'fgstars', 'pieces', 'strokes'];
/** Every vector sheet (M5), in the reference's `MAGNIFIED` order (app23.js:L1099). */
const VECTORS = [
  'arms',
  'whole',
  'env',
  'rings',
  'bars',
  'arcs',
  'shells',
  'trails',
  'penlines',
  'companions',
  'misc',
  'sstars',
];
/** The per-drawing metadata copied with the records (assets/README.md). */
const VECTOR_META = ['type', 'winding', 'pitch', 'lineish', 'meta', 'solid', 'kind'];
const VECTOR_DIR = join(ROOT, 'assets/drawings/vector');

/** @param {Buffer} b */
const sha = (b) => createHash('sha256').update(b).digest('hex');
/** @param {string} p */
const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');

// the packer's own code counts as a source: a change to the mip filter rebuilds everything
const sources = [
  ...NAMES.flatMap((n) => [`${n}.png`, `${n}.json`].map((f) => join(SHEETS, f))),
  ...VECTORS.map((n) => join(VECTOR_DIR, `${n}.json`)),
  PAPER,
  join(import.meta.dirname, 'pack.mjs'),
  join(import.meta.dirname, 'pack-lib.js'),
];
const sourceHash = sha(Buffer.concat(sources.map((f) => readFileSync(f))));

const indexPath = join(OUT, 'index.json');
if (existsSync(indexPath) && !process.argv.includes('--force')) {
  try {
    const old = JSON.parse(readFileSync(indexPath, 'utf8'));
    /** @type {string[]} */
    const files = [
      ...Object.values(old.atlases ?? {}).map((a) => /** @type {{ file: string }} */ (a).file),
      old.surfaces?.paper?.file,
      ...Object.values(old.vectors ?? {}).map((a) => /** @type {{ file: string }} */ (a).file),
    ];
    const present = files.length > 1 && files.every((f) => f && existsSync(join(OUT, f)));
    if (old.packer === PACKER_VERSION && old.sourceHash === sourceHash && present) {
      console.log('assets-built/ is up to date');
      process.exit(0);
    }
  } catch {
    // rebuild
  }
}

mkdirSync(join(OUT, 'atlas'), { recursive: true });
mkdirSync(join(OUT, 'surface'), { recursive: true });
mkdirSync(join(OUT, 'vector'), { recursive: true });

/** @type {Record<string, unknown>} */
const atlases = {};
for (const name of NAMES) {
  const pngBytes = readFileSync(join(SHEETS, `${name}.png`));
  const meta = JSON.parse(readFileSync(join(SHEETS, `${name}.json`), 'utf8'));
  const png = pngjs.PNG.sync.read(pngBytes);
  const strokes = name === 'strokes';
  const grid = strokes
    ? { cellWidth: meta.w, cellHeight: meta.h, cols: 1, n: meta.n }
    : { cellWidth: meta.cell, cellHeight: meta.cell, cols: meta.cols, n: meta.n };
  const rows = Math.ceil(grid.n / grid.cols);
  if (png.width < grid.cols * grid.cellWidth || png.height < rows * grid.cellHeight)
    throw new Error(`${name}: sheet ${png.width}×${png.height} is smaller than its grid`);
  const level0 = cutCells(new Uint8Array(png.data), png.width, grid);
  const chain = mipChain(level0, grid.cellWidth, grid.cellHeight, grid.n);
  let offset = 0;
  const levels = chain.map((l) => {
    const e = { width: l.width, height: l.height, offset, byteLength: l.data.length };
    offset += l.data.length;
    return e;
  });
  const file = `atlas/${name}.bin`;
  writeFileSync(join(OUT, file), Buffer.concat(chain.map((l) => l.data)));
  atlases[name] = {
    file,
    cellWidth: grid.cellWidth,
    cellHeight: grid.cellHeight,
    layers: grid.n,
    cols: grid.cols,
    repeatU: strokes,
    levels,
    // the sheet's per-drawing metadata (src, size, kind, thick, …), unchanged
    meta: Object.fromEntries(
      Object.entries(meta).filter(([k]) => !['cell', 'cols', 'n', 'w', 'h'].includes(k)),
    ),
    source: rel(join(SHEETS, `${name}.png`)),
    sha256: sha(pngBytes),
  };
  console.log(
    `${name.padEnd(8)} ${String(grid.n).padStart(3)} layers of ${grid.cellWidth}×${grid.cellHeight}, ${levels.length} levels, ${offset} bytes`,
  );
}

// vector drawings: the records (lines, dots, blobs), their sources and metadata, unchanged
/** @type {Record<string, unknown>} */
const vectors = {};
for (const name of VECTORS) {
  const bytes = readFileSync(join(VECTOR_DIR, `${name}.json`));
  const v = JSON.parse(bytes.toString('utf8'));
  const file = `vector/${name}.json`;
  const meta = Object.fromEntries(VECTOR_META.filter((k) => k in v).map((k) => [k, v[k]]));
  writeFileSync(join(OUT, file), JSON.stringify({ n: v.n, src: v.src, ...meta, vec: v.vec }));
  vectors[name] = {
    file,
    count: v.n,
    source: rel(join(VECTOR_DIR, `${name}.json`)),
    sha256: sha(bytes),
  };
  console.log(`${name.padEnd(10)} ${String(v.n).padStart(3)} vector records`);
}

const paperBytes = readFileSync(PAPER);
const paper = pngjs.PNG.sync.read(paperBytes);
writeFileSync(join(OUT, 'surface/paper.bin'), paper.data);
console.log(`paper    ${paper.width}×${paper.height} RGBA8`);

const index = {
  packer: PACKER_VERSION,
  sourceHash,
  atlases,
  vectors,
  surfaces: {
    paper: {
      file: 'surface/paper.bin',
      width: paper.width,
      height: paper.height,
      format: 'rgba8unorm',
      source: rel(PAPER),
      sha256: sha(paperBytes),
    },
  },
};
writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
console.log(`wrote ${rel(indexPath)}`);
