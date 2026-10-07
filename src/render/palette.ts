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
}

export const PALETTES: { light: Palette; dark: Palette } = {
  light: {
    ink: [0.114, 0.106, 0.098],
    disc: [0.25, 0.23, 0.2],
    old: [0.62, 0.3, 0.08],
    young: [0.06, 0.35, 0.62],
    hii: [0.74, 0.07, 0.36],
  },
  dark: {
    ink: [0.925, 0.894, 0.824],
    disc: [0.76, 0.72, 0.64],
    old: [0.9, 0.64, 0.38],
    young: [0.58, 0.78, 0.92],
    hii: [0.92, 0.56, 0.71],
  },
};

/** The three process inks of the slipped plates (app23.js:L1141). The same on either surface. */
export const PROCESS_INKS = {
  cyan: [0.0, 0.55, 0.69],
  magenta: [0.81, 0.06, 0.4],
  yellow: [0.89, 0.77, 0.0],
} as const satisfies Record<string, Rgb>;
