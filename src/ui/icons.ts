/**
 * A card's icon: one of the library's own pen drawings, redrawn as a small SVG (v21 paints it on a
 * 72 px canvas, `iconFor`, app23.js:L1511). The drawing is chosen by sheet and index, or by a word
 * of its type or kind (`galaxy:spiral`); a drawing that is not found leaves an empty icon.
 */
import type { VectorLibrary } from '../marks/vector';
import type { IconSpec } from './layout';

const NS = 'http://www.w3.org/2000/svg';

/** The index a spec names in its sheet. */
export function iconIndex(lib: VectorLibrary, spec: IconSpec): number {
  const [atlas, which] = spec;
  const sheet = lib[atlas];
  if (typeof which === 'number') return which;
  const list = sheet.kind ?? sheet.type ?? [];
  const i = list.findIndex((k) => k.includes(which));
  return i < 0 ? 0 : i;
}

/** The path data of a drawing's polylines, in a 72 × 72 box. */
export function iconPath(lib: VectorLibrary, spec: IconSpec): string {
  const rec = lib[spec[0]].vec[iconIndex(lib, spec)];
  if (!rec) return '';
  let d = '';
  for (const line of rec.l) {
    for (let i = 0; i + 1 < line.length; i += 2) {
      const x = ((line[i] ?? 0) + 0.5) * 72;
      const y = ((line[i + 1] ?? 0) + 0.5) * 72;
      d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  }
  return d;
}

export function iconSvg(lib: VectorLibrary, spec: IconSpec): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 72 72');
  svg.setAttribute('class', 'rc-ic');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', iconPath(lib, spec));
  svg.append(path);
  return svg;
}
