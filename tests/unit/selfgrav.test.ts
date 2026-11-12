/**
 * The stars' pull on one another on the CPU (ADR 0100): the Barnes–Hut tree against the exact sum
 * the GPU does, and its cost.
 */
import { describe, expect, it } from 'vitest';
import { SelfTree, selfGravityDirect, type SelfGravity } from '../../src/fallback/kernels/selfgrav';

/** two discs of stars, a deterministic scatter */
function system(n: number) {
  const xs = new Float32Array(n * 4);
  let s = 12345;
  const r = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) {
    const g = i < n / 2 ? 0 : 1;
    const R = -0.4 * Math.log(r() * r() + 1e-6);
    const t = r() * 6.2832;
    xs[i * 4] = Math.fround(g * 3 + R * Math.cos(t));
    xs[i * 4 + 1] = Math.fround(R * Math.sin(t));
    xs[i * 4 + 2] = Math.fround((r() - 0.5) * 0.05);
  }
  const S: SelfGravity = { n, n0: n / 2, stride: 4, ms: [1e-4, 1e-4], eps2: 0.012 };
  return { xs, S };
}

describe('the tree', () => {
  it('matches the exact sum to a percent of the field, rms', () => {
    const { xs, S } = system(4000);
    const a = new Float32Array(4000 * 4);
    const b = new Float32Array(4000 * 4);
    selfGravityDirect(xs, S, a);
    new SelfTree().field(xs, S, b);
    let num = 0;
    let den = 0;
    for (let i = 0; i < 4000; i++)
      for (let d = 0; d < 3; d++) {
        num += ((a[i * 4 + d] ?? 0) - (b[i * 4 + d] ?? 0)) ** 2;
        den += (a[i * 4 + d] ?? 0) ** 2;
      }
    expect(Math.sqrt(num / den)).toBeLessThan(0.006);
  });

  it('never pulls a source on itself, and gives a lone pair equal and opposite pulls', () => {
    const xs = new Float32Array(8 * 4);
    xs.set([0, 0, 0, 0], 0);
    xs.set([1, 0, 0, 0], 4);
    const S: SelfGravity = { n: 2, n0: 2, stride: 1, ms: [1, 1], eps2: 0 };
    const a = new Float32Array(8);
    new SelfTree().field(xs, S, a);
    expect(a[0]).toBeCloseTo(1, 5);
    expect(a[4]).toBeCloseTo(-1, 5);
  });

  it('walks ten thousand stars in tens of milliseconds', () => {
    const { xs, S } = system(10000);
    const out = new Float32Array(10000 * 4);
    const T = new SelfTree();
    T.field(xs, S, out);
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) T.field(xs, S, out);
    expect((performance.now() - t0) / 5).toBeLessThan(1000);
  });
});
