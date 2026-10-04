/**
 * The golden metric of ADR 0013, on the alpha channel α (0–1) of an ink image:
 *
 * a. total ink: Σα;
 * b. structure: SSIM between density maps (α blurred with a Gaussian of σ = 4 plate px,
 *    downsampled 4×, SSIM over 7 × 7 windows);
 * c. pen weight: stroke widths from the Euclidean distance transform of the mask α ≥ 0.5, sampled
 *    on its medial axis, ×2: median and 90th percentile;
 * d. mark counts (compared in ./thresholds.ts).
 *
 * plus (b′), added in M2: the same SSIM on a coarse density map (σ = 16 px, downsampled 8×). The
 * M2 calibration (docs/milestones/m2/README.md) found that at σ = 4 px a full re-draw of a
 * stipple-only galaxy scores only 0.3–0.5, because the σ = 4 px map still resolves the random
 * dots; at σ = 16 px a re-draw scores about 0.9 and a 35° orbit clearly less, so (b′) is the test
 * of structure that can tell the two apart. Both are gated, each at its calibrated threshold.
 *
 * Plain arrays and numbers, no DOM, so it runs in Node, in vitest and in the page.
 */

export interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}

export function gray(width: number, height: number, data?: Float32Array): Gray {
  return { width, height, data: data ?? new Float32Array(width * height) };
}

/** α from RGBA8 bytes (as decoded from a PNG). */
export function alphaFromRgba8(width: number, height: number, rgba: Uint8Array): Gray {
  const out = gray(width, height);
  for (let i = 0; i < width * height; i++) out.data[i] = (rgba[i * 4 + 3] ?? 0) / 255;
  return out;
}

/** (a) Σα. */
export function totalInk(a: Gray): number {
  let s = 0;
  for (const v of a.data) s += v;
  return s;
}

function gaussianKernel(sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma);
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] = (k[i] ?? 0) / s;
  return k;
}

/** Separable Gaussian blur, zero outside the image (there is no ink beyond the plate). */
export function blur(a: Gray, sigma: number): Gray {
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const { width: w, height: h } = a;
  const tmp = new Float32Array(w * h);
  const out = gray(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i;
        if (xx >= 0 && xx < w) s += (k[i + r] ?? 0) * (a.data[y * w + xx] ?? 0);
      }
      tmp[y * w + x] = s;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i;
        if (yy >= 0 && yy < h) s += (k[i + r] ?? 0) * (tmp[yy * w + x] ?? 0);
      }
      out.data[y * w + x] = s;
    }
  return out;
}

/** Box downsample by an integer factor. */
export function downsample(a: Gray, factor: number): Gray {
  const w = Math.floor(a.width / factor);
  const h = Math.floor(a.height / factor);
  const out = gray(w, h);
  const n = factor * factor;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = 0; j < factor; j++)
        for (let i = 0; i < factor; i++)
          s += a.data[(y * factor + j) * a.width + x * factor + i] ?? 0;
      out.data[y * w + x] = s / n;
    }
  return out;
}

/** The density map of (b): σ = 4 px blur, then 4× downsampling (800² → 200²). */
export function densityMap(a: Gray, sigma = 4, factor = 4): Gray {
  return downsample(blur(a, sigma), factor);
}

/** The coarse density map of (b′): σ = 16 px blur, then 8× downsampling (800² → 100²). */
export function coarseDensityMap(a: Gray): Gray {
  return densityMap(a, 16, 8);
}

/**
 * Mean SSIM (Wang et al. 2004) over the 7 × 7 windows fully inside the image, with a uniform
 * window and the usual constants for a dynamic range L = 1 (α is in [0, 1]): C1 = (0.01 L)²,
 * C2 = (0.03 L)².
 *
 * Windows with no ink in either map (both means below `empty`, default 1e-3) are left out: they
 * score 1 for any pair of drawings, and on a plate that is mostly empty they would hide a change
 * of structure. Pass `empty = -1` to average over every window.
 */
export function ssim(a: Gray, b: Gray, win = 7, empty = 1e-3): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('ssim: sizes differ');
  const { width: w, height: h } = a;
  const C1 = 1e-4;
  const C2 = 9e-4;
  const n = win * win;
  let sum = 0;
  let count = 0;
  for (let y = 0; y + win <= h; y++)
    for (let x = 0; x + win <= w; x++) {
      let sa = 0;
      let sb = 0;
      let saa = 0;
      let sbb = 0;
      let sab = 0;
      for (let j = 0; j < win; j++)
        for (let i = 0; i < win; i++) {
          const k = (y + j) * w + x + i;
          const va = a.data[k] ?? 0;
          const vb = b.data[k] ?? 0;
          sa += va;
          sb += vb;
          saa += va * va;
          sbb += vb * vb;
          sab += va * vb;
        }
      const ma = sa / n;
      const mb = sb / n;
      if (ma <= empty && mb <= empty) continue;
      const va = saa / n - ma * ma;
      const vb = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count++;
    }
  return count ? sum / count : 1;
}

