import { describe, expect, it } from 'vitest';
import { cutCells, downsample, mipChain, mipCount } from '../../tools/pack-atlas/pack-lib.js';
import { atlasFromBytes, inkEdge, planArrays, type AtlasEntry } from '../../src/marks/atlas';

const sum = (a: Uint8Array) => a.reduce((s, x) => s + x, 0);

describe('pack-atlas', () => {
  it('counts mips as WebGPU does', () => {
    expect(mipCount(32, 32)).toBe(6);
    expect(mipCount(48, 48)).toBe(6);
    expect(mipCount(512, 64)).toBe(10);
  });

  it('cuts cells row-major from the alpha channel', () => {
    // a 4 × 2 sheet of 2 × 1 cells, 2 columns: alpha = pixel index
    const rgba = new Uint8Array(4 * 2 * 4);
    for (let i = 0; i < 8; i++) rgba[i * 4 + 3] = i;
    const cells = cutCells(rgba, 4, { cellWidth: 2, cellHeight: 1, cols: 2, n: 4 });
    expect([...cells]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps each layer separate and preserves coverage (2:1)', () => {
    const w = 8;
    const layers = 2;
    const src = new Uint8Array(w * w * layers);
    src.fill(200, 0, w * w); // layer 0 inked, layer 1 empty
    src[3 * w + 4] = 0;
    const chain = mipChain(src, w, w, layers);
    expect(chain.map((l) => [l.width, l.height])).toEqual([
      [8, 8],
      [4, 4],
      [2, 2],
      [1, 1],
    ]);
    for (const l of chain) {
      const n = l.width * l.height;
      expect(sum(l.data.subarray(n, 2 * n))).toBe(0);
      expect(sum(l.data.subarray(0, n)) / n).toBeCloseTo(sum(src.subarray(0, 64)) / 64, 0);
    }
  });

  it('downsamples odd sizes with area weights (3 → 1)', () => {
    const src = new Uint8Array([0, 90, 180, 0, 90, 180, 0, 90, 180]);
    const d = downsample(src, 3, 3, 1);
    expect([d.width, d.height]).toEqual([1, 1]);
    expect(d.data[0]).toBe(90);
  });

  it('downsamples non-square layers (strokes) down to 1 × 1', () => {
    const chain = mipChain(new Uint8Array(512 * 64).fill(255), 512, 64, 1);
    expect(chain.at(-1)).toMatchObject({ width: 1, height: 1 });
    expect(chain.at(-1)?.data[0]).toBe(255);
    expect(chain[7]).toMatchObject({ width: 4, height: 1 });
  });
});

describe('atlas', () => {
  it('splits sheets that exceed the layer limit', () => {
    expect(planArrays(638, 256)).toEqual([
      { first: 0, count: 256 },
      { first: 256, count: 256 },
      { first: 512, count: 126 },
    ]);
    expect(planArrays(638, 2048)).toEqual([{ first: 0, count: 638 }]);
    expect(planArrays(60, 256)).toEqual([{ first: 0, count: 60 }]);
  });

  it('uses the reference ink edges', () => {
    expect(inkEdge('dots')).toEqual([0.12, 0.55]);
    expect(inkEdge('whole')).toEqual([0.46, 0.62]);
  });

  it('reads levels out of the packed bytes', () => {
    const entry: AtlasEntry = {
      file: 'x.bin',
      cellWidth: 2,
      cellHeight: 2,
      layers: 2,
      cols: 2,
      repeatU: false,
      levels: [
        { width: 2, height: 2, offset: 0, byteLength: 8 },
        { width: 1, height: 1, offset: 8, byteLength: 2 },
      ],
      meta: {},
      source: '',
      sha256: '',
    };
    const a = atlasFromBytes('dots', entry, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect([...(a.levels[1]?.data ?? [])]).toEqual([8, 9]);
    expect(() => atlasFromBytes('dots', entry, new Uint8Array(9))).toThrow(/short/);
  });
});
