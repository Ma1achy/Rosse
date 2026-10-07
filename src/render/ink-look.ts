/**
 * What the ink target is printed with for a plates mode on a surface, shared by the page and the
 * CPU engine's worker. Only the coloured plates depend on the surface's palette; the `ink` plate
 * is the same on both (the composite colours it).
 */
import { PALETTES } from './palette';
import type { InkLook, Plates } from './plates';
import type { SurfaceName } from './surface';

export function inkLook(plates: Plates, surface: SurfaceName): InkLook {
  return { plates, palette: surface === 'chalk' ? PALETTES.dark : PALETTES.light };
}

/** A key that changes when the printed ink target must be redone. */
export const inkKey = (look: InkLook) =>
  look.plates === 'ink' ? 'ink' : `${look.plates}|${look.palette.ink.join()}`;
