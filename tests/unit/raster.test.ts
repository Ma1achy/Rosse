import { describe, expect, it } from 'vitest';
import { mipChain } from '../../tools/pack-atlas/pack-lib.js';
import {
  composite,
  createInkBuffer,
  rasteriseSprites,
  sampleLevel,
  smoothstep,
  spriteLod,
} from '../../src/fallback/raster';
import type { AtlasData } from '../../src/marks/atlas';
import { simple } from '../../src/marks/instance';
import { dotSprite, penWeights } from '../../src/render/sample-scene';
import { SURFACES, blendOverlay, blendSoftLight, hexToRgb } from '../../src/render/surface';

/** A synthetic 16 × 16 atlas: layer 0 a filled disc, layer 1 empty. */
function discAtlas(): AtlasData {
  const w = 16;
  const top = new Uint8Array(w * w * 2);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++)
      if ((x + 0.5 - 8) ** 2 + (y + 0.5 - 8) ** 2 < 36) top[y * w + x] = 255;
  const levels = mipChain(top, w, w, 2).map((l) => ({
    width: l.width,
    height: l.height,
    data: new Uint8Array(l.data),
  }));
  return { name: 'dots', layers: 2, repeatU: false, edge: [0.12, 0.55], meta: {}, levels };
}

describe('CPU rasteriser (runs in Node)', () => {
  it('matches WGSL smoothstep', () => {
    expect(smoothstep(0.12, 0.55, 0.1)).toBe(0);
    expect(smoothstep(0.12, 0.55, 0.6)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });

  it('picks the mip level from the instance matrix', () => {
    // a 32-texel cell drawn 8 px wide: 4 texels per pixel, level 2
    expect(spriteLod(simple(8, 0), 1, 32, 5)).toBeCloseTo(2, 5);
    expect(spriteLod(simple(8, 1.1), 1, 32, 5)).toBeCloseTo(2, 5);
    // magnified: level 0; tiny: clamped to the last level
    expect(spriteLod(simple(64, 0), 1, 32, 5)).toBe(0);
    expect(spriteLod(simple(0.01, 0), 1, 32, 5)).toBe(5);
    // anisotropic: the longer texel step wins
    expect(spriteLod([8, 0, 0, 16], 1, 32, 5)).toBeCloseTo(2, 5);
  });

  it('samples bilinearly with clamp-to-edge', () => {
    const a = discAtlas();
    expect(sampleLevel(a, 0, 0.5, 0.5, 0)).toBe(1);
    expect(sampleLevel(a, 1, 0.5, 0.5, 0)).toBe(0);
    expect(sampleLevel(a, 0, 0, 0, 0)).toBe(0);
  });

  it('inks a dot, premultiplied, inside its quad only', () => {
    const ink = createInkBuffer(32, 32);
    rasteriseSprites(ink, discAtlas(), [{ x: 16, y: 16, layer: 0, alpha: 1, m: simple(12, 0) }], {
      pxPerUnit: 1,
      gain: 1,
    });
    const at = (x: number, y: number, c: number) => ink.data[(y * 32 + x) * 4 + c];
    expect(at(16, 16, 3)).toBe(1);
    expect(at(16, 16, 0)).toBe(1);
    expect(at(2, 2, 3)).toBe(0);
    let total = 0;
    for (let i = 3; i < ink.data.length; i += 4) total += ink.data[i] ?? 0;
    // a disc of radius 6 texels in a 16-texel cell drawn 12 px wide: radius 4.5 px
    expect(total).toBeGreaterThan(Math.PI * 4.5 ** 2 * 0.8);
    expect(total).toBeLessThan(Math.PI * 4.5 ** 2 * 1.2);
  });

  it('gives the reference dot size at pen 2.4', () => {
    // dots cell 0 measures 7.81: clamp(1.9 + 0.045 × 7.81) × 0.99 × 40 / 7.81
    expect(dotSprite(7.81, penWeights(2.4).dot)).toBeCloseTo(11.416, 3);
  });
});

describe('surface blending (CSS compositing)', () => {
  it('overlay is hard-light with swapped operands', () => {
    expect(blendOverlay(0.25, 0.5)).toBeCloseTo(0.25, 6);
    expect(blendOverlay(0.75, 0.5)).toBeCloseTo(0.75, 6);
    expect(blendOverlay(0.9, 0)).toBeCloseTo(0.8, 6);
    expect(blendOverlay(0.9, 1)).toBeCloseTo(1, 6);
  });

  it('soft-light leaves the backdrop at a mid-grey source', () => {
    expect(blendSoftLight(0.149, 0.5)).toBeCloseTo(0.149, 6);
    expect(blendSoftLight(0.149, 0)).toBeCloseTo(0.149 - 0.149 * 0.851, 6);
    expect(blendSoftLight(0.5, 1)).toBeCloseTo(Math.sqrt(0.5), 6);
  });

  it('uses the plate colours of the reference CSS', () => {
    expect(SURFACES.paper.field).toEqual(hexToRgb('#e6dece'));
    expect(SURFACES.chalk.field).toEqual(hexToRgb('#262b28'));
    expect(SURFACES.chalk.palette.ink).toEqual([0.925, 0.894, 0.824]);
  });

  it('composites ink over the surface', () => {
    const ink = createInkBuffer(2, 1);
    ink.data.set([1, 1, 1, 1], 0); // full key ink on pixel 0
    const paper = { width: 1, height: 1, data: new Uint8Array([128, 128, 128, 255]) };
    const out = new Uint8ClampedArray(8);
    composite(ink, { surface: SURFACES.paper, paper, dpr: 1 }, out);
    expect([...out.subarray(0, 3)]).toEqual(
      SURFACES.paper.palette.ink.map((c) => Math.round(c * 255)),
    );
    // pixel 1: the field overlaid with 128/255 grey
    const g = 128 / 255;
    expect(out[4]).toBe(Math.round(blendOverlay(SURFACES.paper.field[0], g) * 255));
  });
});
