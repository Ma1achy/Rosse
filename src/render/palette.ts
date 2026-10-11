/**
 * Inks for Paper and Chalkboard, from the reference's PALETTES (app23.js:L1143–1146): ink on cream
 * paper, or cream ink on the chalkboard; and the process inks of the slipped plates (CYAN, MAG and
 * YEL, the Principia palette, L1141). The colour plates' population inks (disc, old, young, HII)
 * are the palette's own: lighter and warmer on the chalkboard. Values are sRGB-encoded, in [0, 1],
 * used as the reference uses them (straight into a premultiplied canvas).
 */

export type Rgb = readonly [number, number, number];

export interface Palette {
  ink: Rgb;
  disc: Rgb;
  old: Rgb;
  young: Rgb;
  hii: Rgb;
  /**
   * The tints of a dot (ADR 0091): fifteen inks, the stars' temperature from dust-reddened and
   * orange through gold and cream to ice, sky and periwinkle blue, then the emission nebulae's
   * rose, coral and lilac and a pale teal: a box of coloured pencils, or of pastel chalks.
   */
  ramp: readonly Rgb[];
}

export const PALETTES: { light: Palette; dark: Palette } = {
  light: {
    ink: [0.114, 0.106, 0.098],
    disc: [0.25, 0.23, 0.2],
    old: [0.62, 0.3, 0.08],
    young: [0.06, 0.35, 0.62],
    hii: [0.74, 0.07, 0.36],
    ramp: [
      [0.5, 0.18, 0.14],
      [0.62, 0.26, 0.12],
      [0.68, 0.38, 0.1],
      [0.66, 0.46, 0.12],
      [0.58, 0.48, 0.14],
      [0.52, 0.47, 0.22],
      [0.34, 0.32, 0.27],
      [0.28, 0.36, 0.44],
      [0.18, 0.36, 0.58],
      [0.1, 0.3, 0.62],
      [0.26, 0.26, 0.6],
      [0.7, 0.18, 0.4],
      [0.74, 0.1, 0.3],
      [0.48, 0.26, 0.58],
      [0.12, 0.46, 0.44],
    ],
  },
  dark: {
    ink: [0.925, 0.894, 0.824],
    disc: [0.76, 0.72, 0.64],
    old: [0.9, 0.64, 0.38],
    young: [0.58, 0.78, 0.92],
    hii: [0.92, 0.56, 0.71],
    ramp: [
      [0.8, 0.45, 0.4],
      [0.9, 0.55, 0.4],
      [0.94, 0.66, 0.4],
      [0.94, 0.76, 0.45],
      [0.93, 0.84, 0.55],
      [0.93, 0.9, 0.7],
      [0.92, 0.91, 0.84],
      [0.84, 0.9, 0.95],
      [0.7, 0.83, 0.96],
      [0.6, 0.76, 0.97],
      [0.66, 0.68, 0.95],
      [0.95, 0.62, 0.74],
      [0.93, 0.52, 0.66],
      [0.8, 0.66, 0.92],
      [0.6, 0.86, 0.82],
    ],
  },
};

/** The three process inks of the slipped plates (app23.js:L1141). The same on either surface. */
export const PROCESS_INKS = {
  cyan: [0.0, 0.55, 0.69],
  magenta: [0.81, 0.06, 0.4],
  yellow: [0.89, 0.77, 0.0],
} as const satisfies Record<string, Rgb>;
