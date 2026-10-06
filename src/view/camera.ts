/**
 * The camera: inclination, azimuth (orbit about the galaxy's axis), position angle (twist on the
 * plate), winding (mirror) and zoom.
 *
 * Planned: one 3×3 rotation shared by every stage, equivalent to the reference's `project`,
 * `discM`, `rotFwd`/`rotInv` and `toView` (app23.js:L126, L153, L440–441, L859), and the
 * deep-field perspective (`CAM = 30`, app23.js:L857). Pointer, wheel and keyboard orbiting
 * (app23.js:L1833) belongs to the page (src/ui/) and only writes camera parameters.
 */
export {};
