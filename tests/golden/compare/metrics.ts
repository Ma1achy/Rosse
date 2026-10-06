/**
 * The golden metric of ADR 0013 and 0015, on the alpha channel α (0–1) of an ink image:
 *
 * a. total ink: Σα;
 * b. fine structure: SSIM between density maps (α blurred with a Gaussian of σ = 4 plate px,
 *    downsampled 4×, SSIM over 7 × 7 windows);
 * c. pen weight: stroke widths from the Euclidean distance transform of the mask α ≥ 0.5, sampled
 *    on its medial axis, ×2: median and 90th percentile (as band means, see `bandMean`);
 * d. mark counts (compared in ./thresholds.ts).
 *
 * and, as calibrated in M2 (ADR 0015):
 *
 * b′. coarse structure: the same SSIM on a coarse density map (σ = 16 px, downsampled 8×). At
 *    σ = 4 px a full re-draw of a stipple-only galaxy scores only 0.33–0.67 (spiral) and
 *    0.48–0.65 (smooth), because the map still resolves the random dots, so (b) is reported but
 *    not gated; at σ = 16 px re-draws score 0.89–0.97 (spiral) and 0.93–0.96 (smooth), and a 35°
 *    orbit of a spiral 0.56–0.81 (calibration.json);
 * f. moments and extent (`extentOf`, `momentsOf`): radii, outer ink, axis ratios and position
 *    angle, which density maps hardly see.
 *
 * Plain arrays and numbers, no DOM, so it runs in Node, in vitest and in the page.
 */

export interface Grey {
  width: number;
  height: number;
  data: Float32Array;
}

export function grey(width: number, height: number, data?: Float32Array): Grey {
  return { width, height, data: data ?? new Float32Array(width * height) };
}

/** α from RGBA8 bytes (as decoded from a PNG). */
export function alphaFromRgba8(width: number, height: number, rgba: Uint8Array): Grey {
  const out = grey(width, height);
  for (let i = 0; i < width * height; i++) out.data[i] = (rgba[i * 4 + 3] ?? 0) / 255;
  return out;
}

