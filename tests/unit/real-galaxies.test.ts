import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REAL_GALAXIES, printRotation, realCards } from '../../src/extras/real/real-galaxies';

describe('the 42 real galaxies', () => {
  const cards = realCards();

  it('has 42 cards with a photo and a post-it each', () => {
    expect(REAL_GALAXIES).toHaveLength(42);
    expect(cards).toHaveLength(42);
    for (const c of cards) {
      expect(c.photoUrl, c.galaxy.id).toMatch(/_photo.*\.jpg/);
      expect(c.postitUrl, c.galaxy.id).toMatch(/\.webp/);
    }
    expect(new Set(cards.map((c) => c.photoUrl)).size).toBe(42);
  });

  it('carries the attribution in every card (credit, licence link, changes, SDSS)', () => {
    for (const c of cards) {
      expect(c.attribution.licence.url).toBe('https://creativecommons.org/licenses/by/4.0/');
      expect(c.attribution.credit).toContain('Galaxy Zoo 2');
      expect(c.attribution.changes).toMatch(/^Changed:/);
      expect(c.attribution.sdss).toContain('Sloan Digital Sky Survey');
      expect(c.attribution.text).toContain(c.attribution.licence.url);
    }
  });

  it('draws what the photo measures', () => {
    for (const c of cards) {
      expect(c.drawnPa).toBe(Math.round(c.photoPa));
      expect(c.photoQ).toBeGreaterThan(0);
      expect(c.photoQ).toBeLessThanOrEqual(1);
      expect(c.caption.length).toBeGreaterThan(3);
      expect(c.description).toContain('volunteers');
      expect(c.params.seed).toBe((parseInt(c.galaxy.id.slice(-6), 10) % 9973) + 1);
    }
    const edge = cards.filter((c) => c.caption.startsWith('an edge-on'));
    expect(edge.length).toBeGreaterThan(0);
    for (const c of edge) expect(c.drawnIncl).toBeGreaterThanOrEqual(84);
  });

  it('tilts the prints as v21 does (within 1.5 degrees, two decimals)', () => {
    for (let i = 0; i < 42; i++) {
      const r = printRotation(i);
      expect(Math.abs(r)).toBeLessThanOrEqual(1.5);
      expect(r).toBe(Number(r.toFixed(2)));
    }
  });

  it("has v21's own parameters in the golden captures (what fromVotes gives, plus the case's overrides)", () => {
    const dir = join(import.meta.dirname, '../golden/reference');
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
      captures: { name: string; variant?: string; real?: number; overrides?: object }[];
    };
    const real = manifest.captures.filter((c) => c.variant === 'real');
    expect(real).toHaveLength(20);
    for (const c of real) {
      const rec = JSON.parse(readFileSync(join(dir, `${c.name}.json`), 'utf8')) as {
        params: Record<string, unknown>;
      };
      const card = cards[c.real as number];
      // the orbit capture has its camera moved from home
      const home = c.name.endsWith('__home');
      // the records are v21's: they have none of the keys the port adds (`dustAuto`, ADR 0075)
      const want = { ...card?.params, ...c.overrides, dustAuto: undefined };
      if (home) expect(rec.params, c.name).toEqual(want);
      else expect({ ...rec.params, az: 0, incl: 0 }, c.name).toEqual({ ...want, az: 0, incl: 0 });
    }
  });
});
