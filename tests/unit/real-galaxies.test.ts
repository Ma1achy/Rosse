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
});
