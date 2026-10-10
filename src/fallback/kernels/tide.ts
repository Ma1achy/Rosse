/**
 * The tidal map of a merger on the CPU engine (ADR 0009, 0011): the twin of
 * src/shaders/common/tide.wgsl, src/shaders/compute/tide.wgsl and src/shaders/compute/tide-apply.wgsl,
 * function for function. Reference: `tidal(g, flip)` of mergerSprites (app23.js:L536–551), the grid
 * and `post` of render() (L1241–1248), the tears of buildCurves (L832–834) and expandVector (L1207–1208).
 *
 * One buffer of 32-bit words, floats stored as their bits, so the GPU binds the same words:
 *
 * | words | what |
 * | --- | --- |
 * | 0–8 | header: n, star table, bin offsets, bin ids, grids (word offsets), plate centre x and y, n0, depth scales |
 * | star table | 4 words per star: plate x, plate y (this view), initial DX, DY |
 * | bin offsets | 2 galaxies × 441 cells + 1: the first slot of each cell's stars in the ids |
 * | bin ids | the star indices, cell by cell, in index order within a cell |
 * | grids | 2 galaxies × 49 × 49 vertices × 3: the map sampled once (plate x, y and the mark scale of the depth, ADR 0088) |
 * | depth scales | 1 word per star: the perspective scale of its depth in this view (1 without `persp`) |
 */
import type { StructLayout } from '../../marks/instance';

const f = Math.fround;

export const TIDE_CELLS = 21;
export const TIDE_CELL_COUNT = 441;
export const TIDE_GN = 48;
export const TIDE_GV = 49;
/** header words */
export const TIDE_HEADER = 9;
/** words per grid vertex: plate x, plate y, depth scale */
export const TIDE_VW = 3;
/** v21's tear thresholds: along or across a ribbon (L834), and the ribbons' SEAMMAX (L1250) */
export const TEAR = 1.8;
export const SEAMMAX = 30;

/** The `TJob` uniform of tide-apply.wgsl. */
export const TJOB_LAYOUT: StructLayout = {
  name: 'TJob',
  size: 32,
  align: 4,
  fields: [
    ['g', 'u32'],
    ['n', 'u32'],
    ['use_args', 'u32'],
    ['args_index', 'u32'],
    ['r2', 'f32'],
    ['pad0', 'u32'],
    ['pad1', 'u32'],
    ['pad2', 'u32'],
  ].map(([name, type], i) => ({
    name: name as string,
    type: type as 'u32' | 'f32',
    offset: i * 4,
    size: 4,
  })),
};

export interface TideWords {
  total: number;
  starOff: number;
  offOff: number;
  idsOff: number;
  gridOff: number;
  dkOff: number;
}

/** The word offsets of a tide buffer for `n` stars. */
export function tideWords(n: number): TideWords {
  const starOff = TIDE_HEADER;
  const offOff = starOff + n * 4;
  const idsOff = offOff + 2 * TIDE_CELL_COUNT + 1;
  const gridOff = idsOff + n;
  const dkOff = gridOff + 2 * TIDE_GV * TIDE_GV * TIDE_VW;
  return { starOff, offOff, idsOff, gridOff, dkOff, total: dkOff + n };
}

/** The bin of an initial coordinate pair: v21's `floor((d + 1) / 2 · 20)` (L537). */
export function tideCell(dx: number, dy: number): number {
  const c = (d: number) => {
    const v = Math.floor(f(f(f(d + 1) / 2) * 20));
    return v < 0 ? 0 : v > 20 ? 20 : v;
  };
  return c(dy) * TIDE_CELLS + c(dx);
}

export class TideData {
  readonly words: Uint32Array<ArrayBuffer>;
  readonly fl: Float32Array<ArrayBuffer>;
  readonly L: TideWords;

  constructor(
    readonly n: number,
    readonly n0: number,
    cx = 400,
    cy = 400,
  ) {
    this.L = tideWords(n);
    const buf = new ArrayBuffer(this.L.total * 4);
    this.words = new Uint32Array(buf);
    this.fl = new Float32Array(buf);
    this.words.set([n, this.L.starOff, this.L.offOff, this.L.idsOff, this.L.gridOff], 0);
    this.fl[5] = cx;
    this.fl[6] = cy;
    this.words[7] = n0;
    this.words[8] = this.L.dkOff;
    this.fl.fill(1, this.L.dkOff, this.L.dkOff + n);
  }

  /** `init_table`: the stars' initial disc coordinates, from `ic` (DX, DY, R0, 0 per star). */
  setInitial(ic: ArrayLike<number>): void {
    for (let i = 0; i < this.n; i++) {
      this.fl[this.L.starOff + i * 4 + 2] = ic[i * 4] as number;
      this.fl[this.L.starOff + i * 4 + 3] = ic[i * 4 + 1] as number;
    }
  }

