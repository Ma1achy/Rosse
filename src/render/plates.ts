/**
 * Plates (the reference's `P.plates`, app23.js:L1302–1307): how the ink layers are printed into
 * the ink target. A present-tier input (ADR 0010): switching plates re-inks the existing view-tier
 * buffers with other uniforms and re-composites, and runs no compute pass.
 *
 * - `ink`: one pass in the key ink. The target holds ink α with (1, 1, 1) as colour; the composite
 *   gives it the palette's ink, so a change of surface re-runs only the composite (ADR 0007).
 * - `slip`: four passes, three process plates each slipped a little, then the key ink. Cyan at
 *   gain 0.32 and offset (−3.6, −1.2) plate units, magenta at 0.3 and (3.4, 1.0), yellow at 0.42
 *   and (0.6, 3.8), then the palette's key ink at gain 1 with no offset.
 * - `colour`: one pass, each population in its own ink (`inkOf`): old, disc, young and HII from the
 *   palette, and everything else, the line work and the stars, in the key ink.
 *
 * The slipped plates' colours are the same on Paper and Chalkboard; the key ink and the colour
 * plates' populations take the palette of the surface (lighter and warmer on the chalkboard). In
 * both coloured modes the target holds the actual colours, so the composite adds them unscaled.
 */
import { PALETTES, PROCESS_INKS, type Palette, type Rgb } from './palette';

export type Plates = 'ink' | 'slip' | 'colour';

/** The population a layer is inked as: the reference's `inkOf(pop)` argument. */
export type Pop = 'line' | 'old' | 'disc' | 'young' | 'hii' | 'star';

export interface PlatePass {
  /** the ink of a layer of this population */
  inkOf(pop: Pop): Rgb;
  /** the plate offset, plate units (`uOff`) */
  off: readonly [number, number];
  /** multiplies each layer's gain (`uGain`) */
  gain: number;
}

const WHITE: Rgb = [1, 1, 1];

/** The colour plate's ink of a population (app23.js:L1305). */
export function populationInk(pop: Pop, palette: Palette): Rgb {
  switch (pop) {
    case 'old':
      return palette.old;
    case 'young':
      return palette.young;
    case 'hii':
      return palette.hii;
    case 'disc':
      return palette.disc;
    case 'star':
    case 'line':
      return palette.ink;
  }
}

/**
 * The passes of a plates mode, in order (app23.js:L1302–1307).
 *
 * v21 parity: the slipped plates' offsets are in plate units (`VIEW.W` = 800), added to every
 * position before the plate is scaled to the canvas, so they shrink and grow with the plate's
 * width and are not moved by the zoom, the orbit or the DPR.
 */
export function platePasses(plates: Plates, palette: Palette): PlatePass[] {
  const flat = (c: Rgb, off: readonly [number, number], gain: number): PlatePass => ({
    inkOf: () => c,
    off,
    gain,
  });
  switch (plates) {
    case 'slip':
      return [
        flat(PROCESS_INKS.cyan, [-3.6, -1.2], 0.32),
        flat(PROCESS_INKS.magenta, [3.4, 1.0], 0.3),
        flat(PROCESS_INKS.yellow, [0.6, 3.8], 0.42),
        flat(palette.ink, [0, 0], 1),
      ];
    case 'colour':
      return [{ inkOf: (pop) => populationInk(pop, palette), off: [0, 0], gain: 1 }];
    case 'ink':
      return [flat(WHITE, [0, 0], 1)];
  }
}

/** The ink target's colour is the palette's key ink only on the `ink` plate. */
export function compositeInk(plates: Plates, palette: Palette): Rgb {
  return plates === 'ink' ? palette.ink : WHITE;
}

/** What the ink target is printed with. */
export interface InkLook {
  plates: Plates;
  palette: Palette;
}

/** One pass in the key ink on Paper: the look of every golden before plates. */
export const DEFAULT_LOOK: InkLook = { plates: 'ink', palette: PALETTES.light };
