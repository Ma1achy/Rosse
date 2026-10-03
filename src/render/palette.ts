/**
 * Inks for Paper and Chalkboard, from the reference's PALETTES (app23.js:L1143–1146): ink on cream
 * paper, or cream ink on the chalkboard. The colour plates' population inks (disc, old, young,
 * HII) come in with the plates (M6). Values are sRGB-encoded, in [0, 1], used as the reference
 * uses them (straight into a premultiplied canvas).
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
