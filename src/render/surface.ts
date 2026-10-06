/**
 * The surface under the ink: Paper or Chalkboard (ADR 0007). The reference does this with CSS
 * behind a transparent canvas (head23.html:29 and later rules; v21 never sets
 * `html[data-theme="dark"]`, app23.js:L1149, so only the light-theme rules apply):
 *
 *   .plate { background-color: var(--field); background-image: url(<paper>);
 *            background-size: 512px; background-blend-mode: multiply }
 *   .plate { box-shadow: inset 0 0 0 1px rgba(29,27,25,.16) !important }
 *   .plate[data-surface="chalk"] { background-color: #262b28; background-blend-mode: soft-light;
 *            box-shadow: inset 0 0 0 1px rgba(29,27,25,.35), inset 0 0 60px rgba(0,0,0,.35) }
 *
 * with `--field: #e6dece`. (The pack's design-token table gives the plate as #e2d9c6; the CSS
 * the page renders with is #e6dece, and that is what is reproduced here.)
 *
 * In CSS blending the image is the source (Cs) and the background colour the backdrop (Cb). The
 * blend functions are the W3C Compositing and Blending Level 1 definitions. The inset shadows are
 * drawn over the background, the last listed first, as CSS does: a shadow with spread s and blur
 * b covers the plate except a "hole" inset by s, whose edges are blurred by a Gaussian with
 * σ = b / 2 (CSS Backgrounds 3; Chromium/Skia). Everything is evaluated in f32 on sRGB-encoded
 * values, exactly as composite.wgsl does; the CPU fallback calls these functions. Switching
 * surface re-runs only the composite pass (present tier, ADR 0010).
 */
import { PALETTES, type Palette, type Rgb } from './palette';

export type SurfaceName = 'paper' | 'chalk';

/** An inset box-shadow with no offset (all the plate uses). */
export interface InsetShadow {
  /** colour, sRGB in [0, 1], and alpha */
  rgba: readonly [number, number, number, number];
  /** CSS px */
  blur: number;
  /** CSS px */
  spread: number;
}

export interface Surface {
  name: SurfaceName;
  /** the background colour, sRGB in [0, 1] */
  field: Rgb;
  blend: 'multiply' | 'soft-light';
  /** inset shadows, topmost first (CSS order); at most two */
  shadows: readonly InsetShadow[];
  /** the palette inked onto this surface */
  palette: Palette;
}

/** Size of one paper tile in CSS pixels (`background-size: 512px`). */
export const PAPER_TILE_CSS = 512;

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const rgba = (r: number, g: number, b: number, a: number) =>
  [r / 255, g / 255, b / 255, a] as const;

export const SURFACES: Record<SurfaceName, Surface> = {
  paper: {
    name: 'paper',
    field: hexToRgb('#e6dece'),
    blend: 'multiply',
    shadows: [{ rgba: rgba(29, 27, 25, 0.16), blur: 0, spread: 1 }],
    palette: PALETTES.light,
  },
  chalk: {
    name: 'chalk',
    field: hexToRgb('#262b28'),
    blend: 'soft-light',
    shadows: [
      { rgba: rgba(29, 27, 25, 0.35), blur: 0, spread: 1 },
      { rgba: rgba(0, 0, 0, 0.35), blur: 60, spread: 0 },
    ],
    palette: PALETTES.dark,
  },
};

const f = Math.fround;

/** multiply(Cb, Cs). */
export function blendMultiply(cb: number, cs: number): number {
  return f(cb * cs);
}

/** soft-light(Cb, Cs). */
export function blendSoftLight(cb: number, cs: number): number {
  if (cs <= 0.5) return f(cb - f(f(f(1 - f(2 * cs)) * cb) * f(1 - cb)));
  const d = cb <= 0.25 ? f(f(f(f(f(16 * cb) - 12) * cb) + 4) * cb) : f(Math.sqrt(cb));
  return f(cb + f(f(f(2 * cs) - 1) * f(d - cb)));
}

/** Paper texels per device pixel: the tile is 512 CSS px, whatever the texture's size. */
export function texelPerPx(paperWidth: number, dpr: number): number {
  return f(paperWidth / (PAPER_TILE_CSS * dpr));
}

/** erf, Abramowitz and Stegun 7.1.26 (|error| < 1.5e-7), in f32 (composite.wgsl `erf_approx`). */
export function erf(x: number): number {
  const ax = f(Math.abs(x));
  const t = f(1 / f(1 + f(0.3275911 * ax)));
  let p = f(1.061405429);
  p = f(f(p * t) - 1.453152027);
  p = f(f(p * t) + 1.421413741);
  p = f(f(p * t) - 0.284496736);
  p = f(f(p * t) + 0.254829592);
  const y = f(1 - f(f(p * t) * f(Math.exp(f(-f(ax * ax))))));
  return x < 0 ? -y : y;
}

/**
 * How much of a device pixel the shadow's hole covers along one axis (composite.wgsl
 * `hole_axis`). `p` is the pixel index, `size` the plate size in CSS px. Sharp shadows (blur 0)
 * use the exact overlap of the pixel with the hole; blurred ones the Gaussian-blurred hole at the
 * pixel centre.
 */
export function holeAxis(p: number, dpr: number, size: number, spread: number, sigma: number) {
  const lo = f(spread);
  const hi = f(size - spread);
  if (sigma <= 0) {
    const a = f(p / dpr);
    const b = f(f(p + 1) / dpr);
    const overlap = Math.max(0, f(Math.min(b, hi) - Math.max(a, lo)));
    return f(overlap / f(b - a));
  }
  const x = f(f(p + 0.5) / dpr);
  const k = f(sigma * 1.4142135);
  return f(0.5 * f(erf(f(f(x - lo) / k)) - erf(f(f(x - hi) / k))));
}

/** The shadow's alpha at a device pixel (composite.wgsl `shadow_alpha`). */
export function shadowAlpha(
  px: number,
  py: number,
  dpr: number,
  size: number,
  s: { alpha: number; spread: number; sigma: number },
): number {
  if (s.alpha <= 0) return 0;
  const hx = holeAxis(px, dpr, size, s.spread, s.sigma);
  const hy = holeAxis(py, dpr, size, s.spread, s.sigma);
  return f(s.alpha * f(1 - f(hx * hy)));
}
