/**
 * The 42 real galaxies with photos (v21's `REAL`, app23.js:L1631 and `showReal`, L1403): the data
 * (`assets/data/rosse/real-galaxies/real-galaxies.json`), the parameters Rosse draws for each
 * (`fromReal`, ./from-votes.ts), and the cards: the SDSS photo on the front with what Rosse drew
 * written on the print, and one of the owner's hand-drawn post-its on the back.
 *
 * Integration surface for M11's UI:
 *
 * ```ts
 * const cards = realCards();                // 42 cards, built once
 * // a card: photoUrl, postitUrl, caption (the print's words), rotationDeg, postitRotationDeg
 * // on click: params = cards[i].params (a full `Params`), then draw as for a preset;
 * // the inset shows cards[i].photoUrl with cards[i].caption; the line under the plate is
 * // cards[i].description; the credit line is REAL_GALAXY_ATTRIBUTION.
 * ```
 *
 * Photo comparison: the card carries what the photo shows (axis ratio and angle measured from it,
 * `photoQ`, `photoPa`) beside what the drawing uses (`drawnPa`, `drawnIncl`), so the page can
 * show the print next to the plate, and tests can check that they agree.
 */
import type { Params } from '../../core/params';
import realGalaxies from '../../../assets/data/rosse/real-galaxies/real-galaxies.json';
import {
  describe,
  fromReal,
  shortType,
  type FromVotes,
  type OddFeature,
  type RealGalaxy,
} from '../from-votes';

export const REAL_GALAXY_ATTRIBUTION =
  'Photographs: SDSS (Sloan Digital Sky Survey; see sdss.org/collaboration/citing-sdss). ' +
  'Votes: Galaxy Zoo 2 (Willett et al. 2013, MNRAS 435, 2835; Hart et al. 2016, MNRAS 461, 3663), CC BY 4.0.';

const photos = import.meta.glob<string>('../../../assets/data/rosse/real-galaxies/photos/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
});
const postits = import.meta.glob<string>('../../../assets/data/rosse/real-galaxy-postits/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const byName = (m: Record<string, string>, name: string): string => {
  const k = Object.keys(m).find((p) => p.endsWith(`/${name}`));
  return k ? (m[k] as string) : '';
};

/** The 42 galaxies as the data file has them. */
export const REAL_GALAXIES = realGalaxies as unknown as RealGalaxy[];

export interface RealCard {
  index: number;
  galaxy: RealGalaxy;
  /** The SDSS photograph (160 px), a URL. */
  photoUrl: string;
  /** The post-it on the back (a hand drawing of it), a URL; '' if the file is missing. */
  postitUrl: string;
  /** Rosse's drawing parameters for it (`fromReal`). */
  params: Params;
  odd: OddFeature | null;
  /** A few words for what Rosse drew, written on the print (v21's `shortType`). */
  caption: string;
  /** The sentence under the plate (v21's `describe`). */
  description: string;
  /** The tilt of the print on the wall, in degrees (v21's `--rot`). */
  rotationDeg: number;
  /** The tilt of the post-it, in degrees (v21's `--pr`). */
  postitRotationDeg: number;
  /** Photo comparison: the axis ratio b/a and the angle (degrees) measured from the photo. */
  photoQ: number;
  photoPa: number;
  /** What the drawing uses: the plate angle and the inclination (degrees). */
  drawnPa: number;
  drawnIncl: number;
  /** Where to see the real one (SkyServer). */
  skyServerUrl: string;
}

/** The tilt v21 gives print `i` on the wall: a fixed pseudo-random angle within +/- 1.5 degrees. */
export function printRotation(i: number): number {
  const rz = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return Number(((rz - Math.floor(rz) - 0.5) * 3).toFixed(2));
}

/** One card. */
export function realCard(i: number): RealCard {
  const galaxy = REAL_GALAXIES[i];
  if (!galaxy) throw new RangeError(`no real galaxy ${String(i)}`);
  const res: FromVotes = fromReal(galaxy);
  const name = galaxy.photo.split('/').pop() ?? '';
  return {
    index: i,
    galaxy,
    photoUrl: byName(photos, name),
    postitUrl: byName(postits, `${String(i).padStart(2, '0')}.webp`),
    params: res.p,
    odd: res.odd,
    caption: shortType(res.p, res.odd),
    description: describe(galaxy, res),
    rotationDeg: printRotation(i),
    postitRotationDeg: (((i * 37) % 9) - 4) * 0.8,
    photoQ: galaxy.q,
    photoPa: galaxy.pa,
    drawnPa: res.p.pa,
    drawnIncl: res.p.incl,
    skyServerUrl: `https://skyserver.sdss.org/dr17/VisualTools/explore/summary?ra=${galaxy.ra.toFixed(5)}&dec=${galaxy.dec.toFixed(5)}`,
  };
}

/** All 42 cards. */
export function realCards(): RealCard[] {
  return REAL_GALAXIES.map((_g, i) => realCard(i));
}
