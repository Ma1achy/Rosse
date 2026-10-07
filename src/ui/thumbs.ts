/**
 * The preset thumbnails: small drawings of each preset by this engine, one set on Paper and one on
 * the Chalkboard (`npm run thumbnails` makes them; tools/thumbnails/make.mjs). A preset without a
 * file has no thumbnail and its card shows its name only; the page never draws one itself.
 */
import type { SurfaceName } from '../render/surface';

const paper = import.meta.glob<string>('./thumbs/paper/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const chalk = import.meta.glob<string>('./thumbs/chalk/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** A preset's file name: its name in lower case, words joined by hyphens. */
export function slug(preset: string): string {
  return preset
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function thumbUrl(preset: string, surface: SurfaceName): string | undefined {
  const set = surface === 'chalk' ? chalk : paper;
  return set[`./thumbs/${surface}/${slug(preset)}.webp`];
}