  /** `bin_count`, `bin_scan` and `bin_fill`: the bins, in index order within a cell. */
  buildBins(): void {
    const { starOff, offOff, idsOff } = this.L;
    const cells = 2 * TIDE_CELL_COUNT;
    const counts = new Uint32Array(cells);
    const cellOf = new Uint32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const c = tideCell(
        this.fl[starOff + i * 4 + 2] as number,
        this.fl[starOff + i * 4 + 3] as number,
      );
      const slot = (i >= this.n0 ? TIDE_CELL_COUNT : 0) + c;
      cellOf[i] = slot;
      counts[slot] = (counts[slot] as number) + 1;
    }
    this.words[offOff] = 0;
    for (let c = 0; c < cells; c++)
      this.words[offOff + c + 1] = (this.words[offOff + c] as number) + (counts[c] as number);
    const next = new Uint32Array(cells);
    for (let i = 0; i < this.n; i++) {
      const slot = cellOf[i] as number;
      this.words[idsOff + (this.words[offOff + slot] as number) + (next[slot] as number)] = i;
      next[slot] = (next[slot] as number) + 1;
    }
  }

  /** The stars' depth scales for this view (written by the merger's sprite kernel on the GPU). */
  setDepth(dk: ArrayLike<number>): void {
    for (let i = 0; i < this.n; i++) this.fl[this.L.dkOff + i] = dk[i] as number;
  }

  /** The stars' plate positions for this view (written by the merger's sprite kernel on the GPU). */
  setScreen(scr: ArrayLike<number>): void {
    for (let i = 0; i < this.n; i++) {
      this.fl[this.L.starOff + i * 4] = scr[i * 2] as number;
      this.fl[this.L.starOff + i * 4 + 1] = scr[i * 2 + 1] as number;
    }
  }

  /** `tide_nn`: `tidal(g, false)(x, y)` at a point in tile units, the 4 nearest by (distance, index). */
  nn(g: number, x: number, y: number): [number, number, number] {
    const { starOff, offOff, idsOff } = this.L;
    const nx = Math.min(Math.max(f(x * 2), -1), 1);
    const ny = Math.min(Math.max(f(y * 2), -1), 1);
    const gx = Math.floor(f(f(f(nx + 1) / 2) * 20));
    const gy = Math.floor(f(f(f(ny + 1) / 2) * 20));
    const bd = [3e38, 3e38, 3e38, 3e38];
    const bi = [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff];
    let found = 0;
    for (let ring = 0; ring < 4; ring++) {
      if (found >= 4) break;
      for (let dx = -ring; dx <= ring; dx++)
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const cx = gx + dx;
          const cy = gy + dy;
          if (cx < 0 || cx > 20 || cy < 0 || cy > 20) continue;
          const cell = g * TIDE_CELL_COUNT + cy * TIDE_CELLS + cx;
          const lo = this.words[offOff + cell] as number;
          const hi = this.words[offOff + cell + 1] as number;
          for (let k = lo; k < hi; k++) {
            const idx = this.words[idsOff + k] as number;
            const sx = starOff + idx * 4;
            const ex = f((this.fl[sx + 2] as number) - nx);
            const ey = f((this.fl[sx + 3] as number) - ny);
            let d = f(Math.sqrt(f(f(ex * ex) + f(ey * ey))));
            let j = idx;
            found++;
            for (let s = 0; s < 4; s++) {
              if (d < (bd[s] as number) || (d === bd[s] && j < (bi[s] as number))) {
                const td = bd[s] as number;
                const tj = bi[s] as number;
                bd[s] = d;
                bi[s] = j;
                d = td;
                j = tj;
              }
            }
          }
        }
    }
    if (found === 0) return [this.fl[5] as number, this.fl[6] as number, 1];
    let wx = 0;
    let wy = 0;
    let wk = 0;
    let ws = 0;
    for (let s = 0; s < Math.min(found, 4); s++) {
      const w = f(1 / f((bd[s] as number) + f(0.02)));
      const sx = starOff + (bi[s] as number) * 4;
      wx = f(wx + f((this.fl[sx] as number) * w));
      wy = f(wy + f((this.fl[sx + 1] as number) * w));
      wk = f(wk + f((this.fl[this.L.dkOff + (bi[s] as number)] as number) * w));
      ws = f(ws + w);
    }
    return [f(wx / ws), f(wy / ws), f(wk / ws)];
  }

  /** `grid`: every vertex of both galaxies' 49 × 49 grids. */
  buildGrid(): void {
    for (let g = 0; g < 2; g++)
      for (let gy = 0; gy < TIDE_GV; gy++)
        for (let gx = 0; gx < TIDE_GV; gx++) {
          const p = this.nn(g, f(f(gx / TIDE_GN) - 0.5), f(f(gy / TIDE_GN) - 0.5));
          const o = this.L.gridOff + ((g * TIDE_GV + gy) * TIDE_GV + gx) * TIDE_VW;
          this.fl[o] = p[0];
          this.fl[o + 1] = p[1];
          this.fl[o + 2] = p[2];
        }
  }

  /** `tide_grid`: the grid bilinearly, at (u, v) = (plate offset) / R2. */
  grid(g: number, u: number, v: number): [number, number, number] {
    const base = this.L.gridOff + g * (TIDE_GV * TIDE_GV * TIDE_VW);
    const fx = Math.min(Math.max(f(f(u + 0.5) * TIDE_GN), 0), f(47.999996));
    const fy = Math.min(Math.max(f(f(v + 0.5) * TIDE_GN), 0), f(47.999996));
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const ax = f(fx - ix);
    const ay = f(fy - iy);
    const o = base + (iy * TIDE_GV + ix) * TIDE_VW;
    const o3 = o + TIDE_GV * TIDE_VW;
    const q = (k: number) => this.fl[k] as number;
    const mix = (k: number) =>
      f(
        f(f(f(q(o + k) * f(1 - ax)) + f(q(o + TIDE_VW + k) * ax)) * f(1 - ay)) +
          f(f(f(q(o3 + k) * f(1 - ax)) + f(q(o3 + TIDE_VW + k) * ax)) * ay),
      );
    return [mix(0), mix(1), mix(2)];
  }

  /** `tide_post`: a galaxy's own `post` at a plate point, R2 plate px across the grid. */
  post(g: number, x: number, y: number, r2: number): [number, number, number] {
    return this.grid(
      g,
      f(f(x - (this.fl[5] as number)) / r2),
      f(f(y - (this.fl[6] as number)) / r2),
    );
  }
}