/** 1D squared Euclidean distance transform (Felzenszwalb and Huttenlocher 2012). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const fq = f[q] ?? 0;
    const inter = () => {
      const vk = v[k] ?? 0;
      return (fq + q * q - ((f[vk] ?? 0) + vk * vk)) / (2 * q - 2 * vk);
    };
    let s = inter();
    // z[0] is −∞, so this stops at k = 0 at the latest
    while (s <= (z[k] ?? -Infinity)) {
      k--;
      s = inter();
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] ?? Infinity) < q) k++;
    const vk = v[k] ?? 0;
    d[q] = (q - vk) * (q - vk) + (f[vk] ?? 0);
  }
}

/**
 * Euclidean distance from each pixel of `mask` (true) to the nearest pixel outside it, in pixels
 * (0 outside). Pixels beyond the image count as outside.
 */
export function distanceTransform(mask: Uint8Array, w: number, h: number): Float32Array {
  // large, but small enough that INF + q² keeps q² exact in f64
  const INF = 1e12;
  const W = w + 2;
  const H = h + 2;
  // pad by one outside pixel on every side
  const g = new Float64Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inside = x > 0 && y > 0 && x <= w && y <= h && mask[(y - 1) * w + (x - 1)];
      g[y * W + x] = inside ? INF : 0;
    }
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = g[y * W + x] ?? 0;
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y] ?? 0;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = g[y * W + x] ?? 0;
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) g[y * W + x] = d[x] ?? 0;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(g[(y + 1) * W + x + 1] ?? 0);
  return out;
}

/** Bilinear upsampling by an integer factor (sample positions at the new pixel centres). */
export function upsample(a: Gray, factor: number): Gray {
  const W = a.width * factor;
  const H = a.height * factor;
  const out = gray(W, H);
  const at = (x: number, y: number) =>
    a.data[
      Math.min(a.height - 1, Math.max(0, y)) * a.width + Math.min(a.width - 1, Math.max(0, x))
    ] ?? 0;
  for (let Y = 0; Y < H; Y++) {
    const fy = (Y + 0.5) / factor - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let X = 0; X < W; X++) {
      const fx = (X + 0.5) / factor - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bot = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      out.data[Y * W + X] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}

export interface StrokeWidths {
  /** every medial-axis width, plate px */
  widths: Float32Array;
  median: number;
  p90: number;
}

/**
 * (c) Stroke widths: the mask α ≥ 0.5 of α upsampled `factor`× (bilinear), its distance transform,
 * and twice the distance on its medial axis (pixels whose distance is at least that of all eight
 * neighbours), in plate pixels. Upsampling makes the distances fine enough to resolve the 2–3 px
 * dots of the stipple: at 1× a dot's distance can only be 1, √2 or 2.
 */
export function strokeWidths(a: Gray, factor = 4): StrokeWidths {
  const up = factor > 1 ? upsample(a, factor) : a;
  const { width: w, height: h } = up;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = (up.data[i] ?? 0) >= 0.5 ? 1 : 0;
  const dt = distanceTransform(mask, w, h);
  const out: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = dt[y * w + x] ?? 0;
      if (d <= 0) continue;
      let ridge = true;
      for (let j = -1; j <= 1 && ridge; j++)
        for (let i = -1; i <= 1; i++) {
          if (!i && !j) continue;
          const xx = x + i;
          const yy = y + j;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if ((dt[yy * w + xx] ?? 0) > d) {
            ridge = false;
            break;
          }
        }
      if (ridge) out.push((2 * d) / factor);
    }
  const widths = Float32Array.from(out).sort();
  return { widths, median: quantile(widths, 0.5), p90: quantile(widths, 0.9) };
}

/** Quantile of sorted values (nearest rank); 0 for an empty list. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i] ?? 0;
}

/** Every measure of one image. */
export interface ImageMeasures {
  ink: number;
  density: Gray;
  coarse: Gray;
  strokes: StrokeWidths;
}

export function measure(a: Gray): ImageMeasures {
  return {
    ink: totalInk(a),
    density: densityMap(a),
    coarse: coarseDensityMap(a),
    strokes: strokeWidths(a),
  };
}

/** The comparison of a render against a reference. */
export interface Comparison {
  /** (render − reference) / reference */
  inkRel: number;
  ssim: number;
  ssimCoarse: number;
  medianRel: number;
  p90Rel: number;
  ref: { ink: number; median: number; p90: number };
  render: { ink: number; median: number; p90: number };
}

const rel = (x: number, ref: number) => (ref === 0 ? (x === 0 ? 0 : Infinity) : (x - ref) / ref);

export function compareMeasures(ref: ImageMeasures, render: ImageMeasures): Comparison {
  return {
    inkRel: rel(render.ink, ref.ink),
    ssim: ssim(ref.density, render.density),
    ssimCoarse: ssim(ref.coarse, render.coarse),
    medianRel: rel(render.strokes.median, ref.strokes.median),
    p90Rel: rel(render.strokes.p90, ref.strokes.p90),
    ref: { ink: ref.ink, median: ref.strokes.median, p90: ref.strokes.p90 },
    render: { ink: render.ink, median: render.strokes.median, p90: render.strokes.p90 },
  };
}
