// @ts-check
/**
 * The pure half of the atlas packer (ADR 0006): cut a sheet into cells and build each cell's own
 * mip chain. No file system here, so unit tests can call it directly.
 *
 * Ink is the alpha channel of the sheets. Each level is an area-weighted box filter of the level
 * above, on alpha: alpha is coverage, so averaging it preserves the total ink of a cell at every
 * level (premultiplied by construction, since there is no colour). Odd sizes (48 → 24 → … → 3 → 1)
 * use fractional source footprints, so the filter stays coverage-preserving. Sizes follow
 * WebGPU's rule: level l is max(1, floor(size / 2^l)).
 */

/**
 * @param {number} w
 * @param {number} h
 * @returns {number} the full mip count down to 1 × 1
 */
export function mipCount(w, h) {
  return Math.floor(Math.log2(Math.max(w, h))) + 1;
}

/**
 * Cuts a sheet into layers of alpha.
 * @param {Uint8Array} rgba sheet pixels, RGBA8, row-major
 * @param {number} sheetWidth
 * @param {{ cellWidth: number, cellHeight: number, cols: number, n: number }} grid
 * @returns {Uint8Array} n layers of cellWidth × cellHeight alpha bytes, layer-major
 */
export function cutCells(rgba, sheetWidth, grid) {
  const { cellWidth: cw, cellHeight: ch, cols, n } = grid;
  const out = new Uint8Array(n * cw * ch);
  for (let i = 0; i < n; i++) {
    const x0 = (i % cols) * cw;
    const y0 = Math.floor(i / cols) * ch;
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++)
        out[i * cw * ch + y * cw + x] = rgba[((y0 + y) * sheetWidth + x0 + x) * 4 + 3] ?? 0;
  }
  return out;
}

/**
 * Area-weighted footprint of destination texel `d` on a source axis: [(index, weight)…], with
 * weights summing to 1.
 * @param {number} d
 * @param {number} src
 * @param {number} dst
 * @returns {[number, number][]}
 */
function footprint(d, src, dst) {
  const s = src / dst;
  const a = d * s;
  const b = (d + 1) * s;
  /** @type {[number, number][]} */
  const taps = [];
  for (let i = Math.floor(a); i < Math.ceil(b); i++) {
    const w = Math.min(b, i + 1) - Math.max(a, i);
    if (w > 0) taps.push([i, w / s]);
  }
  return taps;
}

/**
 * One level down, for every layer.
 * @param {Uint8Array} src layers × w × h
 * @param {number} w
 * @param {number} h
 * @param {number} layers
 * @returns {{ data: Uint8Array, width: number, height: number }}
 */
export function downsample(src, w, h, layers) {
  const dw = Math.max(1, w >> 1);
  const dh = Math.max(1, h >> 1);
  const fx = Array.from({ length: dw }, (_, x) => footprint(x, w, dw));
  const fy = Array.from({ length: dh }, (_, y) => footprint(y, h, dh));
  const out = new Uint8Array(layers * dw * dh);
  for (let l = 0; l < layers; l++) {
    const base = l * w * h;
    for (let y = 0; y < dh; y++)
      for (let x = 0; x < dw; x++) {
        let acc = 0;
        for (const [sy, wy] of fy[y] ?? [])
          for (const [sx, wx] of fx[x] ?? []) acc += (src[base + sy * w + sx] ?? 0) * wx * wy;
        out[l * dw * dh + y * dw + x] = Math.min(255, Math.round(acc));
      }
  }
  return { data: out, width: dw, height: dh };
}

/**
 * The full mip chain of a stack of layers.
 * @param {Uint8Array} level0 layers × w × h
 * @param {number} w
 * @param {number} h
 * @param {number} layers
 * @returns {{ data: Uint8Array, width: number, height: number }[]}
 */
export function mipChain(level0, w, h, layers) {
  const levels = [{ data: level0, width: w, height: h }];
  for (let i = 1; i < mipCount(w, h); i++) {
    const p = levels[i - 1];
    if (!p) break;
    levels.push(downsample(p.data, p.width, p.height, layers));
  }
  return levels;
}