const dist = (ax: number, ay: number, bx: number, by: number) => {
  const dx = f(bx - ax);
  const dy = f(by - ay);
  return f(Math.sqrt(f(f(dx * dx) + f(dy * dy))));
};

/** Two corners of a ribbon end scaled about their midpoint, in place. */
function scaleAbout(a: number[], b: number[], k: number): void {
  const mx = f(f((a[0] as number) + (b[0] as number)) / 2);
  const my = f(f((a[1] as number) + (b[1] as number)) / 2);
  a[0] = f(mx + f(f((a[0] as number) - mx) * k));
  a[1] = f(my + f(f((a[1] as number) - my) * k));
  b[0] = f(mx + f(f((b[0] as number) - mx) * k));
  b[1] = f(my + f(f((b[1] as number) - my) * k));
}

/**
 * `warp_instances`: the centres of `n` instances (8 words each: x, y, layer, alpha, m0…m3) carried
 * by galaxy g's tides.
 */
export function warpInstances(
  T: TideData,
  g: number,
  r2: number,
  fl: Float32Array,
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const p = T.post(g, fl[i * 8] as number, fl[i * 8 + 1] as number, r2);
    fl[i * 8] = p[0];
    fl[i * 8 + 1] = p[1];
    // the mark keeps its shape, and takes the scale of the depth it sits at (ADR 0088)
    if (p[2] !== 1) for (let k = 4; k < 8; k++) fl[i * 8 + k] = f((fl[i * 8 + k] as number) * p[2]);
  }
}

/**
 * `warp_ribbons`: `n` textured ribbon segments (12 words: four corners, u, layer, alpha), torn
 * (alpha 0) where the tides stretch them (L832–834).
 */
export function warpRibbons(T: TideData, g: number, r2: number, fl: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const o = i * 12;
    const c = (k: number) => fl[o + k] as number;
    const ol = f(dist(c(0), c(1), c(4), c(5)) + 1);
    const ow = f(dist(c(0), c(1), c(2), c(3)) + 1);
    const w0 = T.post(g, c(0), c(1), r2);
    const w1 = T.post(g, c(2), c(3), r2);
    const w2 = T.post(g, c(4), c(5), r2);
    const w3 = T.post(g, c(6), c(7), r2);
    const ml = dist(w0[0], w0[1], w2[0], w2[1]);
    const mw = dist(w0[0], w0[1], w1[0], w1[1]);
    let alpha = c(11);
    if (ml > SEAMMAX || f(ml / ol) > TEAR || f(mw / ow) > TEAR) alpha = 0;
    // the width follows the depth of each end (ADR 0088): the corners about their midpoint
    const k0 = f(f(w0[2] + w1[2]) / 2);
    const k1 = f(f(w2[2] + w3[2]) / 2);
    if (k0 !== 1) scaleAbout(w0, w1, k0);
    if (k1 !== 1) scaleAbout(w2, w3, k1);
    fl.set([w0[0], w0[1], w1[0], w1[1], w2[0], w2[1], w3[0], w3[1]], o);
    fl[o + 11] = alpha;
  }
}

/** `warp_caps`: `n` capsules (8 words: a, b, w, alpha, 2 pad), torn as expandVector tears (L1207–1208). */
export function warpCaps(T: TideData, g: number, r2: number, fl: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const c = (k: number) => fl[o + k] as number;
    const a = T.post(g, c(0), c(1), r2);
    const b = T.post(g, c(2), c(3), r2);
    const ml = dist(a[0], a[1], b[0], b[1]);
    const ol = f(dist(c(0), c(1), c(2), c(3)) + f(0.8));
    let alpha = c(5);
    if (ml > 22 || f(ml / ol) > TEAR) alpha = 0;
    fl.set([a[0], a[1], b[0], b[1]], o);
    const k = f(f(a[2] + b[2]) / 2);
    if (k !== 1) fl[o + 4] = f(c(4) * k);
    fl[o + 5] = alpha;
  }
}
