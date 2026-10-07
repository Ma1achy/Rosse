/**
 * What the page must show with the Galaxy Zoo 2 data and the SDSS photographs (docs/open-questions.md
 * Q1). It travels in every `GalaxyCard` and `RealCard`, so a page that shows a card has the text.
 *
 * Galaxy Zoo 2: CC BY 4.0 asks for the credit, a link to the licence, and an indication of changes.
 * The credit is the project's and its papers; the changes are Rosse's (the votes are quantised to a
 * byte each, packed column by column, and turned into drawing parameters).
 *
 * SDSS: the pack (assets/) holds no acknowledgement wording, only that the photographs are SDSS's.
 * The text here points to SDSS's own page for the wording and is NOT the published wording: the
 * owner must check what SDSS requires for the imagery (DR7 / DR17 SkyServer cut-outs) and paste it
 * into `SDSS_ACKNOWLEDGEMENT` (docs/milestones/m12/README.md, owner decisions).
 */

export interface Attribution {
  /** Who made the data. */
  credit: string;
  licence: { name: string; url: string };
  /** What Rosse did to it. */
  changes: string;
  /** The SDSS part. */
  sdss: string;
  /** All of it, as one paragraph, for a page that shows a single credit line. */
  text: string;
}

export const GZ2_CREDIT =
  'Galaxy classifications: Galaxy Zoo 2, from the volunteers of galaxyzoo.org (Willett et al. 2013, MNRAS 435, 2835; Hart et al. 2016, MNRAS 461, 3663). Positions, colours and sizes: SDSS DR7.';
export const GZ2_LICENCE = {
  name: 'CC BY 4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/',
} as const;
export const GZ2_CHANGES =
  "Changed: each vote fraction is quantised to one byte and the catalogue re-packed, and Rosse draws parameters derived from the votes; the drawings are Rosse's, not Galaxy Zoo's or SDSS's.";
/** To be replaced by SDSS's published acknowledgement wording (owner decision). */
export const SDSS_ACKNOWLEDGEMENT =
  'Imagery and measurements: the Sloan Digital Sky Survey (SDSS). Acknowledgement as SDSS publishes it: https://www.sdss.org/collaboration/citing-sdss/';

export const ATTRIBUTION: Attribution = {
  credit: GZ2_CREDIT,
  licence: GZ2_LICENCE,
  changes: GZ2_CHANGES,
  sdss: SDSS_ACKNOWLEDGEMENT,
  text: `${GZ2_CREDIT} Licensed under ${GZ2_LICENCE.name} (${GZ2_LICENCE.url}). ${GZ2_CHANGES} ${SDSS_ACKNOWLEDGEMENT}`,
};
