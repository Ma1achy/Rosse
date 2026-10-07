/**
 * A few plain words for what a set of parameters draws, as v21's `shortType` (app23.js:L1392–1403,
 * written on a real galaxy's print) says it. Used for the preset cards and the plate's caption, so
 * a card says what it is (design language, principle 8).
 */
import type { Params } from '../core/params';
import { PRESETS, presetFamily, PRESET_NAMES } from '../core/presets';
import { DEF } from '../core/params';
import { FEATURES, type FeatureName } from './layout';

const NUMBERS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];

export function describe(p: Params): string {
  const n = Math.round(p.arms || 0);
  const num = NUMBERS[n] ?? String(n);
  let t: string;
  if (p.subject === 'star') t = 'a star';
  else if (p.subject === 'artefact') t = 'an artefact';
  else if (p.merger) t = 'two galaxies merging';
  else if (n < 1 && p.bulge >= 0.9)
    t = p.bulgeFlat < 0.55 ? 'a cigar-shaped elliptical' : 'a round elliptical';
  else if (p.incl > 80) t = 'an edge-on disc';
  else if (n < 1) t = 'a disc, no arms';
  else t = `${p.bar > 0.35 ? 'a barred spiral' : 'a spiral'}, ${num} arm${n > 1 ? 's' : ''}`;
  const extra =
    p.ring > 0.3
      ? 'with a ring'
      : p.lensOn
        ? 'lensed'
        : p.dustLines > 0.45
          ? 'with a dust lane'
          : '';
  return extra ? `${t}, ${extra}` : t;
}

/** The features a preset needs that the engine draws only once they land (src/ui/layout.ts). */
export function needs(name: string): FeatureName[] {
  const p = { ...DEF, ...PRESETS[name] };
  const out: FeatureName[] = [];
  if (p.merger) out.push('merger');
  if (p.lensOn) out.push('lens');
  if (p.subject !== 'galaxy' || p.ovStar > 0 || p.ovArtefact !== 'none') out.push('stars');
  return out;
}

/** The presets the page can draw now, in the preset table's order. */
export function availablePresets(
  features: Record<FeatureName, boolean> = FEATURES,
): readonly string[] {
  return PRESET_NAMES.filter((n) => needs(n).every((f) => features[f]));
}

export const FAMILY_TITLES: Record<ReturnType<typeof presetFamily>, string> = {
  galaxy: 'Galaxies',
  merger: 'Mergers',
  lens: 'Lenses',
  star: 'Stars and artefacts',
  artefact: 'Stars and artefacts',
  layered: 'Scenes',
  creative: 'Creative',
};

/** The card's title: the preset's name without its family prefix, as v21 (L1545). */
export function cardTitle(name: string): string {
  const nm = name.replace(/^(Merger|Lens|Star|Artefact|Layered): /, '');
  const t = name.startsWith('Star:') ? `star, ${nm}` : nm;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
