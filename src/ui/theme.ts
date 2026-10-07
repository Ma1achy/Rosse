/**
 * The two surfaces: Paper (ink on cream) and the Chalkboard (cream ink on warm near-black), v21's
 * light and dark themes (app23.js:L1147). The page's colours follow `data-theme` on `<html>`
 * (`light` or `dark`); the plate's surface is the engine's (SURFACES in src/render/surface.ts) and
 * follows the same choice. The choice is remembered in this browser and given in a link
 * (`?surface=chalk`); with neither, the page follows the viewer's colour scheme.
 */
import type { SurfaceName } from '../render/surface';

const KEY = 'rosse-surface';

/** The surface to start on: a link's, else the one remembered, else the colour scheme's. */
export function initialSurface(fromUrl: SurfaceName | undefined): SurfaceName {
  if (fromUrl) return fromUrl;
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'paper' || s === 'chalk') return s;
  } catch {
    // storage may be blocked (a private window, a sandbox): follow the colour scheme
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'chalk'
    : 'paper';
}

export function rememberSurface(s: SurfaceName): void {
  try {
    localStorage.setItem(KEY, s);
  } catch {
    // not remembered: the page still works
  }
}

/** Paints the page for a surface. */
export function applySurface(s: SurfaceName): void {
  document.documentElement.dataset.theme = s === 'chalk' ? 'dark' : 'light';
}
