import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Draws, pcg4d, randF32, randGauss, randU32 } from '../../src/core/rng';
import { Stream } from '../../src/core/streams';
import { computeRngVectors, type RngVectors } from '../vectors/rng-cases';

const VECTORS = resolve(import.meta.dirname, '../vectors/rng.json');

if (process.env.ROSSE_WRITE_VECTORS === '1') {
  // One entry per line: readable diffs, and small.
  const v = computeRngVectors();
  const list = (a: unknown[]) => '[\n  ' + a.map((x) => JSON.stringify(x)).join(',\n  ') + '\n ]';
  const body = Object.entries(v)
    .map(([k, x]) => ` ${JSON.stringify(k)}: ${Array.isArray(x) ? list(x) : JSON.stringify(x)}`)
    .join(',\n');
  writeFileSync(VECTORS, `{\n${body}\n}\n`);
}

const stored = JSON.parse(readFileSync(VECTORS, 'utf8')) as RngVectors;

/** An independent pcg4d in BigInt arithmetic, modulo 2^32, to check the Math.imul version. */
function pcg4dBig(key: [number, number, number, number]): number[] {
  const M = (1n << 32n) - 1n;
  let [x, y, z, w] = key.map((k) => (BigInt(k) * 1664525n + 1013904223n) & M) as [
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  const mix = () => {
    x = (x + y * w) & M;
    y = (y + z * x) & M;
    z = (z + x * y) & M;
    w = (w + y * z) & M;
  };
  mix();
  [x, y, z, w] = [x ^ (x >> 16n), y ^ (y >> 16n), z ^ (z >> 16n), w ^ (w >> 16n)];
  mix();
  return [x, y, z, w].map(Number);
}

describe('rng (ADR 0004)', () => {
  it('matches the committed vectors exactly', () => {
    const now = computeRngVectors();
    expect(now.keys).toEqual(stored.keys);
    expect(now.pcg4d).toEqual(stored.pcg4d);
    expect(now.u32).toEqual(stored.u32);
    expect(now.unitBits).toEqual(stored.unitBits);
    expect(now.gauss).toEqual(stored.gauss);
  });

  it('agrees with an independent BigInt pcg4d', () => {
    for (const k of stored.keys) expect(pcg4d(...k)).toEqual(pcg4dBig(k));
  });

  it('gives u32 words and uniforms in [0, 1) that are exact f32', () => {
    for (const k of stored.keys) {
      const u = randU32(...k);
      expect(Number.isInteger(u) && u >= 0 && u <= 0xffffffff).toBe(true);
      const x = randF32(...k);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(Math.fround(x)).toBe(x);
    }
    expect(randF32(0xffffffff, 0, 0, 0)).toBeLessThan(1);
  });

  it('has plausible statistics', () => {
    const n = 20000;
    let s = 0;
    let s2 = 0;
    let g = 0;
    let g2 = 0;
    for (let i = 0; i < n; i++) {
      const x = randF32(7, Stream.test, i, 0);
      s += x;
      s2 += x * x;
      const z = randGauss(7, Stream.test, i, 2);
      g += z;
      g2 += z * z;
    }
    expect(s / n).toBeCloseTo(0.5, 2);
    expect(s2 / n - (s / n) ** 2).toBeCloseTo(1 / 12, 2);
    expect(g / n).toBeCloseTo(0, 1);
    expect(g2 / n).toBeCloseTo(1, 1);
  });

  it('changes everything when any key word changes', () => {
    const base = randU32(7, 2, 100, 0);
    expect(randU32(8, 2, 100, 0)).not.toBe(base);
    expect(randU32(7, 3, 100, 0)).not.toBe(base);
    expect(randU32(7, 2, 101, 0)).not.toBe(base);
    expect(randU32(7, 2, 100, 1)).not.toBe(base);
  });

  it('walks the draw counter with Draws', () => {
    const d = new Draws(7, Stream.stipple, 5);
    expect(d.u32()).toBe(randU32(7, Stream.stipple, 5, 0));
    expect(d.f32()).toBe(randF32(7, Stream.stipple, 5, 1));
    expect(d.gauss()).toBe(randGauss(7, Stream.stipple, 5, 2));
    expect(d.draw).toBe(4);
  });

  it('keeps stream ids unique', () => {
    const ids = Object.values(Stream);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
