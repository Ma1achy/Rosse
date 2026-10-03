/**
 * The surface under the ink: Paper or Chalkboard (ADR 0007). The reference does this with CSS
 * behind a transparent canvas (head23.html):
 *
 *   .plate { background-color: var(--field); background-image: url(<paper>); background-size: 512px }
 *   .plate { background-blend-mode: overlay }
 *   .plate[data-surface="chalk"] { background-color: #262b28; background-blend-mode: soft-light }
 *
 * with `--field: #e6dece` (the page never sets the dark theme on the root, so the light value
 * always applies). Note the pack's design-token table gives the plate as #e2d9c6; the CSS the
 * page actually renders with is #e6dece, and that is what is reproduced here.
 *
 * In CSS blending the image is the source (Cs) and the background colour the backdrop (Cb). The
 * blend functions below are the W3C Compositing and Blending Level 1 definitions, evaluated in
 * f32 on sRGB-encoded values, exactly as composite.wgsl does; the CPU fallback calls them.
 * Switching surface re-runs only the composite pass (present tier, ADR 0010).
 */
import { PALETTES, type Palette, type Rgb } from './palette';

export type SurfaceName = 'paper' | 'chalk';

export interface Surface {
  name: SurfaceName;
  /** the background colour, sRGB in [0, 1] */
  field: Rgb;
  blend: 'overlay' | 'soft-light';
  /** the palette inked onto this surface */
  palette: Palette;
}

/** Size of one paper tile in CSS pixels (`background-size: 512px`). */
export const PAPER_TILE_CSS = 512;

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const SURFACES: Record<SurfaceName, Surface> = {
  paper: { name: 'paper', field: hexToRgb('#e6dece'), blend: 'overlay', palette: PALETTES.light },
  chalk: {
    name: 'chalk',
    field: hexToRgb('#262b28'),
    blend: 'soft-light',
    palette: PALETTES.dark,
  },
};

const f = Math.fround;

/** overlay(Cb, Cs) = hard-light(Cs, Cb). */
export function blendOverlay(cb: number, cs: number): number {
  if (cb <= 0.5) return f(f(cs * f(2 * cb)));
  const c2 = f(f(2 * cb) - 1);
  return f(f(cs + c2) - f(cs * c2));
}

/** soft-light(Cb, Cs). */
export function blendSoftLight(cb: number, cs: number): number {
  if (cs <= 0.5) return f(cb - f(f(f(1 - f(2 * cs)) * cb) * f(1 - cb)));
  const d = cb <= 0.25 ? f(f(f(f(f(16 * cb) - 12) * cb) + 4) * cb) : f(Math.sqrt(cb));
  return f(cb + f(f(f(2 * cs) - 1) * f(d - cb)));
}

/** Paper texels per device pixel: the tile is 512 CSS px, whatever the texture's size. */
export function texelPerPx(paperWidth: number, dpr: number): number {
  return Math.fround(paperWidth / (PAPER_TILE_CSS * dpr));
}