/** (a) Σα. */
export function totalInk(a: Grey): number {
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
export function blur(a: Grey, sigma: number): Grey {
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const { width: w, height: h } = a;
  const tmp = new Float32Array(w * h);
  const out = grey(w, h);
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
export function downsample(a: Grey, factor: number): Grey {
  const w = Math.floor(a.width / factor);
  const h = Math.floor(a.height / factor);
  const out = grey(w, h);
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
export function densityMap(a: Grey, sigma = 4, factor = 4): Grey {
  return downsample(blur(a, sigma), factor);
}

/** The coarse density map of (b′): σ = 16 px blur, then 8× downsampling (800² → 100²). */
export function coarseDensityMap(a: Grey): Grey {
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
export function ssim(a: Grey, b: Grey, win = 7, empty = 1e-3): number {
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
export function upsample(a: Grey, factor: number): Grey {
  const W = a.width * factor;
  const H = a.height * factor;
  const out = grey(W, H);
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
export function strokeWidths(a: Grey, factor = 4): StrokeWidths {
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
  return { widths, median: bandMean(widths, 0.4, 0.6), p90: bandMean(widths, 0.85, 0.95) };
}

/**
 * The mean of the values between two quantiles: the "median" of (c) is the mean of the 40th–60th
 * percentiles, and the "p90" the mean of the 85th–95th. Distances on a pixel grid take few values
 * (a third of the medial-axis widths of a stipple are exactly 2.000 px, the next values being
 * 2.062 and 2.236), so a single order statistic jumps by 6–12% when the share at one value moves
 * across 50%; a band mean moves continuously with the distribution (M2 calibration).
 */
export function bandMean(sorted: ArrayLike<number>, lo: number, hi: number): number {
  const n = sorted.length;
  if (!n) return 0;
  const a = Math.min(n - 1, Math.floor(lo * n));
  const b = Math.max(a + 1, Math.min(n, Math.ceil(hi * n)));
  let s = 0;
  for (let i = a; i < b; i++) s += sorted[i] ?? 0;
  return s / (b - a);
}

/** Quantile of sorted values (nearest rank); 0 for an empty list. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i] ?? 0;
}

/**
 * (f) Moments and extent of the ink about the plate's centre (ADR 0015): the radii holding 25%, 50%
 * and 90% of the ink, the ink beyond the reference's r90, and, within the reference's r90, the
 * axis ratio and position angle of the second moments. Density maps compare local means and are
 * nearly blind to a galaxy that is a little rounder, bigger, smaller or without its halo; these
 * are not.
 */
export interface Extent {
  /** ink within radius r, cumulative, in bins of RADIAL_BIN px from the centre */
  cdf: Float64Array;
  total: number;
  r25: number;
  r50: number;
  r90: number;
}

export const RADIAL_BIN = 0.25;
export const CENTRE = 400;

export function extentOf(a: Grey, cx = CENTRE, cy = CENTRE): Extent {
  const bins = Math.ceil(Math.hypot(a.width, a.height) / RADIAL_BIN) + 2;
  const hist = new Float64Array(bins);
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const v = a.data[y * a.width + x] ?? 0;
      if (!v) continue;
      const i = Math.floor(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / RADIAL_BIN);
      hist[i] = (hist[i] ?? 0) + v;
    }
  const cdf = new Float64Array(bins);
  let s = 0;
  for (let i = 0; i < bins; i++) cdf[i] = s += hist[i] ?? 0;
  const ext: Extent = { cdf, total: s, r25: 0, r50: 0, r90: 0 };
  ext.r25 = radiusAt(ext, 0.25);
  ext.r50 = radiusAt(ext, 0.5);
  ext.r90 = radiusAt(ext, 0.9);
  return ext;
}

/** The radius holding a fraction of the ink (linear within a bin). */
export function radiusAt(e: Extent, frac: number): number {
  const want = frac * e.total;
  let prev = 0;
  for (let i = 0; i < e.cdf.length; i++) {
    const c = e.cdf[i] ?? 0;
    if (c >= want) {
      const t = c > prev ? (want - prev) / (c - prev) : 0;
      return (i + t) * RADIAL_BIN;
    }
    prev = c;
  }
  return e.cdf.length * RADIAL_BIN;
}

/** The fraction of the ink beyond radius r. */
export function inkBeyond(e: Extent, r: number): number {
  if (!e.total) return 0;
  const i = Math.min(e.cdf.length - 1, Math.max(0, Math.floor(r / RADIAL_BIN)));
  return 1 - (e.cdf[i] ?? 0) / e.total;
}

export interface Moments {
  /** axis ratio, minor / major, from the second moments */
  q: number;
  /** position angle of the major axis, degrees in [0, 180), y down */
  pa: number;
}

/** Second moments of the ink within `aperture` px of the centre. */
export function momentsOf(a: Grey, aperture: number, cx = CENTRE, cy = CENTRE): Moments {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  const r2 = aperture * aperture;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const v = a.data[y * a.width + x] ?? 0;
      if (!v) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r2) continue;
      sxx += v * dx * dx;
      syy += v * dy * dy;
      sxy += v * dx * dy;
    }
  const tr = sxx + syy;
  const d = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  const l1 = tr / 2 + d;
  const l2 = tr / 2 - d;
  const pa = ((((0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI) % 180) + 180) % 180;
  return { q: l1 > 0 ? Math.sqrt(Math.max(0, l2) / l1) : 1, pa };
}

/** Every measure of one image. */
export interface ImageMeasures {
  alpha: Grey;
  ink: number;
  density: Grey;
  coarse: Grey;
  strokes: StrokeWidths;
  extent: Extent;
}

export function measure(a: Grey): ImageMeasures {
  return {
    alpha: a,
    ink: totalInk(a),
    density: densityMap(a),
    coarse: coarseDensityMap(a),
    strokes: strokeWidths(a),
    extent: extentOf(a),
  };
}

interface Side {
  ink: number;
  median: number;
  p90: number;
  r50: number;
  r90: number;
  q: number;
  pa: number;
}

/** The comparison of a render against a reference. */
export interface Comparison {
  /** (render − reference) / reference */
  inkRel: number;
  /** (b), informational since ADR 0015 */
  ssim: number;
  /** (b′) */
  ssimCoarse: number;
  medianRel: number;
  p90Rel: number;
  /** (f): radii, relative */
  r25Rel: number;
  r50Rel: number;
  r90Rel: number;
  /** (f): ink beyond the reference's r90, render − reference (fractions of the total) */
  outerDiff: number;
  /** (f): axis ratio within the reference's r90, render − reference */
  qDiff: number;
  /** (f): axis ratio within the reference's r50 (the inner galaxy: bulge, thickness) */
  qInnerDiff: number;
  /** (f): position angle difference, degrees, in [−90, 90) */
  paDiff: number;
  ref: Side;
  render: Side;
}

const rel = (x: number, ref: number) => (ref === 0 ? (x === 0 ? 0 : Infinity) : (x - ref) / ref);

export function compareMeasures(ref: ImageMeasures, render: ImageMeasures): Comparison {
  const ap = ref.extent.r90;
  const mRef = momentsOf(ref.alpha, ap);
  const mRen = momentsOf(render.alpha, ap);
  const inner = ref.extent.r50;
  const qInnerDiff = momentsOf(render.alpha, inner).q - momentsOf(ref.alpha, inner).q;
  const side = (m: ImageMeasures, mo: Moments): Side => ({
    ink: m.ink,
    median: m.strokes.median,
    p90: m.strokes.p90,
    r50: m.extent.r50,
    r90: m.extent.r90,
    q: mo.q,
    pa: mo.pa,
  });
  return {
    inkRel: rel(render.ink, ref.ink),
    ssim: ssim(ref.density, render.density),
    ssimCoarse: ssim(ref.coarse, render.coarse),
    medianRel: rel(render.strokes.median, ref.strokes.median),
    p90Rel: rel(render.strokes.p90, ref.strokes.p90),
    r25Rel: rel(render.extent.r25, ref.extent.r25),
    r50Rel: rel(render.extent.r50, ref.extent.r50),
    r90Rel: rel(render.extent.r90, ref.extent.r90),
    outerDiff: inkBeyond(render.extent, ap) - inkBeyond(ref.extent, ap),
    qDiff: mRen.q - mRef.q,
    qInnerDiff,
    paDiff: ((((mRen.pa - mRef.pa) % 180) + 270) % 180) - 90,
    ref: side(ref, mRef),
    render: side(render, mRen),
  };
}
