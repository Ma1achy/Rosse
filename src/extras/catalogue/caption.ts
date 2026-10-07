/**
 * The words v21's `showCat` writes under the plate for a catalogue galaxy (app23.js:L1793–1799),
 * and the link to the real one. Pure; the page (M11) puts the text in the DOM.
 *
 * Attribution the page must carry (docs/open-questions.md Q1): the Galaxy Zoo 2 classifications
 * are CC BY 4.0 (Willett et al. 2013, MNRAS 435, 2835; Hart et al. 2016, MNRAS 461, 3663), and
 * SDSS imagery needs its acknowledgement. `CATALOGUE_ATTRIBUTION` is the text.
 */
import { ATTRIBUTION } from '../attribution';
import { describe, shortType, type FromVotes } from '../from-votes';
import type { CatalogueGalaxy } from './fields';

/** The attribution the page must show (../attribution.ts). */
export const CATALOGUE_ATTRIBUTION = ATTRIBUTION.text;

export interface Caption {
  /** The sentence, as v21 writes it (ends with a space, before the link). */
  text: string;
  /** "See the real one on SkyServer". */
  skyServerUrl: string;
  /** What Rosse drew, in a few words (v21's `shortType`). */
  shortType: string;
}

export function catalogueCaption(g: CatalogueGalaxy, res: FromVotes): Caption {
  const ra = g.ra.toFixed(5);
  const de = g.dec.toFixed(5);
  const ex = g.extras;
  const text =
    'Galaxy ' +
    g.objid +
    ' at RA ' +
    ra +
    ', Dec ' +
    de +
    '. ' +
    describe(g, res).replace(' measured from the photo', ' from SDSS') +
    (Math.abs(g.wind) > 0.25 ? ' (winding from Galaxy Zoo 1 votes)' : '') +
    (ex.gr != null
      ? ' Colour g−r ' +
        ex.gr.toFixed(2) +
        (ex.gr > 0.75 ? ', red and old' : ex.gr < 0.55 ? ', blue and star-forming' : '') +
        '.'
      : '') +
    (ex.conc ? ' Concentration ' + ex.conc.toFixed(2) + '.' : '') +
    (res.p.merger
      ? ' Drawn as a simulated ' + (res.p.mBulge > 0.5 ? 'dry ' : '') + 'merger.'
      : '') +
    ' ';
  return {
    text,
    skyServerUrl: `https://skyserver.sdss.org/dr17/VisualTools/explore/summary?ra=${ra}&dec=${de}`,
    shortType: shortType(res.p, res.odd),
  };
}
