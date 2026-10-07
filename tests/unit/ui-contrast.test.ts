import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The page's colour tokens (src/ui/page.css) against its grounds: WCAG 2.x AA for text (4.5:1). */
const css = readFileSync(new URL('../../src/ui/page.css', import.meta.url), 'utf8');

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9]+):\s*(#[0-9a-f]{6})/gi)) out[m[1] ?? ''] = m[2] ?? '';
  return out;
}
const light = tokens(/:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '');
const dark = tokens(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '');

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** WCAG 2.x 1.4.11: the boundary of a control (a slider's track, a card's or a box's edge) is 3:1. */
describe('contrast of the edges of controls', () => {
  for (const [name, t] of [
    ['Paper', light],
    ['Chalkboard', { ...light, ...dark }],
  ] as const) {
    for (const bg of ['paper', 'field']) {
      it(`${name}: edge on ${bg} is at least 3:1`, () => {
        expect(t.edge).toBeDefined();
        expect(contrast(t.edge ?? '', t[bg] ?? '')).toBeGreaterThanOrEqual(3);
      });
    }
  }
  it('uses the edge, not the hairline, for the slider track and the cards', () => {
    expect(css).toMatch(/slider-runnable-track[^}]*var\(--edge\)/);
    expect(css).toMatch(/\.card \{[^}]*border: 1px solid var\(--edge\)/);
    expect(css).toMatch(/\.rcard \{[^}]*border: 1px solid var\(--edge\)/);
  });
});

describe('colour contrast of the page', () => {
  for (const [name, t] of [
    ['Paper', light],
    ['Chalkboard', { ...light, ...dark }],
  ] as const) {
    for (const fg of ['ink', 'ink2', 'mag', 'pencil']) {
      for (const bg of ['paper', 'field']) {
        it(`${name}: ${fg} on ${bg} is at least 4.5:1`, () => {
          expect(t[fg], fg).toBeDefined();
          expect(contrast(t[fg] ?? '', t[bg] ?? '')).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});
