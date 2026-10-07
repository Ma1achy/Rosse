/**
 * A merging pair can lens a galaxy behind it (app23.js:L1724, M9): the lensed merger carries a lens
 * host scene, the lens's marks are drawn over the merger's, and a merger without a lens has none.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { presetParams } from '../../src/core/presets';
import { CpuMerger } from '../../src/fallback/merger';
import { buildMergerScene } from '../../src/model/merger';
import { GoldenNode } from '../golden/compare/node';

const ROOT = resolve(import.meta.dirname, '../..');
const node = new GoldenNode(ROOT);
const lensed = presetParams('Layered: lensed merger', 7, { starMix: 0, field: 0, fgstars: 0 });
const plain = { ...lensed, lensOn: 0 };

describe('the lensed merger', () => {
  it('has a lens host only when the lens is on', () => {
    expect(buildMergerScene(lensed, node.cpu.meta).lensHost?.lens).toBeDefined();
    expect(buildMergerScene(plain, node.cpu.meta).lensHost).toBeUndefined();
  });

  it('draws the lens over the merger, counted with it', () => {
    const view = (P: typeof lensed) =>
      new CpuMerger(
        P,
        node.cpu.meta,
        node.referenceOptions(P, 1, 'Layered: lensed merger').merger,
      ).view(1);
    const a = view(lensed);
    const b = view(plain);
    expect(a.layers.length).toBeGreaterThan(b.layers.length);
    const sum = (v: typeof a) => v.perClass.reduce((x, y) => x + y, 0);
    expect(sum(a)).toBeGreaterThan(sum(b));
  });
});
